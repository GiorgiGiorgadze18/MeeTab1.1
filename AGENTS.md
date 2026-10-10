# Development rules

## Communication and scope
- Reply in Georgian: short, practical, honest. Coding-agent prompts are English, strict and exact.
- Complete authorized work and relevant validation. Keep changes minimal, focused and reversible.
- No unrelated cleanup, broad refactors, speculative redesigns or unnecessary dependencies. Explain material scope growth and propose separate phases.

## Source of truth
Use current remote base first, then relevant open PRs/active branches, authoritative project documentation, current tests/runtime evidence, and historical reports only as background. Verify current state before claiming what changed, is deployed or is ready. Earlier agent reports are not independent proof.

## Before editing
- Identify repository, configured base, working branch and instructions. Inspect dirty files, recent commits, open PRs and active branches.
- Check overlap in files, routes, APIs, schemas, migrations, UI and runtime ownership. Stop affected edits if material overlap or ownership is unclear.
- Preserve unrelated changes; never overwrite, reset, stash or delete another task's work. Use an implementation worktree where required. Reference/synced files are read-only.

## Git
- Never work on main/master without explicit authorization or push directly to a shared base.
- One logical change, one branch, one PR targeting its configured base. A dependent follow-up may explicitly configure an unmerged preview branch as its base; record that dependency.
- Agents must not merge PRs; merging requires explicit owner approval. No force-push/rebase without approval.
- Do not sync an advanced base unless required for material conflicts, correctness or approved merge preparation.
- Stage only intentional files; never use blind `git add -A`.

## Security and privacy
- Never expose/commit credentials, tokens, cookies, authorization headers, DB URLs, private keys or sensitive configuration. Never print secret-bearing files.
- Preserve authentication, authorization, RBAC, tenant isolation, audit, retention, TLS, signature verification and security headers. Authorize every protected action on the server.
- Validate untrusted input, parameterize queries and handle output safely. Keep useful logs without credentials or unnecessary personal data.
- No keylogging, credential capture, covert screenshots or private browser-data extraction. Never fabricate telemetry, screenshots, heartbeats, proof records, timings or test results.

## Implementation
- Read relevant code/contracts and fix demonstrated causes. Preserve API/database/authentication/protocol contracts unless the task requires a change.
- Handle errors without leaking sensitive details; use existing patterns/dependencies.
- Measure before optimizing; avoid request storms, N+1 queries, global scans and unnecessarily large payloads. Paginate lists and load heavy details only when needed.

## Database
- Use established migrations; never edit/delete/reorder/reuse applied identifiers or fabricate rollback/upgrade status by modifying tracking.
- Retry safely where required. Production migrations require owner authorization, a verified backup and documented recovery.

## Runtime and deployment
- Production directories are runtime-only. Do not deploy without explicit owner authorization; deploy the exact approved commit through the governed workflow.
- Record version, health, migration state and persistent storage before switching. Verify the intended artifact/source is running; git pull, build success or copied files are not deployment proof.
- Preserve persistent volumes. Check health, DB connectivity, workers and relevant dependencies afterwards. Stop for unclear ownership/unexpected changes.

## Validation and reporting
- Run focused tests and relevant regression/static/type/lint/build checks, including success, invalid input, unauthenticated and forbidden access. Do not repeatedly run expensive unchanged suites.
- Run Trivy for code candidates and inspect its sanitized findings: an audit workflow's green status does not imply zero findings. Never upload raw secret matches.
- Distinguish CODE/TEST, LOCAL RUNTIME, AUTHENTICATED RUNTIME, PHYSICAL ENDPOINT and PRODUCTION. Automated tests/mocks do not prove live authentication or production readiness. Missing credentials/sessions/devices/runtime access remain PENDING/BLOCKED.
- Update documentation only when verified truth changes.
- Final report: PASS/PARTIAL/BLOCKED; branch/SHA; files/behavior; actual checks/results; runtime evidence level; pending owner checks; blockers/next action; PR URL/base/state/head when available.
- When applicable: "Implementation complete and automated validation passed; owner manual validation remains pending."
