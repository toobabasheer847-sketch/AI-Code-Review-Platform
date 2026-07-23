export const ChatMessageRole = {
  USER: 'USER',
  ASSISTANT: 'ASSISTANT',
} as const

export type ChatMessageRole = (typeof ChatMessageRole)[keyof typeof ChatMessageRole]

export interface ChatMessage {
  role: ChatMessageRole
  content: string
}

export interface ChatMessagePayload {
  role: ChatMessageRole
  content: string
}

export interface ChatResponse {
  answer: string
  conversationId: string
}
