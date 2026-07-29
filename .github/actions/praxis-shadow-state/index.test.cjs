const assert = require("node:assert/strict");
const test = require("node:test");

const {
  GitHubRestApi,
  bridge,
  cleanup,
  orphanedBindings,
  resolveTrigger,
  transition,
} = require("./index.cjs");
const {
  ORPHAN_BUDGET,
  bindingFor,
  formatShadowDispatch,
} = require("./contract.cjs");

const SOURCE_REPO = "cloudwarriors-ai/example";
const SHADOW_REPO = "cloudwarriors-ai/example-shadow";
const SOURCE_ISSUE = 42;
const SHADOW_ISSUE = 7;
const NONCE_A = "0123456789abcdef0123456789abcdef";
const NONCE_B = "fedcba9876543210fedcba9876543210";
const BINDING_A = bindingFor("123", NONCE_A);
const BINDING_B = bindingFor("124", NONCE_B);
const WRITE_METHODS = new Set([
  "ensureLabel",
  "addLabels",
  "removeLabel",
  "deleteLabel",
  "createComment",
]);

function writes(api) {
  return api.calls.filter((call) => WRITE_METHODS.has(call[0]));
}

function sourceMarker({
  repo = SOURCE_REPO,
  issue = SOURCE_ISSUE,
  attempt_id = "123",
  nonce = NONCE_A,
} = {}) {
  return `<!-- praxis-dispatch ${JSON.stringify({
    attempt_id,
    issue,
    nonce,
    repo,
    resolver_config_id: "autopilot-v1",
  })} -->`;
}

class FakeApi {
  constructor(overrides = {}) {
    Object.assign(
      this,
      {
        sourceComments: [{ id: 1, body: sourceMarker() }],
        shadowConfig: {
          sourceRepo: SOURCE_REPO,
          shadowRepo: SHADOW_REPO,
          issueMap: { [SOURCE_ISSUE]: SHADOW_ISSUE },
        },
        shadowIssue: {
          number: SHADOW_ISSUE,
          body: `Body\n\n---\n*Shadow of [${SOURCE_REPO}#${SOURCE_ISSUE}](https://github.com/${SOURCE_REPO}/issues/${SOURCE_ISSUE})*`,
          labels: [],
        },
        shadowComments: [],
        repoLabels: [],
        issues: [],
      },
      overrides,
    );
    this.calls = [];
  }

  async listComments(repo, issue) {
    this.calls.push(["listComments", repo, issue]);
    return repo === SOURCE_REPO ? this.sourceComments : this.shadowComments;
  }

  async getJsonContent(repo, contentPath) {
    this.calls.push(["getJsonContent", repo, contentPath]);
    assert.equal(repo, SHADOW_REPO);
    assert.equal(contentPath, ".shadow/config.json");
    return this.shadowConfig;
  }

  async getIssue(repo, issue) {
    this.calls.push(["getIssue", repo, issue]);
    assert.equal(repo, SHADOW_REPO);
    assert.equal(issue, SHADOW_ISSUE);
    return this.shadowIssue;
  }

  async listRepoLabels(repo) {
    this.calls.push(["listRepoLabels", repo]);
    return this.repoLabels;
  }

  async listIssues(repo) {
    this.calls.push(["listIssues", repo]);
    return this.issues;
  }

  async ensureLabel(repo, name) {
    this.calls.push(["ensureLabel", repo, name]);
  }

  async addLabels(repo, issue, labels) {
    this.calls.push(["addLabels", repo, issue, labels]);
  }

  async removeLabel(repo, issue, label) {
    this.calls.push(["removeLabel", repo, issue, label]);
  }

  async deleteLabel(repo, label) {
    this.calls.push(["deleteLabel", repo, label]);
  }

  async createComment(repo, issue, body) {
    this.calls.push(["createComment", repo, issue, body]);
    return { id: 99, body };
  }
}

