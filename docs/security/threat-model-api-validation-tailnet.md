# API validation tailnet access threat model

## Scope and boundaries

The reusable API-validation job needs to call preview endpoints that are exposed
only inside the cloudwarriors-ai Tailscale network. The caller passes references
to the existing `TS_OAUTH_CLIENT_ID` and `TS_OAUTH_SECRET` GitHub secrets into
the reusable workflow. The commit-pinned Tailscale action exchanges those
credentials for the existing `tag:ci` identity, joins the runner to the tailnet,
and Sentinel then sends the validation scenarios to the resolved preview URL.

The change does not make a preview public, create a new credential, change
Sentinel assertions, or expose either OAuth value to checked-out repository
code. The validation manifest is read from the configured base ref. Preview
responses are INTERNAL and must not contain credentials or customer data.

## Threats and controls

- **Spoofing:** a runner could claim a broader tailnet identity. The workflow
  requests only the existing `tag:ci` identity through the OAuth client, and the
  tailnet ACL remains the authority for reachable services.
- **Tampering:** a mutable action could capture OAuth values or alter routing.
  The workflow pins `tailscale/github-action` to the reviewed commit
  `6cae46e2d796f265265cfcf628b72a32b4d7cade`.
- **Repudiation:** an untraceable runner could access the preview. GitHub Actions
  and Tailscale retain the run and device identity; the Sentinel artifact binds
  its result to the workflow run attempt and manifest commit.
- **Information disclosure:** OAuth secrets or unrelated tailnet services could
  become visible to feature code. GitHub passes the secrets only to the pinned
  action, the job does not export them, the identity is ACL-scoped, and the
  manifest comes from the configured base ref rather than the fix branch.
- **Denial of service:** repeated jobs create transient tailnet devices and API
  traffic. Existing workflow concurrency, job timeout, and Tailscale action
  cleanup bound the lifetime and rate.
- **Elevation of privilege:** a repository change could use the CI identity to
  reach unauthorized services. Tailnet ACLs enforce authorization independently
  of the workflow, and this change adds no write authority or production target.
- **Prompt injection / tool-authority escalation:** not credible for this slice.
  No model receives the OAuth values or gains new tools; Sentinel executes a
  deterministic base-ref manifest.

## Authorization behavior and residual risk

Authorization remains a Tailscale ACL decision for `tag:ci` to the preview host
and port. The workflow proves only that the optional secret pair is declared,
forwarded to the nested reusable workflow, and consumed by the pinned action
before validation. Live verification must show MagicDNS resolution and a
Sentinel report from a fresh preview run.

Residual risk is that compromise of the pinned third-party action or the
existing `tag:ci` ACL could expose other services allowed to that identity. That
risk already exists in preview deploy and teardown jobs and is not expanded to
production by this dev-only workflow path.
