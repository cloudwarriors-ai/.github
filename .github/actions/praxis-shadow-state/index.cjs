"use strict";

const fs = require("node:fs");

const {
  ORPHAN_BUDGET,
  STATUS_BY_PHASE,
  classifyBindingState,
  formatShadowDispatch,
  labelName,
  parseBinding,
  parseShadowDispatch,
  parseShadowSource,
  selectSourceDispatch,
  strictBindingNames,
} = require("./contract.cjs");

const FROZEN_STATUSES = Object.freeze(Object.values(STATUS_BY_PHASE));
const REPORT_MARKER = "<!-- AUTOPILOT_SHADOW_GUARD -->";
const REPORT_PROVENANCE = "<!-- AUTOPILOT_SHADOW_TRIGGER_V1";
const RECONCILE_BUDGET = 100;

function issueLabels(issue) {
  return (issue && issue.labels ? issue.labels : []).map(labelName).filter(Boolean);
}

function pairedShadowRepo(sourceRepo) {
  const [owner, name, extra] = String(sourceRepo || "").split("/");
  if (!owner || !name || extra || name.endsWith("-shadow")) {
    throw new Error("invalid_source_repo");
  }
  return `${owner}/${name}-shadow`;
}

function expectedShadowRepo(sourceRepo) {
  return pairedShadowRepo(sourceRepo);
}

function triggerResult(parsed, stale, reason) {
  return {
    bound: true,
    binding: parsed.binding,
    attemptId: parseBinding(parsed.binding).attemptId,
    stale,
    reason,
  };
}

function formatReportProvenance({ mode, binding }) {
  return `${REPORT_PROVENANCE} ${mode} ${binding} -->`;
}

function parseReportProvenance(report) {
  const lines = String(report && report.body || "").split("\n")
    .filter((line) => line.startsWith(REPORT_PROVENANCE));
  if (lines.length !== 1) return null;
  const match = lines[0].match(
    /^<!-- AUTOPILOT_SHADOW_TRIGGER_V1 (ready|comment) (praxis\/a[^ ]+) -->$/,
  );
  return match && parseBinding(match[2])
    ? { mode: match[1], binding: match[2] }
    : null;
}

function bridgeReportBody(result, provenance) {
  const header = [REPORT_MARKER, ...(provenance ? [formatReportProvenance(provenance)] : [])];
  if (result.reason === "bridged") {
    const shadowUrl = `https://github.com/${result.shadowRepo}/issues/${result.shadowIssue}`;
    return [
      ...header, "**Praxis handed this attempt to the shadow Autofix pipeline.**", "",
      `Execution issue: [${result.shadowRepo}#${result.shadowIssue}](${shadowUrl})`,
      "", "The source repository will not execute this fix. Current state is carried by the bound labels on the shadow issue.",
    ].join("\n");
  }
  if (["pending_shadow_mapping", "pending_shadow_dispatch"].includes(result.reason)) {
    return [...header, "**Praxis is waiting to complete the shadow Autofix handoff.**", "",
      "Shadow sync will retry this handoff automatically. No source-side Autofix was started.",
    ].join("\n");
  }
  const canceledDetail = {
    source_ready_removed: "`AUTOFIX: Ready` is no longer present.",
    source_autopilot_skipped: "`AUTOPILOT: Skip` is present.",
    source_issue_closed: "The source issue is closed." }[result.reason];
  if (canceledDetail) {
    return [
      REPORT_MARKER, "**Praxis canceled this pending shadow handoff.**", "",
      canceledDetail,
      "A fresh source event is required before this attempt can be handed off.",
    ].join("\n");
  }
  return [
    REPORT_MARKER, "**Autopilot skipped on the source repository:** shadow-first execution is enabled.", "",
    "No valid trusted Praxis dispatch marker exists for this issue yet. Praxis must create the attempt before Autofix can run in the shadow repository.",
  ].join("\n");
}

