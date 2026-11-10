import { describe, expect, it } from 'vitest'

import { validateFeedbackDraft, visibleOnboardingSteps } from './beta'

describe('beta feedback', () => {
  it('accepts a bug report and rejects secrets and incomplete review ratings', () => {
    expect(
      validateFeedbackDraft({
        category: 'BUG',
        subject: 'Empty findings',
        body: 'The review page stayed blank.',
      })
    ).toBeNull()
    expect(
      validateFeedbackDraft({
        category: 'BUG',
        subject: 'Connection',
        body: 'postgres://user:secret@localhost/db',
      })
    ).toMatch(/secrets/)
    expect(
      validateFeedbackDraft({
        category: 'REVIEW_QUALITY',
        subject: 'Quality',
        body: 'The summary was useful.',
      })
    ).toMatch(/rating/)
  })

  it('hides onboarding steps after they are dismissed', () => {
    const steps = [{ id: 'workspace', complete: false }]
    expect(visibleOnboardingSteps(steps, false)).toEqual(steps)
    expect(visibleOnboardingSteps(steps, true)).toEqual([])
  })
})
