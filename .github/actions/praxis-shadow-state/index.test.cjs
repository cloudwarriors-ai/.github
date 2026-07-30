const assert = require("node:assert/strict");
const test = require("node:test");

const {
  GitHubRestApi,
  bridge,
  cleanup,
  orphanedBindings,
  reconcile,
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
const DISPATCHER_ID = 101;
const OTHER_USER_ID = 202;
const TRUSTED_SOURCE_ACTOR_ID = 303;
const FOREIGN_SOURCE_ACTOR_ID = 404;
const REPORT_MARKER = "<!-- AUTOPILOT_SHADOW_GUARD -->";
const REPORT_PROVENANCE = "<!-- AUTOPILOT_SHADOW_TRIGGER_V1";
const SHADOW_ISSUE_URL = `https://api.github.com/repos/${SHADOW_REPO}/issues/${SHADOW_ISSUE}`;
const SHADOW_DISPATCH = formatShadowDispatch({
  binding: BINDING_A,
  sourceRepo: SOURCE_REPO,
  sourceIssue: SOURCE_ISSUE,
});
const WRITE_METHODS = new Set([
  "ensureLabel",
  "addLabels",
  "removeLabel",
  "deleteLabel",
  "createComment",
  "updateComment",
  "updateIssueState",
]);

function writes(api) {
  return api.calls.filter((call) => WRITE_METHODS.has(call[0]));
}

const shadowWrites = (api) => writes(api).filter((call) => call[1] === SHADOW_REPO);
const createdFor = (api, repo) =>
  api.calls.find((call) => call[0] === "createComment" && call[1] === repo);

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

function dispatchComment(overrides = {}) {
  return {
    id: 5,
    body: SHADOW_DISPATCH,
    issue_url: SHADOW_ISSUE_URL,
    user: { id: DISPATCHER_ID, login: "workflow-bot" },
    ...overrides,
  };
}

class FakeApi {
  constructor(overrides = {}) {
    Object.assign(
      this,
      {
        sourceComments: [{ id: 1, body: sourceMarker(),
          user: { id: TRUSTED_SOURCE_ACTOR_ID, login: "praxis-app" } }],
        sourceIssue: { number: SOURCE_ISSUE, state: "open" },
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
        authenticatedUser: { id: DISPATCHER_ID, login: "workflow-bot" },
        repoLabels: [],
        issues: [],
      },
      overrides,
    );
    this.sourceIssue = { state: "open", ...this.sourceIssue };
    this.shadowIssue = { state: "open", ...this.shadowIssue };
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
    if (repo === SOURCE_REPO) {
      assert.equal(issue, SOURCE_ISSUE);
      return this.sourceIssue;
    }
    assert.equal(repo, SHADOW_REPO);
    assert.equal(issue, SHADOW_ISSUE);
    return this.shadowIssue;
  }

  async getAuthenticatedUser() {
    this.calls.push(["getAuthenticatedUser"]);
    return this.authenticatedUser;
  }

  async getComment(repo, id) {
    this.calls.push(["getComment", repo, id]);
    assert.equal(repo, SHADOW_REPO);
    if (this.commentResponse) {
      return this.commentResponse;
    }
    const comment = this.shadowComments.find((candidate) => candidate.id === id);
    assert.ok(comment, `missing fake comment ${id}`);
    return comment;
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
    return repo === SHADOW_REPO
      ? dispatchComment({ id: 99, body })
      : { id: 99, body, user: this.authenticatedUser };
  }

  async updateComment(repo, commentId, body) {
    this.calls.push(["updateComment", repo, commentId, body]);
    return { id: commentId, body, user: this.authenticatedUser };
  }

  async updateIssueState(repo, issue, state) {
    this.calls.push(["updateIssueState", repo, issue, state]);
    assert.equal(repo, SHADOW_REPO);
    assert.equal(issue, SHADOW_ISSUE);
    this.shadowIssue.state = state;
    return this.shadowIssue;
  }
}

function runBridge(api, overrides = {}) {
  return bridge({
    api, sourceRepo: SOURCE_REPO, sourceIssue: SOURCE_ISSUE,
    triggerComment: sourceMarker(), trustedSourceActorId: TRUSTED_SOURCE_ACTOR_ID, ...overrides,
  });
}

function runResolve(api, overrides = {}) {
  if (!api.sourceComments.some((comment) => String(comment.body).includes(REPORT_MARKER))) {
    api.sourceComments.push({
      id: 2, body: `${REPORT_MARKER}\n${REPORT_PROVENANCE} comment ${BINDING_A} -->`,
      user: { id: DISPATCHER_ID },
    });
  }
  return resolveTrigger({
    api, repo: SHADOW_REPO, issue: SHADOW_ISSUE,
    triggerComment: SHADOW_DISPATCH, triggerCommentId: 5,
    trustedSourceActorId: TRUSTED_SOURCE_ACTOR_ID, ...overrides,
  });
}

function runReconcile(api, sourceIssues = [SOURCE_ISSUE]) {
  return reconcile({
    api, sourceRepo: SOURCE_REPO, sourceIssues, trustedSourceActorId: TRUSTED_SOURCE_ACTOR_ID,
  });
}

function unmappedApi(overrides = {}) {
  return new FakeApi({
    shadowConfig: { sourceRepo: SOURCE_REPO, shadowRepo: SHADOW_REPO, issueMap: {} }, ...overrides,
  });
}

test("source bridge emits one deterministic trigger without mutating shadow state", async () => {
  const api = new FakeApi({
    shadowComments: [dispatchComment({ user: { id: OTHER_USER_ID } })],
  });
  const result = await runBridge(api);

  assert.deepEqual(result, {
    bound: false, binding: BINDING_A, attemptId: "123",
    shadowIssue: SHADOW_ISSUE, shadowRepo: SHADOW_REPO,
    dispatchCreated: true, reason: "bridged",
  });
  assert.ok(api.calls.some(
    (call) => call[0] === "createComment" && call[3] === SHADOW_DISPATCH,
  ));
  assert.ok(api.calls.some(
    (call) =>
      call[0] === "createComment" && call[1] === SOURCE_REPO &&
      call[3].includes(REPORT_MARKER),
  ));
  const report = api.calls.filter((call) => call[1] === SOURCE_REPO && ["createComment", "updateComment"].includes(call[0])).at(-1);
  assert.ok(report[3].includes("waiting to complete"));
  assert.equal(writes(api).some((call) => ["ensureLabel", "addLabels", "removeLabel", "deleteLabel", "updateIssueState"].includes(call[0])), false);
});

test("bridge retry is idempotent for trusted dispatch and report comments", async () => {
  const api = new FakeApi({
    shadowIssue: {
      body: `*Shadow of [${SOURCE_REPO}#${SOURCE_ISSUE}](url)*`,
      labels: [{ name: BINDING_A }, { name: "STATUS: In Progress" }],
    },
    shadowComments: [dispatchComment()],
  });

  const first = await runBridge(api);
  const reportCall = api.calls.find(
    (call) => call[0] === "createComment" && call[1] === SOURCE_REPO,
  );
  api.sourceComments.push({
    id: 2, body: reportCall[3], user: { id: DISPATCHER_ID, login: "workflow-bot" },
  });
  api.calls = [];
  const result = await runBridge(api);
  assert.equal(result.dispatchCreated, false);
  assert.equal(api.calls.some((call) => call[0] === "createComment"), false);
  assert.deepEqual(writes(api), []);
  assert.equal(first.dispatchCreated, false);
});

test("bridge preserves one trusted but unclaimed in-flight dispatch", async () => {
  const api = new FakeApi({ shadowComments: [dispatchComment()] });
  assert.equal((await runBridge(api)).dispatchCreated, false);
  assert.deepEqual(shadowWrites(api), []);
  api.shadowComments[0].created_at = "2000-01-01T00:00:00Z"; api.sourceComments.push({ id: 2, body: createdFor(api, SOURCE_REPO)[3], user: { id: DISPATCHER_ID } });
  api.calls = [];
  assert.equal((await runBridge(api, { reconcileOnly: true })).dispatchCreated, true);
  assert.deepEqual(shadowWrites(api).map(([method]) => method), ["createComment"]);
});

test("missing marker remains unbound and creates only a trusted source report", async () => {
  const api = new FakeApi({
    sourceComments: [{ id: 1, body: "ordinary", user: { id: OTHER_USER_ID } }],
  });
  const result = await runBridge(api);
  assert.deepEqual(result, {
    bound: false, binding: "", attemptId: "", shadowIssue: 0, shadowRepo: "",
    dispatchCreated: false, reason: "no_praxis_marker",
  });
  assert.deepEqual(writes(api).map((call) => call.slice(0, 3)), [
    ["createComment", SOURCE_REPO, SOURCE_ISSUE],
  ]);
});

test("missing mapping is pending and sync reconciliation delivers exactly once", async () => {
  const api = unmappedApi();
  const pending = await runBridge(api);
  assert.equal(pending.reason, "pending_shadow_mapping");
  assert.equal(pending.dispatchCreated, false);
  assert.deepEqual(shadowWrites(api), []);

  const reportCall = createdFor(api, SOURCE_REPO);
  assert.ok(reportCall[3].includes(`${REPORT_PROVENANCE} comment ${BINDING_A} -->`));
  api.sourceComments.push({
    id: 2, body: reportCall[3], user: { id: DISPATCHER_ID },
  });
  api.sourceIssue.labels = [{ name: "AUTOFIX: Ready" }];
  api.calls = [];
  assert.equal((await runBridge(api, { triggerComment: "" })).reason, "pending_shadow_mapping");
  assert.equal(api.calls.some((call) => call[0] === "updateComment"), false);
  api.shadowConfig.issueMap[String(SOURCE_ISSUE)] = SHADOW_ISSUE;
  api.calls = [];

  const first = await runReconcile(api);
  assert.deepEqual(first, {
    dispatchCreated: true,
    reason: "reconciled",
    reconciled: 1,
  });
  const shadowDispatchCall = createdFor(api, SHADOW_REPO);
  api.shadowComments.push(dispatchComment({ id: 6, body: shadowDispatchCall[3] }));
  api.shadowIssue.labels = [
    { name: BINDING_A },
    { name: "STATUS: In Progress" },
  ];
  api.calls = [];

  const retry = await runReconcile(api);
  assert.equal(retry.dispatchCreated, false);
  assert.deepEqual(shadowWrites(api), []);
  assert.ok(writes(api).at(-1)[3].includes("handed this attempt"));
});

test("resolve rechecks Ready and Skip after bridge before claiming", async () => {
  for (const [triggerComment, labels, expectedReason] of [
    ["", [{ name: "AUTOFIX: Ready" }], "source_ready_removed"],
    [sourceMarker(), [], "source_autopilot_skipped"],
    [sourceMarker(), [], "source_issue_closed"],
  ]) {
    const api = new FakeApi({ sourceIssue: { labels } });
    await runBridge(api, { triggerComment });
    api.sourceComments.push({
      id: 2, body: createdFor(api, SOURCE_REPO)[3], user: { id: DISPATCHER_ID },
    });
    api.shadowComments.push(dispatchComment({ body: createdFor(api, SHADOW_REPO)[3] }));
    api.sourceIssue.labels = expectedReason === "source_autopilot_skipped"
      ? [{ name: "AUTOPILOT: Skip" }] : [];
    api.sourceIssue.state = expectedReason === "source_issue_closed" ? "closed" : "open";
    api.calls = [];

    const result = await runResolve(api);
    assert.equal(result.stale, true);
    assert.equal(result.reason, expectedReason);
    assert.deepEqual(shadowWrites(api), []);
  }
});

test("reconcile cancels after Ready removal, Skip, or source closure", async () => {
  for (const [triggerComment, initialLabels, currentLabels, mode, state = "open"] of [
    ["", [{ name: "AUTOFIX: Ready" }], [], "ready"],
    [sourceMarker(), [], [{ name: "AUTOPILOT: Skip" }], "comment"],
    [sourceMarker(), [], [], "comment", "closed"],
  ]) {
    const api = unmappedApi({ sourceIssue: { labels: initialLabels } });
    await runBridge(api, { triggerComment });
    const report = createdFor(api, SOURCE_REPO);
    assert.ok(report[3].includes(`${REPORT_PROVENANCE} ${mode} ${BINDING_A} -->`));
    api.sourceComments.push({ id: 2, body: report[3], user: { id: DISPATCHER_ID } });
    api.shadowConfig.issueMap[String(SOURCE_ISSUE)] = SHADOW_ISSUE;
    api.sourceIssue.labels = currentLabels;
    api.sourceIssue.state = state;
    api.calls = [];
    assert.equal((await runReconcile(api)).dispatchCreated, false);
    assert.deepEqual(shadowWrites(api), []);
    assert.equal(writes(api).at(-1)[3].includes("waiting to complete"), false);
  }
});

test("reconcile ignores unmarked, foreign, and malformed provenance", async () => {
  const marker = { id: 1, body: sourceMarker(), user: { id: TRUSTED_SOURCE_ACTOR_ID } };
  for (const report of [
    null,
    { body: `${REPORT_MARKER}\n${REPORT_PROVENANCE} comment ${BINDING_A} -->`,
      user: { id: FOREIGN_SOURCE_ACTOR_ID } },
    { body: `${REPORT_MARKER}\n${REPORT_PROVENANCE} forged ${BINDING_A} -->`,
      user: { id: DISPATCHER_ID } },
  ]) {
    const sourceComments = [marker, ...(report ? [{ id: 2, ...report }] : [])];
    const api = new FakeApi({ sourceComments });
    const result = await runReconcile(api);
    assert.equal(result.dispatchCreated, false);
    assert.deepEqual(writes(api), []);
  }
});

test("foreign source report preplay is never updated", async () => {
  const foreignBody = `${REPORT_MARKER}\nforeign preplay`;
  const api = new FakeApi({
    sourceComments: [
      { id: 1, body: sourceMarker(), user: { id: TRUSTED_SOURCE_ACTOR_ID } },
      { id: 2, body: foreignBody, user: { id: FOREIGN_SOURCE_ACTOR_ID } },
    ],
  });
  await runBridge(api);
  assert.equal(api.calls.some((call) => call[0] === "updateComment" && call[2] === 2), false);
  assert.ok(api.calls.some((call) =>
    call[0] === "createComment" && call[1] === SOURCE_REPO &&
    call[3].includes(REPORT_MARKER)));
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
    runBridge(api),
    /shadow_source_repo_mismatch/,
  );
  assert.deepEqual(writes(api), []);
});

