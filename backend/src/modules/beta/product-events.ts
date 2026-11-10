import { prisma } from '@/config/database'
import logger from '@/utils/logger'

import type { ProductEventName } from './beta.domain'

type ProductEventWriter = (userId: string, name: ProductEventName) => Promise<void>

async function writeProductEvent(userId: string, name: ProductEventName): Promise<void> {
  await prisma.productEvent.create({ data: { userId, name } })
}

let writeEvent: ProductEventWriter = writeProductEvent

export function setProductEventWriter(writer: ProductEventWriter): void {
  writeEvent = writer
}

export function useDefaultProductEventWriter(): void {
  writeEvent = writeProductEvent
}

export async function recordProductEvent(userId: string, name: ProductEventName): Promise<void> {
  try {
    await writeEvent(userId, name)
  } catch (error) {
    logger.warn(
      { event: name, errorName: error instanceof Error ? error.name : 'UnknownError' },
      'product event was not recorded'
    )
  }
}
