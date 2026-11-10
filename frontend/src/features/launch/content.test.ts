import { describe, expect, it } from 'vitest'

import { cookieDraft, draftNotice, privacyDraft, termsDraft, userGuide } from './content'

describe('public launch copy', () => {
  it('marks legal pages as drafts and describes the implemented free-plan limit', () => {
    expect(draftNotice).toMatch(/professional review/i)
    expect(privacyDraft[0]?.body[0]).toMatch(/not a notice approved/i)
    expect(termsDraft[0]?.body[0]).toMatch(/not an offer/i)
    expect(cookieDraft[1]?.body.join(' ')).toMatch(/HttpOnly/)
    const guide = userGuide.flatMap((section) => section.body).join(' ')
    expect(guide).toMatch(/three code reviews/i)
    expect(guide).toMatch(/no Stripe Customer Portal/i)
  })
})