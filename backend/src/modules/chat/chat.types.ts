export enum ChatMessageRole {
  USER = 'USER',
  ASSISTANT = 'ASSISTANT',
}

export interface ChatMessagePayload {
  role: ChatMessageRole
  content: string
}

export interface ChatResponse {
  answer: string
  conversationId: string
}
