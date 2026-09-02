# Threat model: Autofix validation-feedback repair

## Scope and trust boundaries

The direct Autofix writer now receives one bounded continuation when the trusted workflow's
repository validation commands fail. The relevant actors and boundaries are:

1. A repository issue and candidate source tree provide untrusted product content.
2. A credential-isolated writer job edits the candidate tree and runs the validation contract
   read from the trusted base branch's `.autopilot/config.json`.
3. Validation output crosses from feature-controlled commands into the model continuation.
4. A separate publisher job, which never executes candidate code, applies the resulting patch to
   the frozen authorized branch and is the only writer-path job with repository write authority.

Issue text, candidate code, and validation output are untrusted. Repository and model credentials
are restricted. No production data enters this flow.

## Credible threats and mitigations

| Threat | Existing control | Gap | Mitigation in this change |
|---|---|---|---|
| Prompt injection through test output | Issue content is already delimited as untrusted; writer tools are restricted | Test output was not previously a model input | Strip control sequences, cap the excerpt, delimit it as untrusted diagnostic data, and append a system instruction forbidding instructions from the output (ASVS V1.2, V5.1) |
| Credential disclosure through logs | GitHub masks console secrets; writer has no repository-write token | Local captured logs are not protected by GitHub masking | Validation subprocesses run with model credentials removed; the feedback sanitizer redacts credential-shaped values before the model sees the excerpt (ASVS V8.3) |
| Tool-authority escalation | Writer and publisher are separate jobs | A repair continuation could accidentally acquire publisher authority | Resume inside the same read-only writer job with the same restricted tools; keep all repository writes in the fresh publisher job (ASVS V4.1) |
| Branch tampering between validation and publish | Publisher verifies the frozen base SHA and uses force-with-lease | A continuation adds another mutation phase | The continuation stays in the frozen writer workspace; the publisher still rejects base drift and unexpected remote-head changes (ASVS V4.2) |
| Unbounded cost or retry loops | Writer turns and job wall clock are bounded | Validation failures had no explicit repair fuse | Permit exactly one continuation, cap it at 20 turns, and divide the configured wall-clock budget between primary and repair phases |
| False success after a failed repair | Downstream release gates fail closed | A continuation could claim success without proving it | The trusted workflow reruns every configured command after the continuation and publishes no patch unless they all exit zero |
| Denial of service through oversized output | GitHub job logs have platform limits | Refeeding an entire log can amplify cost | Keep only the last 24,000 sanitized characters in the repair prompt |

## Authorization behavior

- The target guard requires `base=dev` and `head=autofix/issue-<N>` before any delegated job.
- The writer receives model credentials but no repository-write credential.
- Validation subprocesses receive neither model nor repository-write credentials.
- The publisher checks the frozen source SHA, applies only the generated patch, and pushes with an
  exact force-with-lease for the authorized issue branch.
- Contract tests assert the new repair fuse, credential removal, validation rerun, and retained
  publisher separation.

## Considered but not credible

- Cross-tenant data access: the workflows operate on one repository checkout and receive no tenant
  or production dataset.
- Production promotion bypass: the target guard remains dev-only and this change does not alter the
  separate dev-to-main human gate.

## Residual risk

Redaction is pattern-based and cannot prove arbitrary candidate output contains no sensitive value.
The stronger control is that validation commands run with model and repository-write credentials
removed. A repository may still print non-credential internal fixture data; repository owners must
keep Autofix validation commands suitable for model-visible diagnostics.
