// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useMe } from '@/features/auth/hooks/useAuth'
import { chatApi } from '@/features/chat/api/chatApi'
import { useGetRepos } from '@/features/github/hooks/useGitHub'
import { useGetReview, useListReviews } from '@/features/reviews/hooks/useReviews'

import { AIChatPage } from './AIChatPage'

vi.mock('@/features/chat/api/chatApi', () => ({
  chatApi: { askRepository: vi.fn(), askReview: vi.fn() },
}))

vi.mock('@/features/auth/hooks/useAuth', () => ({
  useMe: vi.fn(),
}))

vi.mock('@/features/github/hooks/useGitHub', () => ({
  useGetRepos: vi.fn(),
}))

vi.mock('@/features/reviews/hooks/useReviews', () => ({
  useGetReview: vi.fn(),
  useListReviews: vi.fn(),
}))

vi.mock('@/features/automation/components/AutomationShell', () => ({
  AutomationShell: ({ children }: { children: ReactNode }) => createElement('main', null, children),
}))

const repositories = {
  data: [{ name: 'example', full_name: 'owner/example', private: true, language: 'TypeScript', updated_at: '' }],
  isLoading: false,
  isError: false,
  isSuccess: true,
  refetch: vi.fn(),
}

const reviewList = {
  data: [{ id: 'review-1', repository: 'owner/example', status: 'completed', createdAt: '2026-10-01T00:00:00.000Z' }],
  isLoading: false,
  isError: false,
}

const reviewDetail = {
  id: 'review-1',
  repository: { name: 'owner/example', url: 'https://github.com/owner/example' },
  findings: [],
  findingLifecycleAnalytics: {
    total: 0,
    statusCounts: {},
    developerMarkedFixed: 0,
    independentlyVerifiedFixed: 0,
  },
  chat: {
    id: 'conversation-1',
    title: 'Review chat',
    messages: [
      { id: 'message-1', role: 'USER' as const, content: 'Why is this finding important?', createdAt: '2026-10-01T00:00:00.000Z' },
      { id: 'message-2', role: 'ASSISTANT' as const, content: 'It exposes an input validation gap.', createdAt: '2026-10-01T00:00:01.000Z' },
    ],
  },
  status: 'completed',
  branch: 'main',
  createdAt: '2026-10-01T00:00:00.000Z',
}

let root: Root | null = null
let container: HTMLDivElement | null = null

function render(): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(
      <MemoryRouter>
        <AIChatPage />
      </MemoryRouter>
    )
  })
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  act(() => {
    valueSetter?.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
  })
}

