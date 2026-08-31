# App-test tailnet access threat model

## Scope and boundaries

A separate non-credential job resolves the configured base branch to an
immutable commit and reads every executable App Tests setting from that exact
checkout. The reusable App Tests job checks out the same SHA, executes that
trusted base's test command, and targets the frontend and backend fix-branch
preview URLs that are reachable only through the cloudwarriors-ai Tailscale
network. After all Node and Python dependency installation completes, the
commit-pinned Tailscale action exchanges the existing OAuth secret references
for the existing `tag:ci` identity. The test command then receives preview
reachability plus the existing E2E test-user credentials.

Scopely's high-volume Sentinel suite also receives an issue-scoped throttle
bypass value so test traffic does not lock out its synthetic user. Trusted
runner steps derive that value with HMAC from a dedicated GitHub secret, the
repository identity, and issue number. Only the derived value reaches the
preview host and trusted tests; the master key remains in GitHub Actions.

The fix-branch application, its responses, and the workflow-dispatch ref are
untrusted until review. No source, manifest, package hook, or shell command from
either untrusted ref executes in the credential-bearing job. Preview responses
and test credentials are INTERNAL; OAuth secrets are RESTRICTED. GitHub
Actions, the pinned action, and the tailnet ACL are separate authorization
boundaries. This change does not expose a public listener, add a credential,
grant merge authority, or permit a production target.

## Threats and controls

- **Spoofing:** a job could claim a broader tailnet identity. The action requests
  only the existing `tag:ci` identity, and Tailscale ACLs remain authoritative
  for the preview host and port ranges.
- **Tampering:** fix-branch package hooks could persist on the runner and
  intercept later OAuth inputs, or a modified dispatch-ref config could select
  an arbitrary shell command. A non-credential job resolves the immutable base
  SHA and derives the command, runtime, Python version, and requirements path
  from that checkout. App Tests checks out that same SHA; no untrusted source or
  executable setting crosses into the job. The join is also ordered after
  trusted-base dependency installation, and contracts enforce provenance and
  ordering.
- **Cross-preview credential reuse:** agent-authored preview code can read its
  own derived bypass value. The value is HMAC-bound to repository and issue, so
  it cannot bypass a sibling preview and does not reveal the master key.
- **Repudiation:** preview access could be detached from its source revision.
  The job records the resolved trusted-base SHA; GitHub and Tailscale retain the
  workflow/device identity, and artifacts bind results to the run and remote
  fix-branch preview.
- **Information disclosure:** the untrusted preview's browser code could probe
  services reachable to the runner or misuse the E2E session. The tailnet ACL
  limits `tag:ci`, OAuth values are passed only to the pinned action and never
  to the browser, E2E credentials already existed in this bounded job, and
  preview data must exclude customer data and secrets.
- **Denial of service:** repeated tests create devices and preview traffic.
  Existing concurrency, the 25-minute job timeout, action cleanup, and the
  per-issue preview lifecycle bound duration and rate.
- **Elevation of privilege:** tailnet access must not authorize release. The
  finalizer still requires the App Tests job, regression comparison, project
  tests, API validation, verified head SHA, and preview marker. Merge and
  production authority are unchanged.
- **Prompt injection / tool-authority escalation:** credible because an agent
  writes the remote application under test. The deterministic trusted-base
  tests, immutable base SHA, pinned action, ACL, dev-only base guard, and human
  preview verdict bound the agent; prompt text cannot select local test code,
  tags, credentials, targets, or merge behavior.

## Authorization behavior and residual risk

GitHub's scoped job token authorizes both trusted-base checkouts, GitHub passes
OAuth secret references only to the pinned action, Tailscale authorizes `tag:ci`
network access, and the application authorizes the E2E test user. Contracts
prove the non-credential job derives executable settings from an immutable base
SHA, the App Tests job checks out that same SHA without the broader workflow
credential, the caller-ref command is forbidden, dependency installation
precedes the join, and the join uses the pinned action and tag with no shell
implementation. They also prove the throttle-bypass master is confined to two
trusted derivation steps and only the issue-scoped value reaches the host and
test command. The application-side contract must keep bypass authorization
limited to `APP_ENVIRONMENT=preview` (or DEBUG), use constant-time comparison,
and remain inert in production. Live proof must show MagicDNS resolution and a
successful App Tests outcome against a fresh preview.

Residual risk is that trusted base tests and untrusted preview browser code
still receive the network access needed for the flow and could reach any
additional service allowed by the `tag:ci` ACL. That risk is bounded by ACL
scope, ephemeral CI identity, synthetic preview data, dev-only lifecycle, and
the required human verdict before merge.
