# Fix verification evidence

AI-CodeGuard stores fix proposals against their original finding and records each
verification attempt separately. An attempt snapshots the repository, branch,
pull request (when available), source commit, finding details, patch digest, and
changed file paths. Check output and failure details are bounded and
credential-sanitized before persistence.

## Status rules

- `VERIFIED` requires a successful trusted execution, at least one reported
  `TEST` check with exit code 0, all reported checks passing with exit code 0,
  evidence that the original issue reproduced before the patch, and evidence
  that it no longer reproduces after the patch.
- `FAILED` means a required check failed or the original issue still reproduces.
- `NEEDS_REVIEW` is used when evidence is unavailable, incomplete, timed out,
  mismatched to the stored patch, or cannot establish the issue-specific result.
- A human decision is stored separately and never changes the execution status.

## API

All routes require the existing authenticated user session and are scoped to
findings and repositories owned by that user.

- `POST /api/reviews/fix-proposals/:proposalId/verification-attempts`
  requests an idempotent attempt with a `requestKey`.
- `GET /api/reviews/fix-verification-attempts` lists recent evidence (up to 100
  runs) and status totals. Optional filters: `status`, `repositoryId`, `from`,
  and `to` (ISO timestamps).
- `GET /api/reviews/fix-verification-attempts/:attemptId` returns a run's
  evidence.
- `POST /api/reviews/fix-verification-attempts/:attemptId/review-decision`
  accepts `APPROVE`, `REJECT`, or `NEEDS_MORE_EVIDENCE`, with an optional note.
  Decisions are recorded once and do not independently verify a fix.

The dashboard is available at `/verifications`; the finding detail view also
shows attempt history and accepts human review decisions.

## Isolated runner contract and deployment

The API server never runs repository commands or applies patches. Without a
configured isolated runner, a request is recorded as `NEEDS_REVIEW` with
`BLOCKED` execution. A `VERIFIED` status cannot be supplied by the request or
derived from AI text.

Configure both `FIX_VERIFICATION_RUNNER_URL` and
`FIX_VERIFICATION_RUNNER_TOKEN` to enable the remote runner client. Production
requires an HTTPS URL. `FIX_VERIFICATION_RUNNER_TIMEOUT_MS` defaults to 300000
and is bounded to 1000–900000 milliseconds. The API sends an authenticated,
idempotent `POST /v1/verification-runs` request with:

- protocol version, verification attempt ID, patch and SHA-256 digest;
- repository URL/name, branch, pull request number and expected commit SHA;
- finding ID/title/severity/file and changed paths.

The API enqueues the attempt on the `fix-verification` BullMQ queue and returns
the queued attempt. The worker dispatches `POST /v1/verification-runs` and
accepts either a finished result or `202` with `executionOccurred: false`.
Completion arrives through the signed callback or a poll of the same attempt.
Deployment, isolation, and recovery are documented in
[verification-runner.md](verification-runner.md).

A finished result has this shape:

```json
{
  "patchSha256": "<64 lowercase hex characters>",
  "attemptId": "<verification attempt ID>",
  "commitSha": "<checked-out commit SHA>",
  "executionStatus": "SUCCEEDED",
  "testCommands": ["node --test"],
  "testsPassed": true,
  "originalIssueReproducedBefore": true,
  "originalIssueReproducedAfter": false,
  "sanitizedLogs": "All verification checks passed.",
  "checkResults": [
    {
      "name": "TEST",
      "command": "node --test",
      "status": "PASSED",
      "exitCode": 0,
      "durationMs": 1200,
      "failureDetails": null,
      "logs": "Tests passed."
    }
  ]
}
```

The API does not send GitHub credentials. The remote service must have its own
least-privilege access to the repositories it can verify, check that the
requested commit belongs to the repository, and apply the patch only to an
ephemeral checkout. It must return a JSON `VerificationExecutionResult` with
the exact patch digest and commit SHA, discovered test commands, structured
`TEST`/`TYPECHECK`/`LINT` check results, exit codes, durations, bounded logs,
and issue-specific before/after reproduction results. Malformed or incomplete
responses, transport errors, timeouts, and evidence mismatches are persisted
as `NEEDS_REVIEW`; only the stricter status classifier can set `VERIFIED`.

The runner deployment must execute repository-controlled scripts only in
disposable isolated environments, without production secrets, network access,
or host mounts; apply CPU, memory, process, disk, and wall-clock limits; clean
up checkouts after each run; and sanitize its own output. The API enforces a
maximum request/response size, rejects redirects, bounds timeouts, sanitizes
logs, and does not expose runner response bodies on errors. Do not point this
configuration at an API process or a shared production host that executes
repository scripts.

The verification request returns after the job is queued. Cancellation is
`POST /api/reviews/fix-verification-attempts/:attemptId/cancel`. A stale
`RUNNING` attempt is reconciled to `NEEDS_REVIEW` unless the runner still has
complete, bound evidence. Runner failures, timeouts, malformed responses, and
`executionOccurred: false` do not become `VERIFIED`.

Apply the additive Prisma migrations with the existing deployment command:

```text
npm run prisma:deploy --workspace=backend
```

The migration adds provenance and check evidence, adds human-review fields, and
renames legacy fix-attempt `INCONCLUSIVE` values to `NEEDS_REVIEW`.