test("bridge installs one binding and one deterministic shadow trigger", async () => {
  const api = new FakeApi();
  const result = await bridge({
    api,
    sourceRepo: SOURCE_REPO,
    sourceIssue: SOURCE_ISSUE,
  });

  assert.deepEqual(result, {
    bound: true,
    binding: BINDING_A,
    attemptId: "123",
    shadowIssue: SHADOW_ISSUE,
    shadowRepo: SHADOW_REPO,
    dispatchCreated: true,
    reason: "bridged",
  });
  assert.ok(
    api.calls.some(
      (call) =>
        call[0] === "ensureLabel" &&
        call[1] === SHADOW_REPO &&
        call[2] === BINDING_A,
    ),
  );
  assert.ok(
    api.calls.some(
      (call) =>
        call[0] === "addLabels" &&
        call[2] === SHADOW_ISSUE &&
        call[3][0] === BINDING_A,
    ),
  );
  assert.ok(
    api.calls.some(
      (call) =>
        call[0] === "createComment" &&
        call[3] ===
          formatShadowDispatch({
            binding: BINDING_A,
            sourceRepo: SOURCE_REPO,
            sourceIssue: SOURCE_ISSUE,
          }),
    ),
  );
  const writeCalls = writes(api);
  for (const call of writeCalls) {
    assert.equal(call[1], SHADOW_REPO);
    if (["addLabels", "removeLabel", "createComment"].includes(call[0])) {
      assert.equal(call[2], SHADOW_ISSUE);
    }
  }
});

test("bridge retry is idempotent for the same binding and dispatch comment", async () => {
  const dispatch = formatShadowDispatch({
    binding: BINDING_A,
    sourceRepo: SOURCE_REPO,
    sourceIssue: SOURCE_ISSUE,
  });
  const api = new FakeApi({
    shadowIssue: {
      number: SHADOW_ISSUE,
      body: `*Shadow of [${SOURCE_REPO}#${SOURCE_ISSUE}](url)*`,
      labels: [{ name: BINDING_A }],
    },
    shadowComments: [{ id: 5, body: dispatch }],
    repoLabels: [{ name: BINDING_A }],
    issues: [{ number: SHADOW_ISSUE, labels: [{ name: BINDING_A }] }],
  });

  const result = await bridge({
    api,
    sourceRepo: SOURCE_REPO,
    sourceIssue: SOURCE_ISSUE,
  });
  assert.equal(result.dispatchCreated, false);
  assert.equal(api.calls.some((call) => call[0] === "createComment"), false);
  assert.equal(api.calls.some((call) => call[0] === "deleteLabel"), false);
});

test("missing marker remains unbound and performs no write", async () => {
  const api = new FakeApi({ sourceComments: [{ id: 1, body: "ordinary" }] });
  const result = await bridge({
    api,
    sourceRepo: SOURCE_REPO,
    sourceIssue: SOURCE_ISSUE,
  });
  assert.deepEqual(result, {
    bound: false,
    binding: "",
    attemptId: "",
    shadowIssue: 0,
    shadowRepo: "",
    dispatchCreated: false,
    reason: "no_praxis_marker",
  });
  assert.deepEqual(
    api.calls.filter((call) =>
      ["ensureLabel", "addLabels", "removeLabel", "deleteLabel", "createComment"].includes(
        call[0],
      ),
    ),
    [],
  );
});

test("mapping disagreement fails before any write", async () => {
  const api = new FakeApi({
    shadowConfig: {
      sourceRepo: "cloudwarriors-ai/other",
      shadowRepo: SHADOW_REPO,
      issueMap: { [SOURCE_ISSUE]: SHADOW_ISSUE },
    },
  });
  await assert.rejects(
    bridge({ api, sourceRepo: SOURCE_REPO, sourceIssue: SOURCE_ISSUE }),
    /shadow_source_repo_mismatch/,
  );
  assert.deepEqual(writes(api), []);
});

test("new attempt cleans only a strict old binding", async () => {
  const api = new FakeApi({
    shadowIssue: {
      number: SHADOW_ISSUE,
      body: `*Shadow of [${SOURCE_REPO}#${SOURCE_ISSUE}](url)*`,
      labels: [{ name: BINDING_B }, { name: "STATUS: Follow-Up Required" }],
    },
    repoLabels: [{ name: BINDING_B }],
  });
  await bridge({ api, sourceRepo: SOURCE_REPO, sourceIssue: SOURCE_ISSUE });
  assert.ok(
    api.calls.some(
      (call) =>
        call[0] === "removeLabel" &&
        call[2] === SHADOW_ISSUE &&
        call[3] === BINDING_B,
    ),
  );
  assert.ok(
    api.calls.some(
      (call) => call[0] === "deleteLabel" && call[2] === BINDING_B,
    ),
  );
  assert.equal(
    api.calls.some(
      (call) =>
        ["removeLabel", "deleteLabel"].includes(call[0]) &&
        call.includes("STATUS: Follow-Up Required"),
    ),
    false,
  );
});