test("bridge rejects invalid source or shadow state before any write", async () => {
  const shadow = {
    number: SHADOW_ISSUE,
    state: "locked",
    body: `*Shadow of [${SOURCE_REPO}#${SOURCE_ISSUE}](url)*`,
    labels: [],
  };
  for (const [overrides, error] of [
    [{ sourceIssue: { state: "locked" } }, /source_issue_not_open:locked/],
    [{ shadowIssue: shadow }, /shadow_issue_state_invalid:locked/],
  ]) {
    const api = new FakeApi(overrides);
    await assert.rejects(
      runBridge(api),
      error,
    );
    assert.deepEqual(writes(api), []);
  }
});

test("resolve claims a new attempt, reopens shadow, and clears only frozen state", async () => {
  const api = new FakeApi({
    shadowIssue: {
      number: SHADOW_ISSUE,
      state: "closed",
      body: `*Shadow of [${SOURCE_REPO}#${SOURCE_ISSUE}](url)*`,
      labels: [{ name: BINDING_B }, { name: "STATUS: In QA" }, { name: "bug" }],
    },
    repoLabels: [{ name: BINDING_B }],
    issues: [{ number: SHADOW_ISSUE, labels: [{ name: BINDING_B }] }],
    shadowComments: [dispatchComment()],
  });

  const result = await runResolve(api);
  assert.equal(result.stale, false);
  assert.equal(result.binding, BINDING_A);
  assert.deepEqual(
    writes(api).map(([method]) => method),
    ["updateIssueState", "removeLabel", "deleteLabel", "removeLabel",
      "ensureLabel", "addLabels", "updateComment"],
  );
  assert.deepEqual(writes(api)[0], ["updateIssueState", SHADOW_REPO, SHADOW_ISSUE, "open"]);
  assert.ok(writes(api).at(-1)[3].includes("handed this attempt"));
  assert.equal(api.calls.some((call) => call.includes("bug")), false);
});

