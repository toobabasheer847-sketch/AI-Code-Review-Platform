import OpenAI from 'openai'
import { ConversationBufferMemory } from 'langchain/memory'
import { env } from '@/config/env'
import type { ChatMessage, ChatMessageRole } from './chat.types'

export class AIChatService {
  private readonly client = new OpenAI({ apiKey: env.OPENAI_API_KEY })

  private buildMemory(messages: ChatMessage[]): ConversationBufferMemory {
    const memory = new ConversationBufferMemory({ memoryKey: 'chat_history' } as any)

    for (const message of messages) {
      if (message.role === ChatMessageRole.USER) {
        // Save the user message as input without an assistant response yet.
        memory.saveContext({ input: message.content }, { output: '' } as any)
      } else {
        memory.saveContext({ input: '', output: message.content } as any)
      }
    }

    return memory
  }

  public async generateAnswer(context: string, userMessage: string, history: ChatMessage[]): Promise<string> {
    const memory = this.buildMemory(history)
    const memoryVariables = await memory.loadMemoryVariables({ input: userMessage } as any).catch(() => ({ chat_history: '' }))
    const chatHistory = memoryVariables.chat_history || ''

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