async function upsertTrustedReport({
  api, sourceRepo, sourceIssue, comments, authenticatedId, result, provenance = null,
}) {
  const body = bridgeReportBody(result, provenance);
  const existing = (comments || []).find(
    (comment) =>
      Number(comment?.user?.id) === authenticatedId &&
      String(comment && comment.body || "").includes(REPORT_MARKER),
  );
  if (!existing) return api.createComment(sourceRepo, sourceIssue, body);
  if (existing.body === body) return existing;
  return api.updateComment(sourceRepo,
    positiveInteger(existing.id, "source_report_comment_id_invalid"), body);
}

async function cleanup({ api, repo, issue, bindings }) {
  const values = [...new Set(bindings || [])];
  for (const binding of values) {
    if (!parseBinding(binding)) {
      throw new Error(`refusing_non_binding_cleanup:${binding}`);
    }
  }
  for (const binding of values) {
    await api.deleteLabel(repo, binding);
    await api.removeLabel(repo, issue, binding);
  }
  return { removed: values };
}

function orphanedBindings(repoLabels, issues) {
  const definitions = strictBindingNames(repoLabels);
  const active = new Set();
  for (const issue of issues || []) {
    for (const binding of strictBindingNames(issue.labels || [])) {
      active.add(binding);
    }
  }
  return definitions.filter((binding) => !active.has(binding));
}