test("resolve rejects replay of A1 after trusted source marker advances to A2", async () => {
  const api = new FakeApi({
    sourceComments: [
      {
        id: 1,
        body: sourceMarker(),
        user: { id: TRUSTED_SOURCE_ACTOR_ID },
      },
      {
        id: 2,
        body: sourceMarker({ attempt_id: "124", nonce: NONCE_B }),
        user: { id: TRUSTED_SOURCE_ACTOR_ID },
      },
    ],
    shadowComments: [dispatchComment()],
  });
  const result = await runResolve(api);
  assert.equal(result.stale, true);
  assert.equal(result.reason, "stale_source_dispatch");
  assert.deepEqual(writes(api), []);
});

test("malformed machine-looking label blocks resolve claim and all writes", async () => {
  const api = new FakeApi({
    shadowIssue: {
      number: SHADOW_ISSUE,
      body: `*Shadow of [${SOURCE_REPO}#${SOURCE_ISSUE}](url)*`,
      labels: [{ name: "praxis/a-malformed" }],
    },
    shadowComments: [dispatchComment()],
  });
  await assert.rejects(
    runResolve(api),
    /malformed_praxis_binding/,
  );
  assert.deepEqual(writes(api), []);
});

test("orphan budget fails closed before resolve creates a new binding", async () => {
  const repoLabels = Array.from({ length: ORPHAN_BUDGET }, (_, index) => ({
    name: bindingFor(String(index + 1000), NONCE_B),
  }));
  const api = new FakeApi({
    repoLabels,
    issues: [],
    shadowComments: [dispatchComment()],
  });
  await assert.rejects(
    runResolve(api),
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
    shadowComments: [dispatchComment()],
  });

  await assert.rejects(
    runResolve(api),
    /binding_orphan_budget_exceeded/,
  );
  assert.deepEqual(writes(api), []);
});

