# AI review security

## Tenant isolation

Review list, read, and delete operations load the caller's personal workspace and then query by both user id and workspace id. The worker's `findForProcessing` lookup also requires the job workspace to match the review. A missing review, or a review owned by someone else, is not analyzed.

Source text is fetched with the connected GitHub token of the review owner. The prompt for a review contains that review's selected files and notes derived from those files. It does not include another tenant's repository, findings, or memory.

Usage rows are upserted with a workspace-scoped idempotency key. Review output is not placed in a shared cache. There is no cross-tenant cache of prompts or findings.

## Secrets

Credential-shaped tokens and assignments are redacted before source is placed in the prompt or in the stored file snapshot. The same redaction is applied to remediation examples and to pattern-scanner evidence lines. The model is instructed not to include secrets in examples. A detected credential becomes a security finding whose stored evidence uses `[REDACTED]` rather than the value.

`OPENAI_API_KEY` and GitHub tokens are read from server configuration or encrypted storage. They are not review-prompt fields.

## Untrusted repository content

The system prompt is the instruction. Repository files, architecture notes, and owner review rules are sent as later user messages inside explicit untrusted delimiters. Tests check that an instruction embedded in a file does not move into the system prompt and does not remove a credential finding. Owner rules cannot hide a security finding or change the JSON contract.

Deterministic scanners use the TypeScript parser. They do not evaluate repository code, and they do not turn a string found in the file into a command.

## Suggestions are not actions

Remediation examples and test suggestions are text. The review UI states that an example is not applied or executed. Fix proposals are stored for a person to review. Applying a proposal or running a test requires the separate verification flow, which stays inconclusive when no isolated runner is configured. The model response is never passed to a shell.

## What this does not prove

Static checks cover a narrow set of TypeScript and JavaScript patterns. They do not establish that a repository is free of injection, authorization, or concurrency bugs. A finding marked confirmed means the cited excerpt matched the source and the confidence rule classified it as directly supported. It is not an exploit demonstration and it is not a substitute for human review.