function clickButton(label: string): void {
  const button = Array.from(container?.querySelectorAll('button') ?? []).find(
    (item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label
  )
  if (!button) throw new Error(`Button not found: ${label}`)
  act(() => button.click())
}

beforeEach(() => {
  vi.mocked(useMe).mockReturnValue({ data: { fullName: 'Ada Lovelace', githubConnected: true } } as never)
  vi.mocked(useGetRepos).mockReturnValue(repositories as never)
  vi.mocked(useListReviews).mockReturnValue(reviewList as never)
  vi.mocked(useGetReview).mockImplementation((id) =>
    (id ? { data: reviewDetail, isLoading: false, isFetching: false, isError: false } : {
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
    }) as never
  )
  vi.mocked(chatApi.askRepository).mockReset()
  vi.mocked(chatApi.askReview).mockReset()
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('AI chat page', () => {
  it('sends repository questions and separates returned evidence from the AI explanation', async () => {
    vi.mocked(chatApi.askRepository).mockResolvedValue({
      answer: 'Authentication is handled in the API middleware.',
      evidence: [{
        id: 'source-1',
        file: 'src/auth.ts',
        lineStart: 10,
        lineEnd: 12,
        snippet: 'verifyToken(request)',
      }],
      insufficientInformation: false,
      sourceRevision: 'abcdef1234567890',
      limitations: [],
    })
    render()
    await settle()

    setValue(container!.querySelector('select[aria-label="Connected repository"]')!, 'owner/example')
    setValue(container!.querySelector('textarea')!, 'Where is authentication handled?')
    clickButton('Send message')
    await settle()

    expect(chatApi.askRepository).toHaveBeenCalledWith({
      repository: 'owner/example',
      branch: 'main',
      question: 'Where is authentication handled?',
    })
    expect(container?.textContent).toContain('AI-generated explanation')
    expect(container?.textContent).toContain('Retrieved source evidence')
    expect(container?.textContent).toContain('src/auth.ts:10-12')
    expect(container?.textContent).toContain('verifyToken(request)')
  })

  it('shows provider errors and retries the failed repository request', async () => {
    vi.mocked(chatApi.askRepository)
      .mockRejectedValueOnce({ response: { data: { error: 'Repository access denied' } } })
      .mockResolvedValueOnce({
        answer: 'The answer is available.',
        evidence: [],
        insufficientInformation: false,
        sourceRevision: null,
        limitations: [],
      })
    render()
    await settle()
    setValue(container!.querySelector('select[aria-label="Connected repository"]')!, 'owner/example')
    setValue(container!.querySelector('textarea')!, 'Explain this code')
    clickButton('Send message')
    await settle()

    expect(container?.textContent).toContain('Repository access denied')
    clickButton('Retry')
    await settle()

    expect(chatApi.askRepository).toHaveBeenCalledTimes(2)
    expect(container?.textContent).toContain('The answer is available.')
    expect(container?.textContent).not.toContain('Repository access denied')
  })

  it('shows a loading state while the repository answer is being generated', async () => {
    let resolveAnswer: ((value: {
      answer: string
      evidence: []
      insufficientInformation: boolean
      sourceRevision: null
      limitations: []
    }) => void) | undefined
    vi.mocked(chatApi.askRepository).mockReturnValue(
      new Promise((resolve) => {
        resolveAnswer = resolve
      })
    )
    render()
    await settle()
    setValue(container!.querySelector('select[aria-label="Connected repository"]')!, 'owner/example')
    setValue(container!.querySelector('textarea')!, 'Explain this code')
    clickButton('Send message')
    await settle()

    expect(container?.textContent).toContain('Retrieving context and preparing an answer...')
    expect(container?.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')?.disabled).toBe(true)
    await act(async () => {
      resolveAnswer?.({
        answer: 'Answer received.',
        evidence: [],
        insufficientInformation: false,
        sourceRevision: null,
        limitations: [],
      })
    })
    expect(container?.textContent).toContain('Answer received.')
  })

  it('loads persisted history for a selected owned review and sends review-specific questions', async () => {
    vi.mocked(chatApi.askReview).mockResolvedValue({
      answer: 'This finding validates request parameters.',
      conversationId: 'conversation-1',
    })
    render()
    await settle()
    clickButton('Review chat')
    setValue(container!.querySelector('select[aria-label="Completed review"]')!, 'review-1')
    await settle()

    expect(container?.textContent).toContain('Why is this finding important?')
    expect(container?.textContent).toContain('It exposes an input validation gap.')
    setValue(container!.querySelector('textarea')!, 'Explain the finding')
    clickButton('Send message')
    await settle()

    expect(chatApi.askReview).toHaveBeenCalledWith({
      reviewId: 'review-1',
      message: 'Explain the finding',
    })
    expect(container?.textContent).toContain('This finding validates request parameters.')
  })

  it('blocks review chat when the selected review is not available to the user', async () => {
    vi.mocked(useGetReview).mockImplementation((id) =>
      (id ? { data: undefined, isLoading: false, isFetching: false, isError: true, refetch: vi.fn() } : {
        data: undefined,
        isLoading: false,
        isFetching: false,
        isError: false,
        refetch: vi.fn(),
      }) as never
    )
    render()
    await settle()
    clickButton('Review chat')
    setValue(container!.querySelector('select[aria-label="Completed review"]')!, 'review-1')
    await settle()

    expect(container?.textContent).toContain('This review is unavailable to your account.')
    expect(container?.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')?.disabled).toBe(true)
    expect(chatApi.askReview).not.toHaveBeenCalled()
  })

  it('does not expose repository Q&A when the connected repository query fails', async () => {
    vi.mocked(useGetRepos).mockReturnValue({
      ...repositories,
      data: undefined,
      isSuccess: false,
      isError: true,
    } as never)
    render()
    await settle()

    expect(container?.textContent).toContain('Unable to load your connected repositories.')
    const sendButton = container?.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')
    expect(sendButton?.disabled).toBe(true)
    expect(chatApi.askRepository).not.toHaveBeenCalled()
  })
})
