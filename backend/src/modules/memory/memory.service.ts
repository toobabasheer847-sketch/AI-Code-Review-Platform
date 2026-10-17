import { WorkMemorySource } from '@prisma/client';
import {
  containsSensitiveValue,
  formatMemoryContext,
  MAX_MEMORY_CONTENT_LENGTH,
  selectRelevantMemories,
  type WorkMemoryInput,
} from './memory.domain';
import { PrismaWorkMemoryStore, type WorkMemoryStore } from './memory.store';

export class WorkMemoryError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'WorkMemoryError';
  }
}

export class WorkMemoryService {
  constructor(private readonly store: WorkMemoryStore = new PrismaWorkMemoryStore()) {}

  async projects(userId: string): Promise<Array<{ id: string; name: string }>> {
    return this.store.projects(userId);
  }

  async list(userId: string) {
    return this.store.list(userId);
  }

  async getSettings(userId: string): Promise<{ enabled: boolean }> {
    const enabled = await this.store.memoryEnabled(userId);
    if (enabled === null) throw new WorkMemoryError('User not found.', 404);
    return { enabled };
  }

  async setEnabled(userId: string, enabled: boolean): Promise<{ enabled: boolean }> {
    if (!(await this.store.setMemoryEnabled(userId, enabled))) {
      throw new WorkMemoryError('User not found.', 404);
    }
    return { enabled };
  }

  async create(userId: string, input: WorkMemoryInput) {
    await this.validateReferences(userId, input);
    return this.store.create(userId, input);
  }

  async update(userId: string, memoryId: string, input: WorkMemoryInput) {
    await this.validateReferences(userId, input);
    const updated = await this.store.update(userId, memoryId, input);
    if (!updated) throw new WorkMemoryError('Memory not found.', 404);
    return updated;
  }

  async delete(userId: string, memoryId: string): Promise<void> {
    if (!(await this.store.delete(userId, memoryId))) {
      throw new WorkMemoryError('Memory not found.', 404);
    }
  }

  async contextForPlan(userId: string, goal: string): Promise<string> {
    if (!(await this.store.memoryEnabled(userId))) return '';
    const memories = await this.store.list(userId, 100);
    return formatMemoryContext(selectRelevantMemories(memories, goal));
  }

  private async validateReferences(userId: string, input: WorkMemoryInput): Promise<void> {
    const content = input.content.trim();
    if (!content || content.length > MAX_MEMORY_CONTENT_LENGTH) {
      throw new WorkMemoryError(
        `Memory content must be between 1 and ${MAX_MEMORY_CONTENT_LENGTH} characters.`,
        400
      );
    }
    if (containsSensitiveValue(content) || containsSensitiveValue(input.sourceLabel)) {
      throw new WorkMemoryError(
        'Do not save credentials or sensitive personal information in work memory.',
        400
      );
    }
    if (input.source === WorkMemorySource.APPROVED_WORKFLOW) {
      if (!input.sourceId) {
        throw new WorkMemoryError('Select a completed workflow as the source.', 400);
      }
      if (!(await this.store.ownsCompletedWorkflow(userId, input.sourceId))) {
        throw new WorkMemoryError('Completed workflow not found.', 404);
      }
    } else if (input.sourceId) {
      throw new WorkMemoryError('This source type cannot reference a workflow.', 400);
    }
    if (
      (input.source === WorkMemorySource.INFERENCE && input.confidence === undefined) ||
      (input.source !== WorkMemorySource.INFERENCE && input.confidence !== undefined)
    ) {
      throw new WorkMemoryError('Confidence is required only for uncertain inferences.', 400);
    }
    if (input.repositoryId) {
      if (!(await this.store.ownsProject(userId, input.repositoryId))) {
        throw new WorkMemoryError('Project not found.', 404);
      }
    }
    if (
      input.confidence !== undefined &&
      (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)
    ) {
      throw new WorkMemoryError('Confidence must be between 0 and 1.', 400);
    }
  }
}