test("resolve accepts an authenticated trigger for the already-current binding", async () => {
  const body = formatShadowDispatch({
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
    shadowComments: [dispatchComment({ body })],
  });
  assert.deepEqual(
    await runResolve(api, { triggerComment: body }),
    {
      bound: true,
      binding: BINDING_A,
      attemptId: "123",
      stale: false,
      reason: "bound_trigger",
    },
  );
  assert.deepEqual(shadowWrites(api), []);
  assert.ok(writes(api).at(-1)[3].includes("handed this attempt"));
});

test("resolve rejects mismatched event comment identity", async () => {
  for (const [triggerCommentId, comment, error] of [
    ["", dispatchComment(), /trigger_comment_id_required/],
    [5, dispatchComment({ id: 6 }), /trigger_comment_id_mismatch/],
    [5, dispatchComment({ body: `${SHADOW_DISPATCH}\nreplayed` }), /trigger_comment_body_mismatch/],
    [5, dispatchComment({
      issue_url: `${SHADOW_ISSUE_URL}99`,
    }), /trigger_comment_issue_mismatch/],
  ]) {
    const api = new FakeApi({
      shadowIssue: { labels: [{ name: BINDING_A }] },
      shadowComments: [comment],
      commentResponse: comment,
    });
    await assert.rejects(resolveTrigger({
      api, repo: SHADOW_REPO, issue: SHADOW_ISSUE,
      triggerComment: SHADOW_DISPATCH, triggerCommentId,
      trustedSourceActorId: TRUSTED_SOURCE_ACTOR_ID,
    }), error);
    assert.deepEqual(writes(api), []);
  }
});

