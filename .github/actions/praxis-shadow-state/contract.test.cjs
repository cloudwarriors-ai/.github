const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  BINDING_RE,
  ORPHAN_BUDGET,
  STATUS_BY_PHASE,
  bindingFor,
  classifyBindingState,
  decodeAttemptId,
  encodeAttemptId,
  formatShadowDispatch,
  parseBinding,
  parseShadowDispatch,
  selectSourceDispatch,
  strictBindingNames,
} = require("./contract.cjs");

const NONCE_A = "0123456789abcdef0123456789abcdef";
const NONCE_B = "fedcba9876543210fedcba9876543210";

function sourceMarker({
  repo = "cloudwarriors-ai/example",
  issue = 42,
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

test("attempt ids use canonical positive base36", () => {
  assert.equal(encodeAttemptId("1"), "1");
  assert.equal(encodeAttemptId("35"), "z");
  assert.equal(encodeAttemptId("36"), "10");
  assert.equal(encodeAttemptId("123"), "3f");
  assert.equal(decodeAttemptId("3f"), "123");

  for (const value of ["", "0", "-1", "01", "A", "3F", "!", "zzzzzzzzzzzzzz"]) {
    assert.throws(() => decodeAttemptId(value));
  }
  for (const value of ["", "0", "-1", "1.5", "abc"]) {
    assert.throws(() => encodeAttemptId(value));
  }
});

test("binding retains 96 nonce bits and rejects non-canonical forms", () => {
  const binding = bindingFor("123", NONCE_A);
  assert.equal(binding, "praxis/a3f-0123456789abcdef01234567");
  assert.deepEqual(parseBinding(binding), {
    attemptId: "123",
    noncePrefix: "0123456789abcdef01234567",
  });
  assert.ok(binding.length < 50);

  for (const value of [
    "praxis/a0-0123456789abcdef01234567",
    "praxis/a03f-0123456789abcdef01234567",
    "praxis/a3F-0123456789abcdef01234567",
    "praxis/a3f-0123456789abcdef0123456",
    "praxis/a3f-0123456789abcdef0123456g",
    "praxis/a3f-0123456789ABCDEF01234567",
    "praxis/attempt-123",
  ]) {
    assert.equal(parseBinding(value), null, value);
  }
  assert.throws(() => bindingFor("123", "short"));
});

test("latest valid source marker wins and byte-identical retries collapse", () => {
  const selected = selectSourceDispatch(
    [
      { id: 10, body: sourceMarker({ attempt_id: "122", nonce: NONCE_B }) },
      { id: 11, body: sourceMarker() },
      { id: 12, body: sourceMarker() },
    ],
    { repo: "cloudwarriors-ai/example", issue: 42 },
  );
  assert.equal(selected.attemptId, "123");
  assert.equal(selected.nonce, NONCE_A);
  assert.equal(selected.binding, bindingFor("123", NONCE_A));
  assert.deepEqual(selected.commentIds, [11, 12]);
});

test("malformed or mismatched Praxis source evidence fails closed", () => {
  assert.throws(
    () =>
      selectSourceDispatch(
        [{ id: 1, body: "<!-- praxis-dispatch {nope} -->" }],
        { repo: "cloudwarriors-ai/example", issue: 42 },
      ),
    /malformed_praxis_dispatch/,
  );
  assert.throws(
    () =>
      selectSourceDispatch(
        [{ id: 1, body: sourceMarker({ repo: "cloudwarriors-ai/other" }) }],
        { repo: "cloudwarriors-ai/example", issue: 42 },
      ),
    /source_marker_mismatch/,
  );
  assert.equal(
    selectSourceDispatch([{ id: 1, body: "ordinary comment" }], {
      repo: "cloudwarriors-ai/example",
      issue: 42,
    }),
    null,
  );
});

test("shadow dispatch comment is deterministic and strictly parsed", () => {
  const binding = bindingFor("123", NONCE_A);
  const body = formatShadowDispatch({
    binding,
    sourceRepo: "cloudwarriors-ai/example",
    sourceIssue: 42,
  });
  assert.equal(
    body,
    '@claude\n<!-- praxis-shadow-dispatch {"binding":"praxis/a3f-0123456789abcdef01234567","source_issue":42,"source_repo":"cloudwarriors-ai/example"} -->',
  );
  assert.deepEqual(parseShadowDispatch(body), {
    binding,
    sourceIssue: 42,
    sourceRepo: "cloudwarriors-ai/example",
  });
  assert.equal(parseShadowDispatch("@claude please help"), null);
  assert.throws(
    () => parseShadowDispatch("@claude\n<!-- praxis-shadow-dispatch {bad} -->"),
    /malformed_shadow_dispatch/,
  );
});

test("binding state distinguishes current, stale, missing, malformed, and conflicting", () => {
  const current = bindingFor("123", NONCE_A);
  const old = bindingFor("122", NONCE_B);

  assert.deepEqual(classifyBindingState(["bug", current], current), {
    state: "current",
    current,
  });
  assert.deepEqual(classifyBindingState(["bug"], current), {
    state: "stale",
    current: "",
  });
  assert.deepEqual(classifyBindingState(["bug", old], current), {
    state: "stale",
    current: old,
  });
  assert.throws(
    () => classifyBindingState([current, old], current),
    /multiple_praxis_bindings/,
  );
  assert.throws(
    () => classifyBindingState(["praxis/a-not-valid"], current),
    /malformed_praxis_binding/,
  );
});

test("cleanup candidates and phases are frozen", () => {
  const current = bindingFor("123", NONCE_A);
  const old = bindingFor("122", NONCE_B);
  assert.deepEqual(strictBindingNames(["bug", old, current]), [old, current]);
  assert.throws(() => strictBindingNames(["praxis/a-malformed"]));
  assert.deepEqual(STATUS_BY_PHASE, {
    "follow-up-required": "STATUS: Follow-Up Required",
    "in-progress": "STATUS: In Progress",
    "in-qa": "STATUS: In QA",
  });
  assert.equal(ORPHAN_BUDGET, 100);
});

test("workflow wiring carries the binding and freezes one concurrency key", () => {
  const root = path.resolve(__dirname, "../../..");
  const intake = fs.readFileSync(
    path.join(root, ".github/workflows/reusable-autopilot-intake.yml"),
    "utf8",
  );
  const runner = fs.readFileSync(
    path.join(root, ".github/workflows/reusable-autopilot-runner.yml"),
    "utf8",
  );
  const pipeline = fs.readFileSync(
    path.join(root, "workflow-templates/cloudwarriors-shadow-pipeline.yml"),
    "utf8",
  );
  const installedRunner = fs.readFileSync(
    path.join(root, "workflow-templates/shadow-autopilot-runner.yml"),
    "utf8",
  );
  const sync = fs.readFileSync(
    path.join(root, ".github/workflows/reusable-shadow-sync.yml"),
    "utf8",
  );

  const concurrency = "group: autopilot-issue-${{ inputs.issue_number }}-${{ github.repository }}";
  assert.ok(intake.includes(concurrency));
  assert.ok(runner.includes(concurrency));
  assert.ok(pipeline.includes("trigger_comment: ${{ github.event.comment.body || '' }}"));
  assert.ok(intake.includes("trigger_comment:"));
  assert.ok(
    intake.includes(
      "trigger-comment: ${{ inputs.trigger_comment || github.event.comment.body || '' }}",
    ),
  );
  assert.ok(intake.includes("praxis_binding:"));
  assert.ok(installedRunner.includes("praxis_binding:"));
  assert.ok(runner.includes("praxis_binding:"));
  assert.ok(sync.includes(`PRAXIS_BINDING_PATTERN: ${BINDING_RE.source}`));
});

test("workflow wiring blocks source fallthrough and stale status mutation", () => {
  const root = path.resolve(__dirname, "../../..");
  const intake = fs.readFileSync(
    path.join(root, ".github/workflows/reusable-autopilot-intake.yml"),
    "utf8",
  );
  const runner = fs.readFileSync(
    path.join(root, ".github/workflows/reusable-autopilot-runner.yml"),
    "utf8",
  );
  const sync = fs.readFileSync(
    path.join(root, ".github/workflows/reusable-shadow-sync.yml"),
    "utf8",
  );

  const blocks = new Map(
    intake
      .split(/\n      - name: /)
      .slice(1)
      .map((block) => [block.split("\n", 1)[0].replaceAll('"', ""), block]),
  );
  for (const name of [
    "Check kill switch",
    "Exit if disabled",
    "Validate issue state",
    "Setup Node.js",
    "Fetch shared scripts",
    "Resolve issue context",
    "Handle unresolvable track",
    "Set STATUS label",
    "Set bound STATUS to In Progress",
    "Dispatch runner",
    "Post progress comment",
    "Cross-post shadow run to source issue",
  ]) {
    const block = blocks.get(name);
    assert.ok(block, `missing intake step: ${name}`);
    assert.ok(
      block.includes("steps.shadow_guard.outputs.blocked != 'true'"),
      `${name} lacks source fallthrough guard`,
    );
    assert.ok(
      block.includes("steps.praxis_trigger.outputs.stale != 'true'"),
      `${name} lacks stale-attempt guard`,
    );
  }

  assert.ok(blocks.get("Bridge Praxis dispatch to shadow repo").includes("blocked == 'true'"));
  assert.equal(intake.includes("Shadow-enabled source repo — execution blocked"), false);
  assert.ok(
    intake.indexOf("Set bound STATUS to In Progress") <
      intake.indexOf("- name: Dispatch runner"),
  );
  assert.ok(
    blocks.get("Set STATUS label").includes("steps.praxis_trigger.outputs.bound != 'true'"),
  );
  assert.ok(
    blocks.get("Dispatch runner").includes(
      "steps.praxis_in_progress.outputs.applied == 'true'",
    ),
  );

  for (const phase of ["phase: in-progress", "phase: in-qa", "phase: follow-up-required"]) {
    assert.ok(`${intake}\n${runner}`.includes(phase), `missing ${phase}`);
  }
  assert.ok(runner.includes("inputs.praxis_binding == ''"));
  assert.ok(runner.includes("inputs.praxis_binding != ''"));
  for (const output of [
    "steps.praxis_success_status.outputs.applied == 'true'",
    "steps.praxis_already_fixed_status.outputs.applied == 'true'",
    "steps.praxis_failure_status.outputs.applied == 'true'",
  ]) {
    assert.ok(runner.includes(output), `missing stale completion guard: ${output}`);
  }
  assert.ok(sync.includes("sourceState === 'open' ? machinePraxisLabels : []"));
  assert.ok(sync.includes("if (sourceState !== 'open')"));
  assert.ok(sync.includes("github.rest.issues.deleteLabel"));
  assert.ok(sync.includes("malformed Praxis binding label(s)"));
  assert.ok(sync.includes("has multiple Praxis bindings"));
});
