import { FindingStatus, Prisma } from '@prisma/client';
import { prisma } from '@/config/database';
import { getPersonalWorkspaceId } from '@/modules/workspaces/workspace.service';
import {
  canTransitionFindingStatus,
  type FindingStatusValue,
} from './finding-lifecycle.domain';

export class FindingNotFoundError extends Error {
  readonly statusCode = 404;

  constructor() {
    super('Finding not found');
    this.name = 'FindingNotFoundError';
  }
}

export class InvalidFindingTransitionError extends Error {
  readonly statusCode = 409;

  constructor(current: FindingStatusValue, next: FindingStatusValue) {
    super(`Cannot change finding status from ${current} to ${next}`);
    this.name = 'InvalidFindingTransitionError';
  }
}

export class FindingStatusConflictError extends Error {
  readonly statusCode = 409;

  constructor() {
    super('Finding status changed while this update was being saved. Refresh and try again.');
    this.name = 'FindingStatusConflictError';
  }
}

export interface OwnedFindingStatus {
  id: string;
  status: FindingStatusValue;
  independentlyVerifiedAt: Date | null;
}

export interface FindingFeedbackRecord {
  id: string;
  findingId: string;
  userId: string;
  previousStatus: FindingStatusValue;
  status: FindingStatusValue;
  reason: string | null;
  createdAt: Date;
  user: { fullName: string };
}

export interface FindingLifecycleStore {
  findOwnedFinding(
    userId: string,
    findingId: string,
    workspaceId?: string
  ): Promise<OwnedFindingStatus | null>;
  persistStatusChange(input: {
    userId: string;
    findingId: string;
    workspaceId?: string;
    previousStatus: FindingStatusValue;
    status: FindingStatusValue;
    reason: string | null;
  }): Promise<FindingFeedbackRecord>;
}

const prismaFindingLifecycleStore: FindingLifecycleStore = {
  async findOwnedFinding(userId, findingId, requestedWorkspaceId) {
    const workspaceId = requestedWorkspaceId ?? await getPersonalWorkspaceId(userId);
    return prisma.finding.findFirst({
      where: {
        id: findingId,
        review: { is: requestedWorkspaceId ? { workspaceId } : { userId, workspaceId } },
      },
      select: { id: true, status: true, independentlyVerifiedAt: true },
    });
  },

  async persistStatusChange(input) {
    const workspaceId = input.workspaceId ?? await getPersonalWorkspaceId(input.userId);
    const reviewScope = input.workspaceId
      ? { workspaceId }
      : { userId: input.userId, workspaceId };
    return prisma.$transaction(async (transaction) => {
      const changed = await transaction.finding.updateMany({
        where: {
          id: input.findingId,
          status: input.previousStatus,
          review: { is: reviewScope },
        },
        data: { status: input.status },
      });

      if (changed.count !== 1) {
        const stillOwned = await transaction.finding.findFirst({
          where: { id: input.findingId, review: { is: reviewScope } },
          select: { id: true },
        });
        if (!stillOwned) throw new FindingNotFoundError();
        throw new FindingStatusConflictError();
      }

      return transaction.findingFeedback.create({
        data: {
          findingId: input.findingId,
          userId: input.userId,
          previousStatus: input.previousStatus as FindingStatus,
          status: input.status as FindingStatus,
          reason: input.reason,
        },
        include: { user: { select: { fullName: true } } },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  },
};

export class FindingLifecycleService {
  constructor(private readonly store: FindingLifecycleStore = prismaFindingLifecycleStore) {}

  async updateStatus(
    userId: string,
    findingId: string,
    status: FindingStatusValue,
    reason?: string,
    workspaceId?: string
  ): Promise<FindingFeedbackRecord> {
    const finding = await this.store.findOwnedFinding(userId, findingId, workspaceId);
    if (!finding) throw new FindingNotFoundError();
    if (!canTransitionFindingStatus(finding.status, status)) {
      throw new InvalidFindingTransitionError(finding.status, status);
    }

    return this.store.persistStatusChange({
      userId,
      findingId,
      ...(workspaceId ? { workspaceId } : {}),
      previousStatus: finding.status,
      status,
      reason: reason || null,
    });
  }
}
