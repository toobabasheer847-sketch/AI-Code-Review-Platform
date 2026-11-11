# Public launch drafts

These pages are engineering drafts for a public launch. They match the controls currently implemented in this repository. They are not a claim that production deployment, live Stripe charges, or legal review is complete.

The same material is shown in the application at `/docs`, `/privacy`, `/terms`, and `/cookies`. Each legal page is marked for professional review.

## Guides

- Getting started: register, verify email, then sign in with the HttpOnly session.
- GitHub: connect the account that can read the repository. The token is encrypted at rest.
- AI review: Free allows three code reviews per calendar month. Entitled Pro does not apply that cap. Finding-level feedback stays on the review page.
- Repository chat: answers cite retrieved excerpts. Chat currently resolves the caller’s personal workspace.
- Workspaces: membership is checked before workspace data is returned. Invitation tokens are stored as hashes.
- Billing: Stripe checkout, cancellation at period end, and failed-invoice handling exist. A Stripe Customer Portal screen is not implemented. Workspace checkout is not available. Use Stripe test mode until live payments are explicitly approved.

The 2026-11-11 execution record, checklist, monitoring plan, and incident process are in [PUBLIC-LAUNCH-EXECUTION.md](./PUBLIC-LAUNCH-EXECUTION.md). Production launch was not approved.

## Launch blockers that remain operational

Domain and SSL, production environment review, a current backup restore, on-call alert delivery, and GitHub environment reviewers are still manual launch tasks. Do not treat this directory as approval to deploy.