test("resolve ignores copied or already-consumed dispatches", async () => {
  for (const [user, status, reason] of [
    [{ id: OTHER_USER_ID }, "", "untrusted_dispatch_actor"],
    [{ id: DISPATCHER_ID }, "STATUS: In Progress", "attempt_already_started"],
  ]) {
    const api = new FakeApi({
      shadowIssue: {
        body: `*Shadow of [${SOURCE_REPO}#${SOURCE_ISSUE}](url)*`,
        labels: [{ name: BINDING_A }, ...(status ? [{ name: status }] : [])],
      },
      shadowComments: [dispatchComment({ user })],
    });
    const result = await runResolve(api);
    assert.equal(result.stale, true);
    assert.equal(result.reason, reason);
    assert.deepEqual(writes(api), []);
  }
});

test("reconcile validates its full bounded issue list before any write", async () => {
  for (const sourceIssues of [
    [SOURCE_ISSUE, 0],
    Array.from({ length: ORPHAN_BUDGET + 1 }, (_, index) => index + 1),
  ]) {
    const api = new FakeApi();
    await assert.rejects(
      runReconcile(api, sourceIssues),
      /reconcile_issue/,
    );
    assert.deepEqual(writes(api), []);
    assert.deepEqual(api.calls, []);
  }
});