async function bridge({
  api,
  sourceRepo,
  sourceIssue,
  triggerComment = "",
  trustedSourceActorId,
  reconcileOnly = false,
}) {
  const comments = await api.listComments(sourceRepo, sourceIssue);
  const dispatch = selectSourceDispatch(comments, {
    repo: sourceRepo,
    issue: sourceIssue,
  }, trustedSourceActorId);
  const authenticated = await api.getAuthenticatedUser();
  const authenticatedId = positiveInteger(
    authenticated && authenticated.id, "authenticated_user_invalid",
  );
  const trustedReport = (comments || []).find(
    (comment) =>
      Number(comment?.user?.id) === authenticatedId &&
      String(comment && comment.body || "").includes(REPORT_MARKER),
  );
  if (!dispatch) {
    const result = {
      bound: false, binding: "", attemptId: "", shadowIssue: 0, shadowRepo: "",
      dispatchCreated: false, reason: "no_praxis_marker",
    };
    if (!reconcileOnly) await upsertTrustedReport({
      api, sourceRepo, sourceIssue, comments, authenticatedId, result,
    });
    return result;
  }

  const recordedProvenance = parseReportProvenance(trustedReport);
  const provenance = reconcileOnly || recordedProvenance?.binding === dispatch.binding
    ? recordedProvenance
    : {
      mode: String(triggerComment).trim() ? "comment" : "ready",
      binding: dispatch.binding,
    };
  if (!provenance || provenance.binding !== dispatch.binding) {
    return {
      bound: false, binding: dispatch.binding, attemptId: dispatch.attemptId,
      shadowIssue: 0, shadowRepo: "", dispatchCreated: false,
      reason: "invalid_reconcile_provenance",
    };
  }

  const shadowRepo = pairedShadowRepo(sourceRepo);
  const config = await api.getJsonContent(shadowRepo, ".shadow/config.json");
  if (!config || config.sourceRepo !== sourceRepo) {
    throw new Error("shadow_source_repo_mismatch");
  }
  if (config.shadowRepo && config.shadowRepo !== shadowRepo) {
    throw new Error("shadow_repo_config_mismatch");
  }
  const shadowIssue = Number((config.issueMap || {})[String(sourceIssue)]);
  const validateSource = async () => {
    const source = await api.getIssue(sourceRepo, sourceIssue);
    if (source.state === "closed") return "source_issue_closed";
    if (source.state !== "open") {
      throw new Error(`source_issue_not_open:${source.state || "unknown"}`);
    }
    const labels = issueLabels(source);
    if (labels.includes("AUTOPILOT: Skip")) return "source_autopilot_skipped";
    if (provenance.mode === "ready" && !labels.includes("AUTOFIX: Ready")) {
      return "source_ready_removed";
    }
    return "";
  };
  const canceled = async (reason) => {
    const result = {
      bound: false, binding: dispatch.binding, attemptId: dispatch.attemptId,
      shadowIssue: Number.isSafeInteger(shadowIssue) ? shadowIssue : 0,
      shadowRepo, dispatchCreated: false, reason,
    };
    await upsertTrustedReport({
      api, sourceRepo, sourceIssue, comments, authenticatedId, result,
    });
    return result;
  };
  if (!Number.isSafeInteger(shadowIssue) || shadowIssue <= 0) {
    const reason = await validateSource();
    if (reason) return canceled(reason);
    const result = {
      bound: false, binding: dispatch.binding, attemptId: dispatch.attemptId,
      shadowIssue: 0, shadowRepo, dispatchCreated: false, reason: "pending_shadow_mapping",
    };
    await upsertTrustedReport({
      api, sourceRepo, sourceIssue, comments, authenticatedId, result, provenance,
    });
    return result;
  }

  const shadow = await api.getIssue(shadowRepo, shadowIssue);
  const footer = parseShadowSource(shadow.body);
  if (footer.repo !== sourceRepo || footer.issue !== Number(sourceIssue)) {
    throw new Error("shadow_footer_mismatch");
  }
  if (!["open", "closed"].includes(shadow.state)) {
    throw new Error(`shadow_issue_state_invalid:${shadow.state || "unknown"}`);
  }
  const shadowLabels = issueLabels(shadow);
  const shadowBindings = strictBindingNames(shadowLabels);
  if (shadowBindings.length > 1) {
    throw new Error("multiple_praxis_bindings");
  }

  const dispatchBody = formatShadowDispatch({
    binding: dispatch.binding,
    sourceRepo,
    sourceIssue,
  });
  const shadowComments = await api.listComments(shadowRepo, shadowIssue);
  const trustedDispatch = shadowComments.findLast(
    (comment) =>
      comment && comment.body === dispatchBody &&
      Number(comment.user && comment.user.id) === authenticatedId,
  );
  const claimed = shadowBindings[0] === dispatch.binding &&
    FROZEN_STATUSES.some((status) => shadowLabels.includes(status));
  const cancelReason = trustedDispatch && claimed ? "" : await validateSource();
  if (cancelReason) return canceled(cancelReason);
  const result = {
    bound: false, binding: dispatch.binding, attemptId: dispatch.attemptId,
    shadowIssue, shadowRepo, dispatchCreated: !trustedDispatch || (reconcileOnly && !claimed && Date.now() - Date.parse(trustedDispatch.created_at) >= 10 * 60 * 1000), reason: "bridged",
  };
  let report = trustedReport;
  if (result.dispatchCreated) {
    report = await upsertTrustedReport({ api, sourceRepo, sourceIssue, comments,
      authenticatedId, provenance,
      result: { ...result, dispatchCreated: false, reason: "pending_shadow_dispatch" },
    });
    await api.createComment(shadowRepo, shadowIssue, dispatchBody);
  }
  await upsertTrustedReport({ api, sourceRepo, sourceIssue,
    comments: [report, ...comments].filter(Boolean), authenticatedId, provenance,
    result: claimed ? result : { ...result, dispatchCreated: false, reason: "pending_shadow_dispatch" },
  });
  return result;
}

