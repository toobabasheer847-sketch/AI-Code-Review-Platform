import type { PublicSection } from './pages/PublicInfoPage'

export const draftNotice = 'Draft for professional review. This is not a legally approved policy.'

export const userGuide: PublicSection[] = [
  {
    heading: 'Getting started',
    body: [
      'Create an account with an email address and password. Confirm the verification code before using product routes. You can still open account routes to resend verification or sign out.',
      'After verification, sign in. The session is an HttpOnly cookie. Sign out clears that session.',
    ],
  },
  {
    heading: 'Connect a GitHub repository',
    body: [
      'Use Connect GitHub and authorize the account that can read the repository. The access token is encrypted before it is stored.',
      'Open Repositories and confirm the expected account is connected. The product records the first successful GitHub connection. It does not store repository source in product analytics.',
    ],
  },
  {
    heading: 'Run an AI code review',
    body: [
      'Start a review for a repository and branch. Free accounts can run three code reviews in a calendar month. An entitled Pro subscription does not apply that monthly cap.',
      'Read the findings on the review page. Use the finding feedback controls there to mark a finding true positive, false positive, already fixed, or needs review. That path is separate from the beta product-feedback form.',
    ],
  },
  {
    heading: 'Ask the repository chat',
    body: [
      'Repository chat answers from retrieved source excerpts and cites those excerpts. It can say when the retrieved context is insufficient.',
      'Review chat currently follows the personal workspace. A team workspace can return not found for that chat path.',
    ],
  },
  {
    heading: 'Manage a workspace',
    body: [
      'A personal workspace is created with the account. Create another workspace when a team needs shared membership.',
      'Owners and admins invite members by email. Invitation links are hashed in storage. Roles are owner, admin, developer, and viewer. A member can only see workspaces where membership is active.',
    ],
  },
  {
    heading: 'Billing',
    body: [
      'New accounts start on Free. Pro checkout uses the Stripe price configured for the frontend. Leave live Stripe keys unset until a launch approver enables them.',
      'Cancel an active Pro subscription from Billing. Access continues until the current period ends. A failed invoice payment marks the local subscription expired. There is no Stripe Customer Portal screen in this build. Workspace-level checkout is not available yet.',
    ],
  },
  {
    heading: 'Troubleshooting',
    body: [
      'If sign-in returns to the verification page, enter the latest email code or request another code. Account security and verification attempts are rate limited.',
      'If a review says the free limit is reached, wait for the next calendar month or use an entitled Pro subscription.',
      'If GitHub repositories do not appear, reconnect the GitHub account that has access to those repositories.',
      'If a workspace page says the workspace was not found, select a workspace where your membership is active.',
    ],
  },
]

export const privacyDraft: PublicSection[] = [
  {
    heading: 'Who this draft covers',
    body: [
      'This draft describes the data the current AI-CodeGuard application is built to process. It is not a notice approved by counsel.',
    ],
  },
  {
    heading: 'Account data',
    body: [
      'Registration stores an email address, name, and password hash. Email verification and password reset use hashed, expiring tokens. The session cookie is HttpOnly.',
    ],
  },
  {
    heading: 'Repository and review data',
    body: [
      'Connecting GitHub stores the provider identity and an encrypted access token. Reviews can store repository file content so findings can be shown again. Do not connect repositories you are not allowed to process.',
    ],
  },
  {
    heading: 'Product analytics',
    body: [
      'When the beta tables are present, the application can store an allowlisted event name and user id for registration, workspace creation, GitHub connection, review start, review completion, repository chat, and feedback submission. Those events are not a record of source code or prompts.',
    ],
  },
  {
    heading: 'Billing',
    body: [
      'Stripe processes checkout and subscription events. The application stores the subscription status it needs to apply the review quota. Card numbers are not stored in this application.',
    ],
  },
]

export const termsDraft: PublicSection[] = [
  {
    heading: 'Status of this draft',
    body: [
      'These terms are an engineering draft for counsel. They are not an offer, a contract, or an approved customer agreement.',
    ],
  },
  {
    heading: 'The service',
    body: [
      'AI-CodeGuard provides account access, workspace membership, GitHub-backed code review, repository chat, and optional Stripe billing. AI output can be wrong. A human should review findings before acting on them.',
    ],
  },
  {
    heading: 'Accounts and acceptable use',
    body: [
      'You need a verified email address for product routes. Do not submit secrets, credentials, or data you lack permission to process. Registration, login, verification, and password reset are rate limited.',
    ],
  },
  {
    heading: 'Plans',
    body: [
      'Free includes three code reviews per calendar month. Pro checkout depends on the configured Stripe price and does not apply that monthly cap while the subscription is entitled. Other AI use is not covered by a general budget in this build.',
    ],
  },
]

export const cookieDraft: PublicSection[] = [
  {
    heading: 'Status of this draft',
    body: [
      'This cookie draft explains the cookies the current application sets. It is not an approved cookie policy.',
    ],
  },
  {
    heading: 'Cookies used',
    body: [
      'The session cookie authenticates the browser and is HttpOnly. A signed CSRF cookie is used for cookie-authenticated changes. OAuth flows can use a short-lived state cookie. The application removes a legacy readable token cookie when it loads.',
      'These cookies are required to sign in and submit changes. This build does not add an advertising or analytics cookie.',
    ],
  },
]
