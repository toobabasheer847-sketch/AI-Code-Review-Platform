import { Prisma } from '@prisma/client';
import { prisma } from '@/config/database';
import {
  compareRepositoryReviewRules,
  createRepositoryReviewRuleSchema,
  MAX_REPOSITORY_REVIEW_RULES,
  snapshotOf,
  updateRepositoryReviewRuleSchema,
  type RepositoryReviewRuleRecord,
  type RepositoryReviewRuleRevisionRecord,
  type RepositoryReviewRuleSnapshot,
} from './repository-review-rules.domain';
import type { PromptReviewRule } from './repository-review-rules.prompt';
import { getPersonalWorkspaceId } from '@/modules/workspaces/workspace.service';

export class RepositoryNotFoundError extends Error {
  readonly statusCode = 404;

  constructor() {
    super('Repository not found');
    this.name = 'RepositoryNotFoundError';
  }
}

export class RepositoryReviewRuleNotFoundError extends Error {
  readonly statusCode = 404;

  constructor() {
    super('Review rule not found');
    this.name = 'RepositoryReviewRuleNotFoundError';
  }
}

export class InvalidRepositoryReviewRuleError extends Error {
  readonly statusCode = 400;

  constructor() {
    super('Invalid repository review rule.');
    this.name = 'InvalidRepositoryReviewRuleError';
  }
}

export class RepositoryReviewRuleLimitError extends Error {
  readonly statusCode = 409;

  constructor() {
    super(`A repository can have at most ${MAX_REPOSITORY_REVIEW_RULES} review rules.`);
    this.name = 'RepositoryReviewRuleLimitError';
  }
}

export interface RepositoryReviewRuleStore {
  ownsRepository(userId: string, repositoryId: string): Promise<boolean>;
  list(userId: string, repositoryId: string): Promise<RepositoryReviewRuleRecord[]>;
  count(repositoryId: string): Promise<number>;
  get(userId: string, repositoryId: string, ruleId: string): Promise<RepositoryReviewRuleRecord | null>;
  create(rule: RepositoryReviewRuleRecord): Promise<RepositoryReviewRuleRecord>;
  save(rule: RepositoryReviewRuleRecord): Promise<RepositoryReviewRuleRecord | null>;
  delete(userId: string, repositoryId: string, ruleId: string): Promise<boolean>;
}

function isSnapshot(value: unknown): value is RepositoryReviewRuleSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'title' in value &&
    'instructions' in value &&
    'precedence' in value &&
    'filePatterns' in value
  );
}

function mapRule(rule: {
  id: string;
  repositoryId: string;
  userId: string;
  title: string;
  description: string;
  enabled: boolean;
  category: RepositoryReviewRuleRecord['category'];
  severityPreference: RepositoryReviewRuleRecord['severityPreference'];
  scope: string;
  filePatterns: string[];
  instructions: string;
  precedence: number;
  createdAt: Date;
  updatedAt: Date;
  revisions: Array<{
    id: string;
    action: RepositoryReviewRuleRevisionRecord['action'];
    snapshot: Prisma.JsonValue;
    createdAt: Date;
  }>;
}): RepositoryReviewRuleRecord {
  return {
    id: rule.id,
    repositoryId: rule.repositoryId,
    userId: rule.userId,
    title: rule.title,
    description: rule.description,
    enabled: rule.enabled,
    category: rule.category,
    severityPreference: rule.severityPreference,
    scope: rule.scope,
    filePatterns: rule.filePatterns,
    instructions: rule.instructions,
    precedence: rule.precedence,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
    history: rule.revisions.flatMap((revision) => {
      if (!isSnapshot(revision.snapshot)) return [];
      return [
        {
          id: revision.id,
          action: revision.action,
          snapshot: snapshotOf(revision.snapshot),
          createdAt: revision.createdAt,
        },
      ];
    }),
  };
}

const ruleInclude = {
  revisions: { orderBy: { createdAt: 'asc' as const } },
};

