# Isolated fix-verification runner

The API process never checks out a repository or runs its tests. When
`FIX_VERIFICATION_RUNNER_URL` and `FIX_VERIFICATION_RUNNER_TOKEN` are both set,
`POST /api/reviews/fix-proposals/:proposalId/verification-attempts` stores an
attempt and enqueues a BullMQ job named `fix-verification`. The API worker
only dispatches that job to the separate runner. It does not execute the patch.

A result is `VERIFIED` only when the existing evidence rules pass: the commit
SHA and patch digest match, execution actually occurred, the runner identity
and version are present, every check passed with exit code 0, and the original
issue was reproduced before the patch and not after it. The runner does not
invent before/after reproduction. Until a deployed runner is exercised against
a real repository and those reproduction signals are measured, a run stays
`NEEDS_REVIEW`. `executionOccurred: false` is never stored as a passing test
result.

## Deploy the runner separately

Build and run `backend/Dockerfile.runner` as its own service. Do not point
`FIX_VERIFICATION_RUNNER_URL` at the API container. The image starts
`npm run start:runner` and listens on port 8080. The default sandbox mode is
`disabled`, which accepts jobs and reports that repository code was not
executed.

The API container must not receive the Docker socket. The runner control
plane may mount the socket so it can create sibling containers. Untrusted
execution never receives that socket, host credentials, or a privileged flag.
The sandbox arguments are `--network none`, `--user 65532:65532`,
`--cap-drop ALL`, `--security-opt no-new-privileges`, plus CPU, memory, process,
and tmpfs limits. `docker run --rm` removes the container, and the workspace
directory is deleted after every attempt.

Give the runner only `FIX_VERIFICATION_RUNNER_TOKEN`. Do not give it
`DATABASE_URL`, `JWT_SECRET`, GitHub tokens, OpenAI keys, Stripe keys, or the
API's cloud credentials. Checkout is off unless `VERIFICATION_ALLOW_FETCH=true`.
Fetch allows only HTTPS URLs on `VERIFICATION_ALLOWED_GIT_HOSTS` (default
`github.com`) and rejects credentials, localhost, private addresses, and cloud
metadata hosts. Git runs with hooks and credential helpers disabled. The
sandbox command is `node --test`. Package lifecycle scripts and test output are
not instructions.

## API environment

| Variable | Purpose |
| --- | --- |
| `FIX_VERIFICATION_RUNNER_URL` | Runner origin. Empty disables execution. Production must be HTTPS with no credentials, query, or fragment. |
| `FIX_VERIFICATION_RUNNER_TOKEN` | Shared bearer secret, at least 32 characters. Also the HMAC key. |
| `FIX_VERIFICATION_RUNNER_TIMEOUT_MS` | Dispatch HTTP timeout, 1000–900000. Default 300000. |
| `FIX_VERIFICATION_MAX_DISPATCH_ATTEMPTS` | Transport retries before execution is accepted. 1–5, default 3. |
| `FIX_VERIFICATION_STALE_AFTER_MS` | Age after which a `RUNNING` attempt is reconciled. 1000–3600000, default 900000. |
| `REDIS_URL` | BullMQ connection. The queue name is `fix-verification`. Job id is the attempt id. |

Requests use `Authorization: Bearer`, `Idempotency-Key`, `X-CodeGuard-Timestamp`,
and `X-CodeGuard-Signature` (HMAC-SHA256 of `timestamp.body`). The runner
callback is `POST /api/reviews/internal/verification-callback`. It uses the same
signature, does not use a user session, and is exempt from browser CSRF the
same way as the other signed webhooks. The API also polls
`GET /v1/verification-runs/:attemptId`.

## Runner environment

| Variable | Purpose |
| --- | --- |
| `FIX_VERIFICATION_RUNNER_TOKEN` | Same secret as the API. Required, 32+ characters. |
| `VERIFICATION_RUNNER_PORT` | Default 8080. |
| `VERIFICATION_RUNNER_IDENTITY` | Recorded on evidence. Default `ai-codeguard-runner`. |
| `VERIFICATION_RUNNER_VERSION` | Recorded on evidence. Default `1`. |
| `VERIFICATION_SANDBOX_MODE` | `disabled` (default) or `docker`. |
| `VERIFICATION_ALLOW_FETCH` | `true` checks out the exact commit before the sandbox runs. Default false. |
| `VERIFICATION_ALLOWED_GIT_HOSTS` | Comma-separated HTTPS hosts. Default `github.com`. |
| `VERIFICATION_CALLBACK_URL` | API callback URL. Polling still works if this is empty. |
| `VERIFICATION_SANDBOX_IMAGE` | Default `node:20-alpine`. |
| `VERIFICATION_SANDBOX_CPUS` | Default `1`. |
| `VERIFICATION_SANDBOX_MEMORY` | Default `512m`. Swap is pinned to the same value. |
| `VERIFICATION_SANDBOX_PIDS` | Default 64. |
| `VERIFICATION_SANDBOX_TIMEOUT_MS` | Default 300000. |
| `VERIFICATION_SANDBOX_WORKSPACE_BYTES` | Checkout size limit. Default 256 MiB. Larger checkouts are deleted. |
| `VERIFICATION_SANDBOX_TMPFS` | Default `64m` for `/tmp`. |

## Network policy

- Sandbox containers use `--network none`. They cannot reach the API, Redis,
  metadata endpoints, or private infrastructure.
- The control plane's fetch path, when explicitly enabled, is HTTPS to the
  allowed git hosts only. It is not a path for repository scripts to open
  their own connections.
- The callback client does not follow redirects.
- Keep the runner on a network that can reach Redis only from the API side.
  The runner itself does not connect to Redis.

## Queue and recovery

Jobs move through `QUEUED`, `RUNNING`, `PASSED`, `FAILED`, `TIMED_OUT`,
`CANCELLED`, and `NEEDS_REVIEW`. The user-facing status stays `RUNNING` until
the attempt finishes, and then becomes `VERIFIED`, `FAILED`, or `NEEDS_REVIEW`.
Human review is still a separate decision and does not change execution status.

- Transport failures before a runner accepts the job retry with exponential
  backoff, up to `FIX_VERIFICATION_MAX_DISPATCH_ATTEMPTS`. Test failures and
  timeouts are not retried.
- The runner treats the attempt id as an idempotency key and will not start a
  second sandbox for the same attempt.
- On startup the worker re-enqueues persisted `QUEUED` attempts and reconciles
  stale `RUNNING` attempts. Reconciliation repeats every 60 seconds.
- If the runner has no finished evidence, a stale attempt becomes
  `NEEDS_REVIEW` with `executionOccurred: false`. It is not marked `VERIFIED`.
- A second callback cannot upgrade an attempt that already finished.
- Cancellation sets `CANCELLED` and `NEEDS_REVIEW`. A later passing payload is
  ignored.
- `/health` includes `queues.fixVerification`.

Apply the job-lifecycle migration before starting the API:

```text
npm run prisma:deploy --workspace=backend
```

## What is not yet real verification

`VERIFICATION_SANDBOX_MODE=disabled` is the image default. Enabling Docker and
fetch executes `node --test` inside the sandbox and records evidence, but this
repository's tests do not start that Docker daemon. Do not describe a proposal
as verified until the runner is deployed and a run has produced complete,
bound evidence, including issue reproduction.
