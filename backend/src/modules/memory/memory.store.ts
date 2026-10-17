import { AutomationStatus, type Prisma } from '@prisma/client';
import { prisma } from '@/config/database';
import { ownedMemoryWhere, type WorkMemoryInput } from './memory.domain';

const memoryInclude = {
  repository: { select: { id: true, name: true } },
} satisfies Prisma.WorkMemoryInclude;

export type WorkMemoryEntry = Prisma.WorkMemoryGetPayload<{ include: typeof memoryInclude }>;

export interface WorkMemoryStore {
  projects(userId: string): Promise<Array<{ id: string; name: string }>>;
  list(userId: string, limit?: number): Promise<WorkMemoryEntry[]>;
  memoryEnabled(userId: string): Promise<boolean | null>;
  setMemoryEnabled(userId: string, enabled: boolean): Promise<boolean>;
  create(userId: string, input: WorkMemoryInput): Promise<WorkMemoryEntry>;
  update(userId: string, memoryId: string, input: WorkMemoryInput): Promise<WorkMemoryEntry | null>;
  delete(userId: string, memoryId: string): Promise<boolean>;
  ownsCompletedWorkflow(userId: string, workflowId: string): Promise<boolean>;
  ownsProject(userId: string, projectId: string): Promise<boolean>;
}

export class PrismaWorkMemoryStore implements WorkMemoryStore {
  projects(userId: string): Promise<Array<{ id: string; name: string }>> {
    return prisma.repository.findMany({
      where: { userId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  list(userId: string, limit?: number): Promise<WorkMemoryEntry[]> {
    return prisma.workMemory.findMany({
      where: ownedMemoryWhere(userId),
      include: memoryInclude,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      ...(limit ? { take: limit } : {}),
    });
  }

  async memoryEnabled(userId: string): Promise<boolean | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { workMemoryEnabled: true },
    });
    return user?.workMemoryEnabled ?? null;
  }

  async setMemoryEnabled(userId: string, enabled: boolean): Promise<boolean> {
    const result = await prisma.user.updateMany({
      where: { id: userId },
      data: { workMemoryEnabled: enabled },
    });
    return result.count === 1;
  }

  create(userId: string, input: WorkMemoryInput): Promise<WorkMemoryEntry> {
    return prisma.workMemory.create({
      data: { userId, ...input },
      include: memoryInclude,
    });
  }

  async update(
    userId: string,
    memoryId: string,
    input: WorkMemoryInput
  ): Promise<WorkMemoryEntry | null> {
    const updated = await prisma.workMemory.updateMany({
      where: ownedMemoryWhere(userId, memoryId),
      data: input,
    });
    if (updated.count !== 1) return null;
    return prisma.workMemory.findFirst({
      where: ownedMemoryWhere(userId, memoryId),
      include: memoryInclude,
    });
  }

  async delete(userId: string, memoryId: string): Promise<boolean> {
    const deleted = await prisma.workMemory.deleteMany({
      where: ownedMemoryWhere(userId, memoryId),
    });
    return deleted.count === 1;
  }

  async ownsCompletedWorkflow(userId: string, workflowId: string): Promise<boolean> {
    const workflow = await prisma.automation.findFirst({
      where: { id: workflowId, userId, status: AutomationStatus.COMPLETED },
      select: { id: true },
    });
    return workflow !== null;
  }

  async ownsProject(userId: string, projectId: string): Promise<boolean> {
    const project = await prisma.repository.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    });
    return project !== null;
  }
}
