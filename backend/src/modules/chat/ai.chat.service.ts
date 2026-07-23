import OpenAI from 'openai'
import { env } from '@/config/env'
import { ChatMessageRole, type ChatMessage } from './chat.types'

export class AIChatService {
  private readonly client = new OpenAI({ apiKey: env.OPENAI_API_KEY })

  private buildHistory(messages: ChatMessage[]): string {
    return messages
      .map((message) => `${message.role === ChatMessageRole.USER ? 'User' : 'Assistant'}: ${message.content}`)
      .join('\n')
  }

  public async generateAnswer(context: string, userMessage: string, history: ChatMessage[]): Promise<string> {
    const chatHistory = this.buildHistory(history)

    const prompt = `You are AI-CodeGuard, an AI assistant for code review. Use the context below to answer clearly and include why an issue exists, how to fix it, and any security or quality guidance.\n\n${context}\n\nPrevious chat history:\n${chatHistory}\n\nUser question:\n${userMessage}`

    const completion = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful code review assistant.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      max_tokens: 1000,
    })

    return completion.choices?.[0]?.message?.content?.trim() || 'I could not generate a response for that request.'
  }
}
