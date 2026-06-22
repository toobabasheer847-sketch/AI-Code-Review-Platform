import { prisma } from '@/config/database'
import { AIChatService } from './ai.chat.service'
import { buildChatContext } from './context.builder'
import { ChatMessageRole } from './chat.types'

export class ChatService {
  private readonly aiService = new AIChatService()

  private estimateQualityScore(issueCount: number): number {
    return Math.max(30, 100 - issueCount * 9)
  }

  public async sendMessage(userId: string, reviewId: string, message: string): Promise<{ answer: string; conversationId: string }> {
    const review = await prisma.codeReview.findUnique({
      where: { id: reviewId },
      include: {
        repository: { select: { name: true } },
        findings: true,
        chatConversation: {
          include: {
            messages: { orderBy: { createdAt: 'asc' } },
          },
        },
      },
    })

    if (!review) {
      throw new Error('Review not found')
    }

    if (review.userId !== userId) {
      throw new Error('Unauthorized to access this review')
    }

    const existingConversation = review.chatConversation
    const previousMessages = existingConversation?.messages ?? []

    const context = buildChatContext({
      repositoryName: review.repository.name,
      review: { title: review.title, description: review.description, fileContent: review.fileContent },
      findings: review.findings,
      previousMessages: previousMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    })

    const conversation = existingConversation
      ? existingConversation
      : await prisma.chatConversation.create({
          data: {
            userId,
            reviewId,
            title: `AI Chat: ${review.title}`,
          },
        })

    await prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: ChatMessageRole.USER,
        content: message,
      },
    })

    const allMessages = [...previousMessages, { role: ChatMessageRole.USER, content: message } as any]
    const answer = await this.aiService.generateAnswer(context, message, allMessages)

    await prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: ChatMessageRole.ASSISTANT,
        content: answer,
      },
    })

    if (!review.chatConversation) {
      await prisma.chatConversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      })
    }

    return {
      answer,
      conversationId: conversation.id,
    }
  }
}
