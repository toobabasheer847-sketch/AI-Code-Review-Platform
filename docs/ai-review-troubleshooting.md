# AI review troubleshooting

Review status is `pending`, `running`, `completed`, or `failed`. The review page states which of those applies. A failed review shows `errorMessage` when one was stored. These are the messages the worker is allowed to save:

| Message | What to check |
| --- | --- |
| AI review is not configured. Contact an administrator. | `OPENAI_API_KEY` is missing or still a placeholder. See [ai-provider-configuration.md](ai-provider-configuration.md). |
| The AI provider rate limit was reached. Retry the review later. | Provider HTTP 429. The client retries at most twice inside one call, and the queue retries the job at most 3 times. Wait before starting another review. |
| The AI provider timed out. Retry the review. | The client timeout is 60 seconds, or the request was aborted. |
| The AI provider returned a response that could not be validated. | The response was empty, not JSON, or a finding cited a file, line, or excerpt that is not in the supplied source. Nothing from that response is stored. |
| The AI provider could not complete the review. Retry later. | Another provider error. The provider body is not copied into the review. |
| Review processing failed. Provider and repository details were omitted. | GitHub fetch, revision mismatch, or another non-provider failure. Pull-request reviews fail when the fetched revision does not match the head SHA. |

Queue attempts do not create a second review row. The job id is `review-<reviewId>`. If analysis already completed, a later attempt only retries the notification. Finding rows are deleted and rewritten in the same transaction, so a repeated completion does not append a duplicate set. Email uses job id `review-complete-<reviewId>`.

## Completed reviews that look incomplete

`reviewLimitations` on the review explains a partial result. Typical entries:

- source files were omitted because the 60,000-character context budget was full
- context notes were truncated at 3,500 characters
- GitHub returned a truncated tree
- one or more findings were withheld because confidence was below 0.60
- a security-labeled finding was withheld rather than stored as a confirmed vulnerability
- deterministic checks skipped non-JS/TS files, syntax errors, or a file over the static-analysis size budget
- false-positive feedback was not applied to security findings

A completed review with zero findings means no cited issue survived validation. It does not mean the repository was fully proven safe. The score is a heuristic from the counts of stored findings.

## Confidence and duplicates

Scores at or above 0.85 are shown as confirmed. Scores from 0.60 through 0.84 are potential. Missing scores stay visible as potential when the evidence matched. The same file, category, and overlapping lines are collapsed when the evidence matches, including the case where the model quotes a long excerpt of a line the deterministic scanner also cited.

## Local checks

From `backend`:

```bash
npx tsx --test src/modules/code-review/analyzer.test.ts src/modules/code-review/pattern-scanner.test.ts src/modules/code-review/review-context.test.ts src/modules/code-review/review-intelligence.test.ts src/modules/code-review/benchmark/benchmark.test.ts
npm run benchmark
```

The live provider test stays skipped until `RUN_LIVE_AI_REVIEW_TEST=1` is set in an environment that already has a real key. Do not point that test at a production tenant or production data.

From `frontend`:

```bash
npx vitest run src/features/reviews/components/ReviewDetails.test.tsx
```
