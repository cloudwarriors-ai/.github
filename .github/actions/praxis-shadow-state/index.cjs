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

async function bridge({ api, sourceRepo, sourceIssue }) {
  const comments = await api.listComments(sourceRepo, sourceIssue);
  const dispatch = selectSourceDispatch(comments, {
    repo: sourceRepo,
    issue: sourceIssue,
  });
  if (!dispatch) {
    return {
      bound: false,
      binding: "",
      attemptId: "",
      shadowIssue: 0,
      shadowRepo: "",
      dispatchCreated: false,
      reason: "no_praxis_marker",
    };
  }

  const source = await api.getIssue(sourceRepo, sourceIssue);
  if (source.state !== "open") {
    throw new Error(`source_issue_not_open:${source.state || "unknown"}`);
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
  if (!Number.isSafeInteger(shadowIssue) || shadowIssue <= 0) {
    throw new Error("missing_shadow_issue_mapping");
  }

  const shadow = await api.getIssue(shadowRepo, shadowIssue);
  const footer = parseShadowSource(shadow.body);
  if (footer.repo !== sourceRepo || footer.issue !== Number(sourceIssue)) {
    throw new Error("shadow_footer_mismatch");
  }
  if (!["open", "closed"].includes(shadow.state)) {
    throw new Error(`shadow_issue_state_invalid:${shadow.state || "unknown"}`);
  }

  const currentLabels = issueLabels(shadow);
  const currentBindings = strictBindingNames(currentLabels);
  if (currentBindings.length > 1) {
    throw new Error("multiple_praxis_bindings");
  }
  const dispatchBody = formatShadowDispatch({
    binding: dispatch.binding,
    sourceRepo,
    sourceIssue,
  });
  const authenticated = await api.getAuthenticatedUser();
  const authenticatedId = positiveInteger(
    authenticated && authenticated.id, "authenticated_user_invalid",
  );
  const shadowComments = await api.listComments(shadowRepo, shadowIssue);
  const trustedDispatchExists = shadowComments.some(
    (comment) =>
      comment && comment.body === dispatchBody &&
      Number(comment.user && comment.user.id) === authenticatedId,
  );

  // A trusted comment plus its current immutable binding is the terminal
  // delivery receipt. Retrying must not reopen or clear an already-started run.
  if (currentBindings[0] === dispatch.binding && trustedDispatchExists) {
    return {
      bound: true,
      binding: dispatch.binding,
      attemptId: dispatch.attemptId,
      shadowIssue,
      shadowRepo,
      dispatchCreated: false,
      reason: "bridged",
    };
  }

  // Validate capacity before cleanup so a rejected attempt cannot strip the
  // issue's last valid binding and leave it unowned.
  const repoLabels = await api.listRepoLabels(shadowRepo);
  const issues = await api.listIssues(shadowRepo);
  const orphans = orphanedBindings(repoLabels, issues);
  const bindingExists = strictBindingNames(repoLabels).includes(dispatch.binding);
  if (!bindingExists && orphans.length >= ORPHAN_BUDGET) {
    throw new Error(`binding_orphan_budget_exceeded:${orphans.length}`);
  }

  if (shadow.state === "closed") {
    await api.updateIssueState(shadowRepo, shadowIssue, "open");
  }

  const obsolete = currentBindings.filter((name) => name !== dispatch.binding);
  if (obsolete.length > 0) {
    await cleanup({
      api,
      repo: shadowRepo,
      issue: shadowIssue,
      bindings: obsolete,
    });
  }

  await api.ensureLabel(shadowRepo, dispatch.binding);
  if (!currentLabels.includes(dispatch.binding)) {
    await api.addLabels(shadowRepo, shadowIssue, [dispatch.binding]);
  }

  for (const status of FROZEN_STATUSES) {
    if (currentLabels.includes(status)) {
      await api.removeLabel(shadowRepo, shadowIssue, status);
    }
  }
  await api.createComment(shadowRepo, shadowIssue, dispatchBody);

  return {
    bound: true,
    binding: dispatch.binding,
    attemptId: dispatch.attemptId,
    shadowIssue,
    shadowRepo,
    dispatchCreated: true,
    reason: "bridged",
  };
}

async function resolveTrigger({ api, repo, issue, triggerComment, triggerCommentId }) {
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
  const shadow = await api.getIssue(repo, issue);
  const labels = issueLabels(shadow);
  const state = classifyBindingState(labels, parsed.binding);
  if (state.state !== "current") {
    return triggerResult(parsed, true, "stale_binding");
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
  if (FROZEN_STATUSES.some((status) => labels.includes(status))) {
    return triggerResult(parsed, true, "attempt_already_started");
  }

  return triggerResult(parsed, false, "bound_trigger");
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
  const issue = positiveInteger(input("ISSUE-NUMBER"), "issue_number_required");
  let result;

  if (mode === "bridge") {
    result = await bridge({ api, sourceRepo: repo, sourceIssue: issue });
  } else if (mode === "resolve") {
    result = await resolveTrigger({
      api,
      repo,
      issue,
      triggerComment: input("TRIGGER-COMMENT"),
      triggerCommentId: input("TRIGGER-COMMENT-ID"),
    });
  } else if (mode === "transition") {
    result = await transition({
      api,
      repo,
      issue,
      binding: input("BINDING"),
      phase: input("PHASE"),
      forceRelabel: input("FORCE-RELABEL").toLowerCase() === "true",
    });
  } else if (mode === "cleanup") {
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
  resolveTrigger,
  transition,
};