async function resolveTrigger({
  api,
  repo,
  issue,
  triggerComment,
  triggerCommentId,
  trustedSourceActorId,
}) {
  const parsed = parseShadowDispatch(triggerComment);
  if (!parsed) {
    const target = await api.getIssue(repo, issue);
    const existingBindings = strictBindingNames(issueLabels(target));
    if (existingBindings.length > 1) {
      throw new Error("multiple_praxis_bindings");
    }
    if (existingBindings.length === 1) {
      return {
        bound: false,
        binding: "",
        attemptId: "",
        stale: true,
        reason: "binding_requires_machine_trigger",
      };
    }
    return {
      bound: false,
      binding: "",
      attemptId: "",
      stale: false,
      reason: "unbound_trigger",
    };
  }
  if (repo !== expectedShadowRepo(parsed.sourceRepo)) {
    throw new Error("shadow_trigger_repo_mismatch");
  }

  const commentId = positiveInteger(triggerCommentId, "trigger_comment_id_required");
  const comment = await api.getComment(repo, commentId);
  if (Number(comment && comment.id) !== commentId) {
    throw new Error("trigger_comment_id_mismatch");
  }
  const expectedIssueUrl = `https://api.github.com/repos/${repo}/issues/${Number(issue)}`;
  if (!comment || comment.issue_url !== expectedIssueUrl) {
    throw new Error("trigger_comment_issue_mismatch");
  }
  if (comment.body !== triggerComment) {
    throw new Error("trigger_comment_body_mismatch");
  }
  const authenticated = await api.getAuthenticatedUser();
  const authenticatedId = positiveInteger(
    authenticated && authenticated.id, "authenticated_user_invalid",
  );
  if (Number(comment.user && comment.user.id) !== authenticatedId) {
    return triggerResult(parsed, true, "untrusted_dispatch_actor");
  }

  const sourceComments = await api.listComments(parsed.sourceRepo, parsed.sourceIssue);
  const currentDispatch = selectSourceDispatch(
    sourceComments,
    { repo: parsed.sourceRepo, issue: parsed.sourceIssue },
    trustedSourceActorId,
  );
  if (!currentDispatch || currentDispatch.binding !== parsed.binding) {
    return triggerResult(parsed, true, "stale_source_dispatch");
  }
  const trustedReport = sourceComments.find(
    (candidate) =>
      Number(candidate?.user?.id) === authenticatedId &&
      String(candidate && candidate.body || "").includes(REPORT_MARKER),
  );
  const provenance = parseReportProvenance(trustedReport);
  if (!provenance || provenance.binding !== parsed.binding) {
    return triggerResult(parsed, true, "invalid_source_provenance");
  }
  const config = await api.getJsonContent(repo, ".shadow/config.json");
  if (!config || config.sourceRepo !== parsed.sourceRepo) {
    throw new Error("shadow_source_repo_mismatch");
  }
  if (config.shadowRepo && config.shadowRepo !== repo) {
    throw new Error("shadow_repo_config_mismatch");
  }
  if (Number((config.issueMap || {})[String(parsed.sourceIssue)]) !== Number(issue)) {
    throw new Error("shadow_issue_mapping_mismatch");
  }
  const shadow = await api.getIssue(repo, issue);
  const footer = parseShadowSource(shadow.body);
  if (footer.repo !== parsed.sourceRepo || footer.issue !== parsed.sourceIssue) {
    throw new Error("shadow_footer_mismatch");
  }
  if (!["open", "closed"].includes(shadow.state)) {
    throw new Error(`shadow_issue_state_invalid:${shadow.state || "unknown"}`);
  }
  const labels = issueLabels(shadow);
  const currentBindings = strictBindingNames(labels);
  if (currentBindings.length > 1) {
    throw new Error("multiple_praxis_bindings");
  }
  const currentBinding = currentBindings[0] || "";
  if (FROZEN_STATUSES.some((status) => labels.includes(status))) {
    if (currentBinding === parsed.binding) {
      return triggerResult(parsed, true, "attempt_already_started");
    }
  }

  if (currentBinding !== parsed.binding) {
    const repoLabels = await api.listRepoLabels(repo);
    const issues = await api.listIssues(repo);
    const orphans = orphanedBindings(repoLabels, issues);
    const bindingExists = strictBindingNames(repoLabels).includes(parsed.binding);
    if (!bindingExists && orphans.length >= ORPHAN_BUDGET) {
      throw new Error(`binding_orphan_budget_exceeded:${orphans.length}`);
    }
  }

  const source = await api.getIssue(parsed.sourceRepo, parsed.sourceIssue);
  if (!["open", "closed"].includes(source.state)) {
    throw new Error(`source_issue_not_open:${source.state || "unknown"}`);
  }
  const sourceLabels = issueLabels(source);
  const cancelReason = source.state === "closed"
    ? "source_issue_closed"
    : sourceLabels.includes("AUTOPILOT: Skip")
    ? "source_autopilot_skipped"
    : provenance.mode === "ready" && !sourceLabels.includes("AUTOFIX: Ready")
      ? "source_ready_removed"
      : "";
  if (cancelReason) {
    await upsertTrustedReport({
      api, sourceRepo: parsed.sourceRepo, sourceIssue: parsed.sourceIssue,
      comments: sourceComments, authenticatedId, result: { reason: cancelReason },
    });
    return triggerResult(parsed, true, cancelReason);
  }

  if (shadow.state === "closed") {
    await api.updateIssueState(repo, issue, "open");
  }
  if (currentBinding !== parsed.binding) {
    // Clear stale human status before installing the new immutable binding so
    // no observer can attribute an old status to the new attempt.
    for (const status of FROZEN_STATUSES) {
      if (labels.includes(status)) {
        await api.removeLabel(repo, issue, status);
      }
    }
    if (currentBinding) {
      await cleanup({ api, repo, issue, bindings: [currentBinding] });
    }
    await api.ensureLabel(repo, parsed.binding);
    await api.addLabels(repo, issue, [parsed.binding]);
  }

  await upsertTrustedReport({
    api, sourceRepo: parsed.sourceRepo, sourceIssue: parsed.sourceIssue,
    comments: sourceComments, authenticatedId, provenance,
    result: { reason: "bridged", shadowRepo: repo, shadowIssue: Number(issue) },
  });
  return triggerResult(parsed, false, "bound_trigger");
}

