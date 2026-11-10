import { cookieDraft, draftNotice, privacyDraft, termsDraft, userGuide } from '../content'

import { PublicInfoPage } from './PublicInfoPage'

export function DocsPage(): JSX.Element {
  return <PublicInfoPage title="User guide" notice="Product guide for the current build." sections={userGuide} />
}

export function PrivacyDraftPage(): JSX.Element {
  return <PublicInfoPage title="Privacy Policy draft" notice={draftNotice} sections={privacyDraft} />
}

export function TermsDraftPage(): JSX.Element {
  return <PublicInfoPage title="Terms of Service draft" notice={draftNotice} sections={termsDraft} />
}

export function CookieDraftPage(): JSX.Element {
  return <PublicInfoPage title="Cookie Policy draft" notice={draftNotice} sections={cookieDraft} />
}
