# App-test tailnet access threat model

## Scope and boundaries

The reusable App Tests job executes the configured test command from the
verified fix-branch SHA against frontend and backend preview URLs that are
reachable only through the cloudwarriors-ai Tailscale network. After all Node
and Python dependency installation completes, the commit-pinned Tailscale
action exchanges the existing OAuth secret references for the existing
`tag:ci` identity. The test command then receives preview reachability plus the
existing E2E test-user credentials.

The fix branch and test code are untrusted until review. Preview responses and
test credentials are INTERNAL; OAuth secrets are RESTRICTED. GitHub Actions,
the pinned action, and the tailnet ACL are separate authorization boundaries.
This change does not expose a public listener, add a credential, grant merge
authority, or permit a production target.

## Threats and controls

- **Spoofing:** a job could claim a broader tailnet identity. The action requests
  only the existing `tag:ci` identity, and Tailscale ACLs remain authoritative
  for the preview host and port ranges.
- **Tampering:** fix-branch package hooks could abuse tailnet access. The join is
  deliberately ordered after Node and Python dependency installation; contract
  tests enforce that ordering. The actual test command retains preview access
  because reaching the private target is its purpose.
- **Repudiation:** preview access could be detached from its source revision.
  The job checks out the SHA already verified by `verify-fix-branch`; GitHub and
  Tailscale retain the workflow/device identity, and artifacts bind results to
  the run.
- **Information disclosure:** fix-branch tests could probe other services or
  exfiltrate E2E credentials. The tailnet ACL limits `tag:ci`, OAuth values are
  passed only to the pinned action, E2E credentials already existed in this
  bounded job, and preview data must exclude customer data and secrets.
- **Denial of service:** repeated tests create devices and preview traffic.
  Existing concurrency, the 25-minute job timeout, action cleanup, and the
  per-issue preview lifecycle bound duration and rate.
- **Elevation of privilege:** tailnet access must not authorize release. The
  finalizer still requires the App Tests job, regression comparison, project
  tests, API validation, verified head SHA, and preview marker. Merge and
  production authority are unchanged.
- **Prompt injection / tool-authority escalation:** credible because an agent
  writes the fix branch and its tests. The deterministic workflow, reviewed
  `appTestCommand`, post-install join, pinned action, ACL, dev-only base guard,
  and human preview verdict bound the agent; prompt text cannot select tags,
  credentials, targets, or merge behavior.

## Authorization behavior and residual risk

GitHub authorizes secret references to the pinned action; Tailscale authorizes
`tag:ci` network access; the application authorizes the E2E test user. Contracts
prove the join occurs after dependency installation and before tests, uses the
pinned action and tag, and has no shell implementation. Live proof must show
MagicDNS resolution and a successful App Tests outcome against a fresh preview.

Residual risk is that reviewed test code still receives the network access it
needs and could reach any additional service allowed by the `tag:ci` ACL. That
risk is bounded by ACL scope, ephemeral CI identity, synthetic preview data,
dev-only lifecycle, and the required human verdict before merge.
