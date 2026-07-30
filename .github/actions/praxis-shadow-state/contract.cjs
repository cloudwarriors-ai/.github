"use strict";

const MAX_BIGINT = 9223372036854775807n;
const SOURCE_MARKER_PREFIX = "<!-- praxis-dispatch";
const SHADOW_MARKER_PREFIX = "<!-- praxis-shadow-dispatch";
const BINDING_RE = /^praxis\/a([1-9a-z][0-9a-z]{0,12})-([0-9a-f]{24})$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ORPHAN_BUDGET = 100;
const STATUS_BY_PHASE = Object.freeze({
  "follow-up-required": "STATUS: Follow-Up Required",
  "in-progress": "STATUS: In Progress",
  "in-qa": "STATUS: In QA",
});

function encodeAttemptId(value) {
  const text = String(value ?? "");
  if (!/^[1-9][0-9]*$/.test(text)) {
    throw new Error("invalid_attempt_id");
  }
  const parsed = BigInt(text);
  if (parsed > MAX_BIGINT) {
    throw new Error("attempt_id_overflow");
  }
  return parsed.toString(36);
}

function decodeAttemptId(value) {
  const text = String(value ?? "");
  if (!/^[1-9a-z][0-9a-z]{0,12}$/.test(text)) {
    throw new Error("invalid_base36_attempt_id");
  }
  let parsed = 0n;
  for (const character of text) {
    const digit =
      character >= "0" && character <= "9"
        ? BigInt(character.charCodeAt(0) - 48)
        : BigInt(character.charCodeAt(0) - 87);
    parsed = parsed * 36n + digit;
    if (parsed > MAX_BIGINT) {
      throw new Error("attempt_id_overflow");
    }
  }
  if (parsed <= 0n || parsed.toString(36) !== text) {
    throw new Error("non_canonical_attempt_id");
  }
  return parsed.toString(10);
}

function bindingFor(attemptId, nonce) {
  const normalizedNonce = String(nonce ?? "");
  if (!/^[0-9a-f]{32}$/.test(normalizedNonce)) {
    throw new Error("invalid_dispatch_nonce");
  }
  return `praxis/a${encodeAttemptId(attemptId)}-${normalizedNonce.slice(0, 24)}`;
}

function parseBinding(value) {
  const text = String(value ?? "");
  const match = BINDING_RE.exec(text);
  if (!match) {
    return null;
  }
  try {
    return {
      attemptId: decodeAttemptId(match[1]),
      noncePrefix: match[2],
    };
  } catch {
    return null;
  }
}

function labelName(value) {
  if (typeof value === "string") {
    return value;
  }
  return value && typeof value.name === "string" ? value.name : "";
}

function strictBindingNames(labels) {
  const bindings = [];
  for (const value of labels || []) {
    const name = labelName(value);
    if (!name.startsWith("praxis/a")) {
      continue;
    }
    if (!parseBinding(name)) {
      throw new Error(`malformed_praxis_binding:${name}`);
    }
    bindings.push(name);
  }
  return [...new Set(bindings)];
}

function classifyBindingState(labels, expectedBinding) {
  if (!parseBinding(expectedBinding)) {
    throw new Error("invalid_expected_binding");
  }
  const bindings = strictBindingNames(labels);
  if (bindings.length > 1) {
    throw new Error("multiple_praxis_bindings");
  }
  const current = bindings[0] || "";
  return {
    state: current === expectedBinding ? "current" : "stale",
    current,
  };
}