const prismaRepositoryReviewRuleStore: RepositoryReviewRuleStore = {
  async ownsRepository(userId, repositoryId) {
    const workspaceId = await getPersonalWorkspaceId(userId);
    return (await prisma.repository.count({ where: { id: repositoryId, userId, workspaceId } })) === 1;
  },

  async list(userId, repositoryId) {
    const workspaceId = await getPersonalWorkspaceId(userId);
    const rules = await prisma.repositoryReviewRule.findMany({
      where: { repositoryId, repository: { is: { userId, workspaceId } } },
      include: ruleInclude,
    });
    return rules.map(mapRule).sort(compareRepositoryReviewRules);
  },

  async count(repositoryId) {
    return prisma.repositoryReviewRule.count({ where: { repositoryId } });
  },

  async get(userId, repositoryId, ruleId) {
    const workspaceId = await getPersonalWorkspaceId(userId);
    const rule = await prisma.repositoryReviewRule.findFirst({
      where: { id: ruleId, repositoryId, repository: { is: { userId, workspaceId } } },
      include: ruleInclude,
    });
    return rule ? mapRule(rule) : null;
  },

  async create(rule) {
    const created = await prisma.repositoryReviewRule.create({
      data: {
        id: rule.id,
        repositoryId: rule.repositoryId,
        userId: rule.userId,
        title: rule.title,
        description: rule.description,
        enabled: rule.enabled,
        category: rule.category,
        severityPreference: rule.severityPreference,
        scope: rule.scope,
        filePatterns: rule.filePatterns,
        instructions: rule.instructions,
        precedence: rule.precedence,
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt,
        revisions: {
          create: rule.history.map((revision) => ({
            id: revision.id,
            user: { connect: { id: rule.userId } },
            action: revision.action,
            snapshot: revision.snapshot as unknown as Prisma.InputJsonValue,
            createdAt: revision.createdAt,
          })),
        },
      },
      include: ruleInclude,
    });
    return mapRule(created);
  },

  async save(rule) {
    const workspaceId = await getPersonalWorkspaceId(rule.userId);
    const existing = await prisma.repositoryReviewRule.findFirst({
      where: {
        id: rule.id,
        repositoryId: rule.repositoryId,
        repository: { is: { userId: rule.userId, workspaceId } },
      },
      select: { id: true },
    });
    if (!existing) return null;
    const saved = await prisma.repositoryReviewRule.update({
      where: { id: rule.id },
      data: {
        title: rule.title,
        description: rule.description,
        enabled: rule.enabled,
        category: rule.category,
        severityPreference: rule.severityPreference,
        scope: rule.scope,
        filePatterns: rule.filePatterns,
        instructions: rule.instructions,
        precedence: rule.precedence,
        updatedAt: rule.updatedAt,
        revisions: {
          create: rule.history.slice(-1).map((revision) => ({
            id: revision.id,
            user: { connect: { id: rule.userId } },
            action: revision.action,
            snapshot: revision.snapshot as unknown as Prisma.InputJsonValue,
            createdAt: revision.createdAt,
          })),
        },
      },
      include: ruleInclude,
    });
    return mapRule(saved);
  },

  async delete(userId, repositoryId, ruleId) {
    const workspaceId = await getPersonalWorkspaceId(userId);
    const result = await prisma.repositoryReviewRule.deleteMany({
      where: { id: ruleId, repositoryId, repository: { is: { userId, workspaceId } } },
    });
    return result.count === 1;
  },
};

function sameSnapshot(left: RepositoryReviewRuleSnapshot, right: RepositoryReviewRuleSnapshot): boolean {
  return JSON.stringify(snapshotOf(left)) === JSON.stringify(snapshotOf(right));
}

export class RepositoryReviewRuleService {
  constructor(
    private readonly store: RepositoryReviewRuleStore = prismaRepositoryReviewRuleStore,
    private readonly ids: () => string = () => crypto.randomUUID(),
    private readonly now: () => Date = () => new Date()
  ) {}

  async list(userId: string, repositoryId: string): Promise<RepositoryReviewRuleRecord[]> {
    if (!(await this.store.ownsRepository(userId, repositoryId))) {
      throw new RepositoryNotFoundError();
    }
    return this.store.list(userId, repositoryId);
  }

  async listEnabled(userId: string, repositoryId: string): Promise<PromptReviewRule[]> {
    const rules = await this.list(userId, repositoryId);
    return rules.filter((rule) => rule.enabled);
  }

  async create(userId: string, repositoryId: string, input: unknown): Promise<RepositoryReviewRuleRecord> {
    const parsed = createRepositoryReviewRuleSchema.safeParse(input);
    if (!parsed.success) throw new InvalidRepositoryReviewRuleError();
    if (!(await this.store.ownsRepository(userId, repositoryId))) {
      throw new RepositoryNotFoundError();
    }
    if ((await this.store.count(repositoryId)) >= MAX_REPOSITORY_REVIEW_RULES) {
      throw new RepositoryReviewRuleLimitError();
    }

    const timestamp = this.now();
    const snapshot = snapshotOf(parsed.data);
    return this.store.create({
      id: this.ids(),
      repositoryId,
      userId,
      ...snapshot,
      createdAt: timestamp,
      updatedAt: timestamp,
      history: [
        {
          id: this.ids(),
          action: 'CREATED',
          snapshot,
          createdAt: timestamp,
        },
      ],
    });
  }

  async update(
    userId: string,
    repositoryId: string,
    ruleId: string,
    input: unknown
  ): Promise<RepositoryReviewRuleRecord> {
    const parsed = updateRepositoryReviewRuleSchema.safeParse(input);
    if (!parsed.success) throw new InvalidRepositoryReviewRuleError();
    if (!(await this.store.ownsRepository(userId, repositoryId))) {
      throw new RepositoryNotFoundError();
    }
    const existing = await this.store.get(userId, repositoryId, ruleId);
    if (!existing) throw new RepositoryReviewRuleNotFoundError();

    const next = snapshotOf({ ...existing, ...parsed.data });
    if (sameSnapshot(existing, next)) return existing;
    const timestamp = this.now();
    const saved = await this.store.save({
      ...existing,
      ...next,
      updatedAt: timestamp,
      history: [
        ...existing.history,
        {
          id: this.ids(),
          action: 'UPDATED',
          snapshot: next,
          createdAt: timestamp,
        },
      ],
    });
    if (!saved) throw new RepositoryReviewRuleNotFoundError();
    return saved;
  }

  async remove(userId: string, repositoryId: string, ruleId: string): Promise<void> {
    if (!(await this.store.ownsRepository(userId, repositoryId))) {
      throw new RepositoryNotFoundError();
    }
    const deleted = await this.store.delete(userId, repositoryId, ruleId);
    if (!deleted) throw new RepositoryReviewRuleNotFoundError();
  }
}

export async function listEnabledRepositoryReviewRules(
  userId: string,
  repositoryId: string
): Promise<PromptReviewRule[]> {
  return new RepositoryReviewRuleService().listEnabled(userId, repositoryId);
}
