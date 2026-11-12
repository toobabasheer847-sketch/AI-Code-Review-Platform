# AI review architecture

AI-CodeGuard reviews one owned repository snapshot at a time. The review record, its findings, and the provider request are scoped to the authenticated user and that user's personal workspace.

## Pipeline

1. `POST /api/reviews/start` creates a pending review and enqueues one BullMQ job with id `review-<reviewId>`. The queue allows 3 attempts with exponential backoff.
2. The worker loads the review only when the job workspace matches the stored review. A completed review is not analyzed again; the worker only retries notification.
3. Source files come from the connected GitHub account. Pull-request reviews use the head SHA and the changed-line set. Files that do not fit are omitted and recorded as a limitation.
4. `analyzeCode` runs deterministic checks, then one provider call, then validation:
   - credential scan, before redaction
   - redaction of credential-like values in the text sent to the provider
   - cyclomatic-complexity check for TypeScript and JavaScript
   - swallowed `catch` check
   - pattern check for dynamic SQL, `eval` / `Function`, dynamic `exec`, dynamic HTML assignment, a data-access call directly inside a loop, assignment used as a condition, an empty Promise `catch`, a `window` or `document` listener without removal in that function, and `fetch` followed by a body read without `response.ok` or `response.status`
   - context assembly, capped at 60,000 characters of file JSON
   - one chat completion
   - schema and evidence validation
5. Static findings replace an overlapping model finding when the file, category, and line range match and the evidence is equal or one excerpt of at least 12 characters contains the other. Security findings are not removed because of owner rules or false-positive feedback.
6. Persistence deletes the review's findings and inserts the new set in one transaction. A retry therefore replaces rows instead of appending a second copy.

## Context

There is no vector index for review retrieval. Context is built only from the files already selected for the review:

- language groups and manifest dependency names
- framework hints for a fixed set of declared packages (Express, Fastify, Nest, Prisma, React, Next, Vue, Django, Flask, SQLAlchemy)
- relative import edges among those files
- exported function, class, and value names that appear in another supplied file
- changed files plus the supplied files that import them or that they import

Notes are placed in `<untrusted_repository_context>` and cannot override the system prompt. Files that were not selected are not described and are not inspected. Changed-line numbers, at most 400 per file, are included on the file payload so a pull-request review can stay on the diff. The note block itself is capped at 3,500 characters.

Race conditions and authorization gaps are not given a deterministic rule. Those reports are accepted only when the model cites supplied code that shows the conflicting operations or the missing check, and the citation survives evidence validation.

## Findings

Each stored finding keeps the legacy `severity` values `error`, `warning`, and `info` for existing clients. It also stores:

| Field | Meaning |
| --- | --- |
| `riskLevel` | `critical`, `high`, `medium`, `low`, or `informational`. A legacy `error` stays `high` unless the model explicitly chooses `critical`. |
| `category` | `bug`, `security`, `performance`, or `quality` |
| `issueClass` | `logic`, `security`, `performance`, `quality`, `maintainability`, `concurrency`, `error_handling`, `data_access`, `api_contract`, `resource_management`, or `authorization` |
| `confidence` | `0.85`–`1` confirmed, `0.60`–`0.84` potential, below `0.60` withheld. A missing score is kept as potential when the evidence matched. |
| `disposition` | `confirmed` or `potential` |
| `evidence`, `impact`, `suggestions`, `remediationExample` | The example is stored text. The product does not apply or execute it. |

The review screen groups findings by risk, and can filter by risk, category, and assessment and sort by severity, file, or confidence.

## Related code

- `backend/src/modules/code-review/analyzer.ts`
- `backend/src/modules/code-review/review-context.ts`
- `backend/src/modules/code-review/pattern-scanner.ts`
- `backend/src/modules/code-review/review.pipeline.ts`
- `backend/src/jobs/review.worker.ts`
- `frontend/src/features/reviews/components/ReviewDetails.tsx`