test("malformed machine-looking label blocks cleanup and all writes", async () => {
  const api = new FakeApi({
    shadowIssue: {
      number: SHADOW_ISSUE,
      body: `*Shadow of [${SOURCE_REPO}#${SOURCE_ISSUE}](url)*`,
      labels: [{ name: "praxis/a-malformed" }],
    },
  });
  await assert.rejects(
    bridge({ api, sourceRepo: SOURCE_REPO, sourceIssue: SOURCE_ISSUE }),
    /malformed_praxis_binding/,
  );
  assert.deepEqual(writes(api), []);
});

test("orphan budget fails closed before creating a new binding", async () => {
  const repoLabels = Array.from({ length: ORPHAN_BUDGET }, (_, index) => ({
    name: bindingFor(String(index + 1000), NONCE_B),
  }));
  const api = new FakeApi({ repoLabels, issues: [] });
  await assert.rejects(
    bridge({ api, sourceRepo: SOURCE_REPO, sourceIssue: SOURCE_ISSUE }),
    /binding_orphan_budget_exceeded/,
  );
  assert.deepEqual(writes(api), []);
});

test("orphan budget rejects before removing the issue's old binding", async () => {
  const orphanLabels = Array.from({ length: ORPHAN_BUDGET }, (_, index) => ({
    name: bindingFor(String(index + 1000), NONCE_A),
  }));
  const api = new FakeApi({
    shadowIssue: {
      number: SHADOW_ISSUE,
      body: `*Shadow of [${SOURCE_REPO}#${SOURCE_ISSUE}](url)*`,
      labels: [{ name: BINDING_B }],
    },
    repoLabels: [{ name: BINDING_B }, ...orphanLabels],
    issues: [
      {
        number: SHADOW_ISSUE,
        labels: [{ name: BINDING_B }],
      },
    ],
  });

  await assert.rejects(
    bridge({ api, sourceRepo: SOURCE_REPO, sourceIssue: SOURCE_ISSUE }),
    /binding_orphan_budget_exceeded/,
  );
  assert.deepEqual(writes(api), []);
});

test("resolve binds only the exact current trigger binding", async () => {
  const body = formatShadowDispatch({
    binding: BINDING_A,
    sourceRepo: SOURCE_REPO,
    sourceIssue: SOURCE_ISSUE,
  });
  const api = new FakeApi({
    shadowIssue: {
      number: SHADOW_ISSUE,
      body: "",
      labels: [{ name: BINDING_A }],
    },
  });
  assert.deepEqual(
    await resolveTrigger({
      api,
      repo: SHADOW_REPO,
      issue: SHADOW_ISSUE,
      triggerComment: body,
    }),
    {
      bound: true,
      binding: BINDING_A,
      attemptId: "123",
      stale: false,
      reason: "bound_trigger",
    },
  );

  api.shadowIssue.labels = [{ name: BINDING_B }];
  assert.deepEqual(
    await resolveTrigger({
      api,
      repo: SHADOW_REPO,
      issue: SHADOW_ISSUE,
      triggerComment: body,
    }),
    {
      bound: true,
      binding: BINDING_A,
      attemptId: "123",
      stale: true,
      reason: "stale_binding",
    },
  );
});

test("ordinary manual trigger remains unbound", async () => {
  const api = new FakeApi();
  assert.deepEqual(
    await resolveTrigger({
      api,
      repo: SHADOW_REPO,
      issue: SHADOW_ISSUE,
      triggerComment: "@claude please investigate",
    }),
    {
      bound: false,
      binding: "",
      attemptId: "",
      stale: false,
      reason: "unbound_trigger",
    },
  );
  assert.deepEqual(api.calls, [["getIssue", SHADOW_REPO, SHADOW_ISSUE]]);
});

test("ordinary manual trigger cannot bypass an existing Praxis binding", async () => {
  const api = new FakeApi({
    shadowIssue: {
      number: SHADOW_ISSUE,
      body: "",
      labels: [{ name: BINDING_A }],
    },
  });
  assert.deepEqual(
    await resolveTrigger({
      api,
      repo: SHADOW_REPO,
      issue: SHADOW_ISSUE,
      triggerComment: "@claude please retry",
    }),
    {
      bound: false,
      binding: "",
      attemptId: "",
      stale: true,
      reason: "binding_requires_machine_trigger",
    },
  );
  assert.deepEqual(writes(api), []);
});

