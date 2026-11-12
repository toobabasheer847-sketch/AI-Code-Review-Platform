# AI provider configuration

Code review uses one OpenAI chat completion. No second provider is wired into the review path.

## Settings

| Variable | Role |
| --- | --- |
| `OPENAI_API_KEY` | Required for a live review. A missing or placeholder key fails the review with "AI review is not configured. Contact an administrator." The key is not written into prompts, findings, or logs by the review path. |
| `OPENAI_MODEL` | Optional. The default is `gpt-4o-mini`. The value must be a model id made of letters, digits, `.`, `_`, and `-`. |
| `AI_PRICING_CONFIG` | Optional JSON object of model ids to `{ "inputUsdPerMillion", "outputUsdPerMillion" }`. |
| `AI_PRICING_VERSION` | Required only when `AI_PRICING_CONFIG` is set. Without rates, estimated cost is stored as unknown rather than as zero. |

The review request uses temperature `0.1`, `max_tokens` 6000, a 60 second client timeout, and `maxRetries` 2. The response format is `json_object`. Retries are the OpenAI SDK's bounded retries for that single call. They are not an open loop.

## Usage records

When the worker has a user id, the call is recorded through `trackedChatCompletion` with feature `code_review` and request key `code-review:<reviewId>`. The stored idempotency key is a hash of that request key, prefixed with the workspace id when one is present. A later attempt for the same review updates the same usage row instead of inserting another. The row stores input, output, and total tokens, duration, status, and estimated cost when a price is configured.

Provider failures are classified as `missing_credentials`, `rate_limited` (HTTP 429), `timeout` (HTTP 408 or 504, an abort, or a timeout), `malformed_response`, or `provider_failure`. The review error shown to the user is one of the fixed messages in `ReviewProviderError`. Provider response bodies are not copied into that message.

## Output validation

The client accepts a JSON object, a fenced JSON block, or the first `{...}` span in a prose wrapper. The parsed object must match the review schema. Each finding must cite a real file and a line range of at most 20 lines, and the evidence string must occur in that range. Pull-request findings must overlap a changed line. Confidence below `0.60` is dropped and counted in `reviewLimitations`. A response that fails validation fails the review; it is not partially stored.

## Live checks

`npm run test:ai-review:live` calls the provider only when `RUN_LIVE_AI_REVIEW_TEST=1` and a non-placeholder key are both set. Otherwise the test is skipped. `npm run benchmark -- --live` has the same key requirement and does not skip quietly: it exits with an error when the key is missing.