async function reconcile({
  api,
  sourceRepo,
  sourceIssues,
  trustedSourceActorId,
}) {
  if (!Array.isArray(sourceIssues)) {
    throw new Error("reconcile_issues_must_be_array");
  }
  if (sourceIssues.length > RECONCILE_BUDGET) {
    throw new Error(`reconcile_issue_limit_exceeded:${sourceIssues.length}`);
  }
  const issues = sourceIssues.map((value) =>
    positiveInteger(value, `reconcile_issue_invalid:${value}`),
  );
  if (new Set(issues).size !== issues.length) {
    throw new Error("reconcile_issue_duplicates");
  }

  let dispatchCreated = false;
  const failures = [];
  for (const sourceIssue of issues) {
    try {
      const result = await bridge({
        api, sourceRepo, sourceIssue, trustedSourceActorId, reconcileOnly: true,
      });
      dispatchCreated ||= result.dispatchCreated;
    } catch (error) {
      failures.push(`${sourceIssue}:${error.message}`);
    }
  }
  if (failures.length) throw new Error(`reconcile_failed:${failures.join(",")}`);
  return {
    dispatchCreated,
    reason: "reconciled",
    reconciled: issues.length,
  };
}

async function transition({
  api,
  repo,
  issue,
  binding,
  phase,
  forceRelabel = false,
}) {
  const status = STATUS_BY_PHASE[phase];
  if (!status) {
    throw new Error(`unsupported_shadow_phase:${phase}`);
  }
  if (!parseBinding(binding)) {
    throw new Error("transition_requires_binding");
  }
  const shadow = await api.getIssue(repo, issue);
  const labels = issueLabels(shadow);
  const state = classifyBindingState(labels, binding);
  if (state.state !== "current") {
    return {
      applied: false,
      stale: true,
      reason: "stale_binding",
      status,
    };
  }

  for (const current of FROZEN_STATUSES) {
    if (current !== status && labels.includes(current)) {
      await api.removeLabel(repo, issue, current);
    }
  }
  const desiredPresent = labels.includes(status);
  if (desiredPresent && forceRelabel) {
    await api.removeLabel(repo, issue, status);
  }
  if (!desiredPresent || forceRelabel) {
    await api.addLabels(repo, issue, [status]);
  }
  return {
    applied: true,
    stale: false,
    reason: "status_applied",
    status,
  };
}