test("bound transition removes old frozen phase then adds the new phase", async () => {
  const api = new FakeApi({
    shadowIssue: {
      number: SHADOW_ISSUE,
      body: "",
      labels: [{ name: BINDING_A }, { name: "STATUS: In QA" }],
    },
  });
  const result = await transition({
    api,
    repo: SHADOW_REPO,
    issue: SHADOW_ISSUE,
    binding: BINDING_A,
    phase: "in-progress",
    forceRelabel: true,
  });
  assert.deepEqual(result, {
    applied: true,
    stale: false,
    reason: "status_applied",
    status: "STATUS: In Progress",
  });
  assert.ok(
    api.calls.some(
      (call) =>
        call[0] === "removeLabel" &&
        call[3] === "STATUS: In QA",
    ),
  );
  assert.ok(
    api.calls.some(
      (call) =>
        call[0] === "addLabels" &&
        call[3][0] === "STATUS: In Progress",
    ),
  );
  assert.equal(
    api.calls.some(
      (call) =>
        call[0] === "removeLabel" &&
        call[3] === BINDING_A,
    ),
    false,
  );
});

test("stale bound transition is a successful no-op; API errors are not", async () => {
  const api = new FakeApi({
    shadowIssue: {
      number: SHADOW_ISSUE,
      body: "",
      labels: [{ name: BINDING_B }, { name: "STATUS: In Progress" }],
    },
  });
  assert.deepEqual(
    await transition({
      api,
      repo: SHADOW_REPO,
      issue: SHADOW_ISSUE,
      binding: BINDING_A,
      phase: "in-qa",
    }),
    {
      applied: false,
      stale: true,
      reason: "stale_binding",
      status: "STATUS: In QA",
    },
  );
  assert.equal(api.calls.some((call) => call[0] === "addLabels"), false);

  api.getIssue = async () => {
    throw new Error("HTTP 500");
  };
  await assert.rejects(
    transition({
      api,
      repo: SHADOW_REPO,
      issue: SHADOW_ISSUE,
      binding: BINDING_A,
      phase: "in-qa",
    }),
    /HTTP 500/,
  );
});

test("cleanup is strict and idempotent", async () => {
  const api = new FakeApi();
  assert.deepEqual(
    await cleanup({
      api,
      repo: SHADOW_REPO,
      issue: SHADOW_ISSUE,
      bindings: [BINDING_A],
    }),
    { removed: [BINDING_A] },
  );
  assert.ok(api.calls.some((call) => call[0] === "removeLabel"));
  assert.ok(api.calls.some((call) => call[0] === "deleteLabel"));

  const writesBeforeRejectedCandidate = writes(api).length;
  await assert.rejects(
    cleanup({
      api,
      repo: SHADOW_REPO,
      issue: SHADOW_ISSUE,
      bindings: ["STATUS: In Progress"],
    }),
    /refusing_non_binding_cleanup/,
  );
  assert.equal(writes(api).length, writesBeforeRejectedCandidate);
});

test("REST list operations paginate through the final partial page", async () => {
  const requests = [];
  const fullPage = Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }));
  const fetchImpl = async (url, init) => {
    requests.push([url, init.method]);
    const body = new URL(url).searchParams.get("page") === "1"
      ? fullPage
      : [{ id: 101 }];
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => "",
    };
  };
  const api = new GitHubRestApi("not-a-real-token", fetchImpl);

  assert.equal((await api.listComments(SOURCE_REPO, SOURCE_ISSUE)).length, 101);
  assert.equal((await api.listRepoLabels(SHADOW_REPO)).length, 101);
  assert.equal((await api.listIssues(SHADOW_REPO)).length, 101);
  assert.deepEqual(
    requests.map(([url, method]) => [new URL(url).searchParams.get("page"), method]),
    [
      ["1", "GET"],
      ["2", "GET"],
      ["1", "GET"],
      ["2", "GET"],
      ["1", "GET"],
      ["2", "GET"],
    ],
  );
});

test("binding attached to a closed issue is active, not orphaned", () => {
  assert.deepEqual(
    orphanedBindings(
      [{ name: BINDING_A }],
      [{ number: SHADOW_ISSUE, state: "closed", labels: [{ name: BINDING_A }] }],
    ),
    [],
  );
});

test("later-page REST failure propagates and performs no write", async () => {
  const requests = [];
  const fullPage = Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }));
  const fetchImpl = async (url, init) => {
    requests.push([url, init.method]);
    if (new URL(url).searchParams.get("page") === "2") {
      return {
        ok: false,
        status: 503,
        json: async () => ({}),
        text: async () => "unavailable",
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => fullPage,
      text: async () => "",
    };
  };
  const api = new GitHubRestApi("not-a-real-token", fetchImpl);

  await assert.rejects(
    api.listComments(SOURCE_REPO, SOURCE_ISSUE),
    /github_api_503:GET/,
  );
  assert.deepEqual(
    requests.map(([, method]) => method),
    ["GET", "GET"],
  );
});
