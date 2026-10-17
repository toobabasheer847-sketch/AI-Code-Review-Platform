import type { Prisma } from '@prisma/client';
import type { WorkMemorySource, WorkMemoryType } from '@prisma/client';

export const MAX_MEMORY_CONTENT_LENGTH = 4_000;
export const MAX_MEMORY_CONTEXT_LENGTH = 6_000;
export const MAX_MEMORY_CONTEXT_ITEMS = 8;

export interface WorkMemoryInput {
  type: WorkMemoryType;
  source: WorkMemorySource;
  sourceLabel: string;
  sourceId?: string;
  content: string;
  repositoryId?: string;
  confidence?: number;
}

const stopWords = new Set([
  'about',
  'after',
  'also',
  'and',
  'are',
  'for',
  'from',
  'into',
  'make',
  'need',
  'our',
  'please',
  'project',
  'that',
  'the',
  'this',
  'with',
  'work',
  'would',
]);

export function ownedMemoryWhere(userId: string, memoryId?: string): Prisma.WorkMemoryWhereInput {
  return { userId, ...(memoryId ? { id: memoryId } : {}) };
}

export function containsSensitiveValue(content: string): boolean {
  return [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
    /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/i,
    /\b(?:password|passwd|secret|client[_ -]?secret|token|access[_ -]?token|refresh[_ -]?token|api[_ -]?key)\s*[:=]\s*["']?[^\s"'&]{6,}/i,
    /(?:[?&])(?:password|secret|client_secret|token|access_token|refresh_token|api_key)=([^\s&#]{6,})/i,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    /\b\d{3}-\d{2}-\d{4}\b/,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /(?<!\d)(?:\+?\d[\s().-]?){10,15}(?!\d)/,
  ].some((pattern) => pattern.test(content));
}

export interface SearchableMemory {
  type: string;
  content: string;
  source: string;
  sourceLabel: string;
  sourceId?: string | null;
  confidence?: number | null;
  createdAt: Date;
  updatedAt?: Date;
  repository?: { name: string } | null;
}

export function selectRelevantMemories<T extends SearchableMemory>(
  memories: T[],
  query: string,
  limit = MAX_MEMORY_CONTEXT_ITEMS
): T[] {
  const terms = [...new Set(query.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [])].filter(
    (term) => !stopWords.has(term)
  );

  return memories
    .map((memory, index) => {
      const searchable = `${memory.content} ${memory.repository?.name ?? ''}`.toLowerCase();
      const matches = terms.filter((term) => searchable.includes(term)).length;
      const preferenceBoost = memory.type === 'PREFERENCE' ? 1 : 0;
      return { memory, index, score: matches + preferenceBoost };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ memory }) => memory);
}

export function formatMemoryContext(memories: SearchableMemory[]): string {
  let remaining = MAX_MEMORY_CONTEXT_LENGTH;
  const lines: string[] = [];
  for (const memory of memories) {
    const line = [
      `- Type: ${memory.type}; source: ${memory.source} (${memory.sourceLabel})${memory.sourceId ? `; reference: ${memory.sourceId}` : ''}${memory.confidence !== null && memory.confidence !== undefined ? `; confidence: ${memory.confidence}` : ''}; saved: ${memory.createdAt.toISOString()}${memory.updatedAt ? `; updated: ${memory.updatedAt.toISOString()}` : ''}`,
      memory.repository ? `  Project: ${memory.repository.name}` : '',
      `  Content: ${memory.content}`,
    ]
      .filter(Boolean)
      .join('\n');
    if (line.length > remaining) {
      if (remaining > 80) lines.push(`${line.slice(0, remaining - 20)} [truncated]`);
      break;
    }
    lines.push(line);
    remaining -= line.length + 1;
  }
  return lines.join('\n');
}
