# Intelligent finding feedback

## Feedback capture

Authenticated repository owners can submit explicit human assessments for an
owned finding:

```text
POST /api/reviews/findings/:findingId/feedback
```

```json
{
  "requestKey": "client-generated-idempotency-key",
  "category": "FALSE_POSITIVE",
  "explanation": "The reported branch cannot be reached."
}
```

Supported categories are `TRUE_POSITIVE`, `FALSE_POSITIVE`, `ALREADY_FIXED`,
and `NEEDS_REVIEW`. The explanation is optional and limited to 1,000 characters.
The authenticated user, finding, and repository association are resolved by
the server. Repeating the same request key and payload returns the original
feedback; reusing that key for different feedback returns a conflict. New
request keys preserve additional feedback as history.

Assessment feedback is separate from finding lifecycle changes, AI-generated
findings, and independent verification records. A single false-positive report
does not suppress future findings or security findings and does not update or
retrain an AI model.

## Current scope

The initial implementation captures categorized, owner-scoped feedback and
displays its history in the finding detail UI. Aggregate false-positive rates,
rule/repository trends, project-specific review preferences, and context-aware
duplicate detection are follow-up phases; they are not yet exposed by this
module.

Apply the additive Prisma migration with:

```text
npm run prisma:deploy --workspace=backend
```