class GitHubRestApi {
  constructor(token, fetchImpl = globalThis.fetch) {
    if (!token) {
      throw new Error("github_token_required");
    }
    if (typeof fetchImpl !== "function") {
      throw new Error("fetch_unavailable");
    }
    this.token = token;
    this.fetch = fetchImpl;
  }

  async request(method, path, body, { allow404 = false } = {}) {
    const response = await this.fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "User-Agent": "cloudwarriors-praxis-shadow-state",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (allow404 && response.status === 404) {
      return null;
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`github_api_${response.status}:${method}:${path}:${detail}`);
    }
    if (response.status === 204) {
      return null;
    }
    return response.json();
  }

  async paginate(path) {
    const output = [];
    for (let page = 1; ; page += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const rows = await this.request("GET", `${path}${separator}per_page=100&page=${page}`);
      if (!Array.isArray(rows)) {
        throw new Error(`github_pagination_non_array:${path}`);
      }
      output.push(...rows);
      if (rows.length < 100) {
        return output;
      }
    }
  }

  async listComments(repo, issue) {
    return this.paginate(`/repos/${repo}/issues/${issue}/comments`);
  }

  async getJsonContent(repo, contentPath) {
    const payload = await this.request(
      "GET",
      `/repos/${repo}/contents/${encodeURIComponent(contentPath).replaceAll("%2F", "/")}`,
    );
    if (!payload || payload.encoding !== "base64" || typeof payload.content !== "string") {
      throw new Error("invalid_github_content_payload");
    }
    try {
      return JSON.parse(Buffer.from(payload.content, "base64").toString("utf8"));
    } catch {
      throw new Error("invalid_github_json_content");
    }
  }

  async getIssue(repo, issue) {
    return this.request("GET", `/repos/${repo}/issues/${issue}`);
  }

  async getAuthenticatedUser() {
    return this.request("GET", "/user");
  }

  async getComment(repo, commentId) {
    return this.request("GET", `/repos/${repo}/issues/comments/${commentId}`);
  }

  async listRepoLabels(repo) {
    return this.paginate(`/repos/${repo}/labels`);
  }

  async listIssues(repo) {
    return this.paginate(`/repos/${repo}/issues?state=all`);
  }

  async ensureLabel(repo, name) {
    const encoded = encodeURIComponent(name);
    const existing = await this.request("GET", `/repos/${repo}/labels/${encoded}`, undefined, {
      allow404: true,
    });
    if (existing) {
      return existing;
    }
    return this.request("POST", `/repos/${repo}/labels`, {
      color: "5319e7",
      description: "Praxis resolver-attempt binding; machine managed",
      name,
    });
  }

  async addLabels(repo, issue, labels) {
    return this.request("POST", `/repos/${repo}/issues/${issue}/labels`, { labels });
  }

  async removeLabel(repo, issue, label) {
    return this.request(
      "DELETE",
      `/repos/${repo}/issues/${issue}/labels/${encodeURIComponent(label)}`,
      undefined,
      { allow404: true },
    );
  }

  async deleteLabel(repo, label) {
    return this.request(
      "DELETE",
      `/repos/${repo}/labels/${encodeURIComponent(label)}`,
      undefined,
      { allow404: true },
    );
  }

  async createComment(repo, issue, body) {
    return this.request("POST", `/repos/${repo}/issues/${issue}/comments`, { body });
  }

  async updateComment(repo, commentId, body) {
    return this.request("PATCH", `/repos/${repo}/issues/comments/${commentId}`, { body });
  }

  async updateIssueState(repo, issue, state) {
    return this.request("PATCH", `/repos/${repo}/issues/${issue}`, { state });
  }
}