test("reconcile continues after one issue fails, then reports the batch failure", async () => {
  const api = new FakeApi({ sourceComments: [
    { id: 1, body: sourceMarker(), user: { id: TRUSTED_SOURCE_ACTOR_ID } },
    { id: 2, body: `${REPORT_MARKER}\n${REPORT_PROVENANCE} comment ${BINDING_A} -->`,
      user: { id: DISPATCHER_ID } },
  ] });
  const listComments = api.listComments.bind(api);
  api.listComments = async (repo, issue) => {
    if (repo === SOURCE_REPO && issue === 43) throw new Error("broken_issue");
    return listComments(repo, issue);
  };
  await assert.rejects(runReconcile(api, [43, SOURCE_ISSUE]), /43:broken_issue/);
  assert.ok(createdFor(api, SHADOW_REPO), "later issue was not reconciled");
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
  assert.deepEqual(writes(api).slice(0, 2).map(([method]) => method), ["deleteLabel", "removeLabel"]);

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
  await api.getAuthenticatedUser();
  await api.getComment(SHADOW_REPO, 5);
  await api.updateComment(SOURCE_REPO, 9, "updated");
  await api.updateIssueState(SHADOW_REPO, SHADOW_ISSUE, "open");
  assert.deepEqual(
    requests.map(([url, method]) => [new URL(url).searchParams.get("page"), method]),
    [
      ["1", "GET"],
      ["2", "GET"],
      ["1", "GET"],
      ["2", "GET"],
      ["1", "GET"],
      ["2", "GET"],
      [null, "GET"],
      [null, "GET"],
      [null, "PATCH"],
      [null, "PATCH"],
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