function markerPayloads(body, prefix, malformedReason) {
  const text = String(body ?? "");
  if (!text.includes(prefix)) {
    return [];
  }
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}\\s+({[\\s\\S]*?})\\s*-->`, "g");
  const payloads = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    try {
      payloads.push(JSON.parse(match[1]));
    } catch {
      throw new Error(malformedReason);
    }
  }
  if (payloads.length === 0) {
    throw new Error(malformedReason);
  }
  return payloads;
}

function normalizedSourceDispatch(payload, expected) {
  if (
    !payload ||
    payload.repo !== expected.repo ||
    Number(payload.issue) !== Number(expected.issue)
  ) {
    throw new Error("source_marker_mismatch");
  }
  if (!REPO_RE.test(payload.repo) || !Number.isSafeInteger(Number(payload.issue))) {
    throw new Error("invalid_source_marker");
  }
  const attemptId = String(payload.attempt_id ?? "");
  const nonce = String(payload.nonce ?? "");
  return {
    attemptId,
    binding: bindingFor(attemptId, nonce),
    nonce,
  };
}

function selectSourceDispatch(comments, expected, trustedSourceActorId) {
  if (!REPO_RE.test(String(expected.repo || ""))) {
    throw new Error("invalid_expected_source_repo");
  }
  if (!Number.isSafeInteger(Number(expected.issue)) || Number(expected.issue) <= 0) {
    throw new Error("invalid_expected_source_issue");
  }
  const trustedActorId = Number(trustedSourceActorId);
  if (!Number.isSafeInteger(trustedActorId) || trustedActorId <= 0) {
    throw new Error("trusted_source_actor_id_invalid");
  }

  const found = [];
  for (const comment of [...(comments || [])].sort(
    (left, right) => Number(left.id) - Number(right.id),
  )) {
    if (Number(comment && comment.user && comment.user.id) !== trustedActorId) {
      continue;
    }
    const payloads = markerPayloads(
      comment.body,
      SOURCE_MARKER_PREFIX,
      "malformed_praxis_dispatch",
    );
    if (payloads.length === 0) {
      continue;
    }
    const normalized = payloads.map((payload) =>
      normalizedSourceDispatch(payload, expected),
    );
    const fingerprints = new Set(normalized.map((entry) => JSON.stringify(entry)));
    if (fingerprints.size !== 1) {
      throw new Error("conflicting_praxis_dispatch");
    }
    found.push({ ...normalized[0], commentId: Number(comment.id) });
  }
  if (found.length === 0) {
    return null;
  }
  const latest = found.at(-1);
  return {
    attemptId: latest.attemptId,
    binding: latest.binding,
    nonce: latest.nonce,
    commentIds: found
      .filter(
        (entry) =>
          entry.attemptId === latest.attemptId &&
          entry.binding === latest.binding &&
          entry.nonce === latest.nonce,
      )
      .map((entry) => entry.commentId),
  };
}

function formatShadowDispatch({ binding, sourceRepo, sourceIssue }) {
  if (!parseBinding(binding)) {
    throw new Error("invalid_shadow_dispatch_binding");
  }
  if (!REPO_RE.test(String(sourceRepo || ""))) {
    throw new Error("invalid_shadow_dispatch_repo");
  }
  const issue = Number(sourceIssue);
  if (!Number.isSafeInteger(issue) || issue <= 0) {
    throw new Error("invalid_shadow_dispatch_issue");
  }
  return `@claude\n<!-- praxis-shadow-dispatch ${JSON.stringify({
    binding,
    source_issue: issue,
    source_repo: sourceRepo,
  })} -->`;
}

function parseShadowDispatch(body) {
  const payloads = markerPayloads(
    body,
    SHADOW_MARKER_PREFIX,
    "malformed_shadow_dispatch",
  );
  if (payloads.length === 0) {
    return null;
  }
  if (payloads.length !== 1) {
    throw new Error("conflicting_shadow_dispatch");
  }
  const payload = payloads[0];
  const binding = String(payload.binding ?? "");
  const sourceRepo = String(payload.source_repo ?? "");
  const sourceIssue = Number(payload.source_issue);
  if (
    !parseBinding(binding) ||
    !REPO_RE.test(sourceRepo) ||
    !Number.isSafeInteger(sourceIssue) ||
    sourceIssue <= 0
  ) {
    throw new Error("malformed_shadow_dispatch");
  }
  return { binding, sourceIssue, sourceRepo };
}

function parseShadowSource(body) {
  const text = String(body ?? "");
  const matches = [
    ...text.matchAll(/Shadow of \[([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([1-9][0-9]*)\]\(/g),
  ];
  const unique = new Map();
  for (const match of matches) {
    unique.set(`${match[1]}#${match[2]}`, {
      repo: match[1],
      issue: Number(match[2]),
    });
  }
  if (unique.size !== 1) {
    throw new Error(unique.size === 0 ? "missing_shadow_footer" : "ambiguous_shadow_footer");
  }
  return [...unique.values()][0];
}

module.exports = {
  BINDING_RE,
  ORPHAN_BUDGET,
  STATUS_BY_PHASE,
  bindingFor,
  classifyBindingState,
  decodeAttemptId,
  encodeAttemptId,
  formatShadowDispatch,
  labelName,
  parseBinding,
  parseShadowDispatch,
  parseShadowSource,
  selectSourceDispatch,
  strictBindingNames,
};