function input(name, fallback = "") {
  const key = `INPUT_${name.replaceAll(" ", "_").toUpperCase()}`;
  return process.env[key] ?? fallback;
}

function positiveInteger(value, reason) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(reason);
  }
  return parsed;
}

function writeOutputs(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT_required");
  }
  let content = "";
  for (const [key, value] of Object.entries(values)) {
    const normalized = typeof value === "boolean" ? String(value) : String(value ?? "");
    const delimiter = `PRAXIS_${key}_${process.pid}`;
    content += `${key}<<${delimiter}\n${normalized}\n${delimiter}\n`;
  }
  fs.appendFileSync(outputPath, content, { encoding: "utf8" });
}

async function runAction() {
  const mode = input("MODE");
  const token = input("TOKEN");
  const api = new GitHubRestApi(token);
  const repo = input("REPO", process.env.GITHUB_REPOSITORY || "");
  const trustedSourceActorId = input("TRUSTED-SOURCE-ACTOR-ID");
  let result;

  if (mode === "bridge") {
    const issue = positiveInteger(input("ISSUE-NUMBER"), "issue_number_required");
    result = await bridge({
      api,
      sourceRepo: repo,
      sourceIssue: issue,
      triggerComment: input("TRIGGER-COMMENT"),
      trustedSourceActorId,
    });
  } else if (mode === "reconcile") {
    let sourceIssues;
    try {
      sourceIssues = JSON.parse(input("ISSUE-NUMBERS", "[]"));
    } catch {
      throw new Error("reconcile_issues_must_be_json");
    }
    result = await reconcile({
      api,
      sourceRepo: repo,
      sourceIssues,
      trustedSourceActorId,
    });
  } else if (mode === "resolve") {
    const issue = positiveInteger(input("ISSUE-NUMBER"), "issue_number_required");
    result = await resolveTrigger({
      api,
      repo,
      issue,
      triggerComment: input("TRIGGER-COMMENT"),
      triggerCommentId: input("TRIGGER-COMMENT-ID"),
      trustedSourceActorId,
    });
  } else if (mode === "transition") {
    const issue = positiveInteger(input("ISSUE-NUMBER"), "issue_number_required");
    result = await transition({
      api,
      repo,
      issue,
      binding: input("BINDING"),
      phase: input("PHASE"),
      forceRelabel: input("FORCE-RELABEL").toLowerCase() === "true",
    });
  } else if (mode === "cleanup") {
    const issue = positiveInteger(input("ISSUE-NUMBER"), "issue_number_required");
    const raw = input("BINDINGS", "[]");
    let bindings;
    try {
      bindings = JSON.parse(raw);
    } catch {
      throw new Error("bindings_must_be_json");
    }
    if (!Array.isArray(bindings)) {
      throw new Error("bindings_must_be_array");
    }
    result = await cleanup({ api, repo, issue, bindings });
  } else {
    throw new Error(`unsupported_mode:${mode}`);
  }

  writeOutputs({
    applied: result.applied ?? false,
    attempt_id: result.attemptId ?? "",
    binding: result.binding ?? "",
    bound: result.bound ?? false,
    dispatch_created: result.dispatchCreated ?? false,
    reason: result.reason ?? "",
    shadow_issue: result.shadowIssue ?? "",
    shadow_repo: result.shadowRepo ?? "",
    stale: result.stale ?? false,
    status: result.status ?? "",
  });
  console.log(
    JSON.stringify({
      mode,
      reason: result.reason || "",
      bound: result.bound ?? false,
      stale: result.stale ?? false,
      applied: result.applied ?? false,
    }),
  );
}

if (require.main === module) {
  runAction().catch((error) => {
    console.error(`praxis-shadow-state: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  GitHubRestApi,
  bridge,
  cleanup,
  orphanedBindings,
  reconcile,
  resolveTrigger,
  transition,
};
