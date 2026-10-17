import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkMemorySource, WorkMemoryType } from '@prisma/client';
import {
  containsSensitiveValue,
  formatMemoryContext,
  ownedMemoryWhere,
  selectRelevantMemories,
  type WorkMemoryInput,
} from './memory.domain';
import { WorkMemoryError, WorkMemoryService } from './memory.service';
import type { WorkMemoryEntry, WorkMemoryStore } from './memory.store';

const savedAt = new Date('2026-10-17T10:00:00.000Z');
const memory: WorkMemoryEntry = {
  id: 'memory-1',
  userId: 'user-a',
  type: WorkMemoryType.TECHNICAL_DECISION,
  source: WorkMemorySource.USER_PROVIDED,
  sourceLabel: 'User-provided',
  sourceId: null,
  content: 'Use PostgreSQL for durable automation state.',
  confidence: null,
  repositoryId: null,
  repository: null,
  createdAt: savedAt,
  updatedAt: savedAt,
};

class FakeMemoryStore implements WorkMemoryStore {
  entries: WorkMemoryEntry[] = [memory];
  enabled = true;
  completedWorkflowOwner = 'user-a';
  projectOwner = 'user-a';
  lastOperationUser: string | undefined;

  async projects(userId: string): Promise<Array<{ id: string; name: string }>> {
    this.lastOperationUser = userId;
    return [];
  }

  async list(userId: string): Promise<WorkMemoryEntry[]> {
    this.lastOperationUser = userId;
    return this.entries.filter((entry) => entry.userId === userId);
  }

  async memoryEnabled(userId: string): Promise<boolean | null> {
    this.lastOperationUser = userId;
    return this.enabled;
  }

  async setMemoryEnabled(userId: string, enabled: boolean): Promise<boolean> {
    this.lastOperationUser = userId;
    this.enabled = enabled;
    return true;
  }

  async create(userId: string, input: WorkMemoryInput): Promise<WorkMemoryEntry> {
    this.lastOperationUser = userId;
    const entry = { ...memory, ...input, userId, id: 'memory-new' };
    this.entries.push(entry);
    return entry;
  }

  async update(
    userId: string,
    memoryId: string,
    input: WorkMemoryInput
  ): Promise<WorkMemoryEntry | null> {
    this.lastOperationUser = userId;
    const index = this.entries.findIndex(
      (entry) => entry.id === memoryId && entry.userId === userId
    );
    if (index === -1) return null;
    this.entries[index] = { ...this.entries[index], ...input, updatedAt: new Date() };
    return this.entries[index];
  }

  async delete(userId: string, memoryId: string): Promise<boolean> {
    this.lastOperationUser = userId;
    const existing = this.entries.findIndex(
      (entry) => entry.id === memoryId && entry.userId === userId
    );
    if (existing === -1) return false;
    this.entries.splice(existing, 1);
    return true;
  }

  async ownsCompletedWorkflow(userId: string): Promise<boolean> {
    this.lastOperationUser = userId;
    return userId === this.completedWorkflowOwner;
  }

  async ownsProject(userId: string): Promise<boolean> {
    this.lastOperationUser = userId;
    return userId === this.projectOwner;
  }
}

test('memory ownership filters always bind reads and writes to the authenticated user', () => {
  assert.deepEqual(ownedMemoryWhere('user-a'), { userId: 'user-a' });
  assert.deepEqual(ownedMemoryWhere('user-a', 'memory-1'), {
    userId: 'user-a',
    id: 'memory-1',
  });
  assert.notDeepEqual(ownedMemoryWhere('user-a', 'memory-1'), {
    userId: 'user-b',
    id: 'memory-1',
  });
});

test('service isolation prevents another user from listing or editing a memory', async () => {
  const store = new FakeMemoryStore();
  const service = new WorkMemoryService(store);
  assert.deepEqual(await service.list('user-b'), []);
  await assert.rejects(
    service.update('user-b', 'memory-1', {
      type: WorkMemoryType.TECHNICAL_DECISION,
      source: WorkMemorySource.USER_PROVIDED,
      sourceLabel: 'User-provided',
      content: 'Attempt to change another user memory.',
    }),
    (error: unknown) => error instanceof WorkMemoryError && error.statusCode === 404
  );
  assert.equal(store.lastOperationUser, 'user-b');
  assert.equal(store.entries[0].content, memory.content);
});

test('retrieval selects relevant entries, includes preferences, and excludes unrelated memories', () => {
  const selected = selectRelevantMemories(
    [
      memory,
      {
        ...memory,
        id: 'memory-2',
        type: WorkMemoryType.PREFERENCE,
        content: 'Prefer concise plans.',
      },
      { ...memory, id: 'memory-3', content: 'The office moved to the third floor.' },
    ],
    'Plan the PostgreSQL automation work'
  );
  assert.deepEqual(
    selected.map((entry) => entry.id),
    ['memory-1', 'memory-2']
  );
});

test('retrieved prompt context preserves source, timestamp, project, and uncertainty attribution', () => {
  const context = formatMemoryContext([
    {
      ...memory,
      source: WorkMemorySource.INFERENCE,
      sourceLabel: 'Reviewed inference',
      sourceId: 'automation-123',
      confidence: 0.4,
      repository: { id: 'project-1', name: 'sample-repo' },
    },
  ]);
  assert.match(context, /INFERENCE \(Reviewed inference\)/);
  assert.match(context, /reference: automation-123/);
  assert.match(context, /confidence: 0.4/);
  assert.match(context, /2026-10-17T10:00:00.000Z/);
  assert.match(context, /updated: 2026-10-17T10:00:00.000Z/);
  assert.match(context, /Project: sample-repo/);
  assert.match(context, /Use PostgreSQL/);
});

test('memory guard rejects common secrets and sensitive personal information', () => {
  assert.equal(containsSensitiveValue('API_KEY=sk-12345678901234567890'), true);
  assert.equal(
    containsSensitiveValue('https://provider.example/callback?access_token=abcdef123456789'),
    true
  );
  assert.equal(containsSensitiveValue('Contact me at person@example.com'), true);
  assert.equal(containsSensitiveValue('Decision recorded on 2026-10-17.'), false);
  assert.equal(
    containsSensitiveValue('Use a token stored in the deployment secret manager.'),
    false
  );
});

test('editing persists user-reviewed content and preserves the same owner boundary', async () => {
  const service = new WorkMemoryService(new FakeMemoryStore());
  const updated = await service.update('user-a', 'memory-1', {
    type: WorkMemoryType.TECHNICAL_DECISION,
    source: WorkMemorySource.USER_PROVIDED,
    sourceLabel: 'User-provided',
    content: 'Use PostgreSQL for the project.',
  });
  assert.equal(updated.content, 'Use PostgreSQL for the project.');
});

test('deleting removes the record from future retrieval', async () => {
  const service = new WorkMemoryService(new FakeMemoryStore());
  await service.delete('user-a', 'memory-1');
  assert.deepEqual(await service.list('user-a'), []);
});

test('disabled memory short-circuits retrieval before reading entries', async () => {
  const store = new FakeMemoryStore();
  store.enabled = false;
  const service = new WorkMemoryService(store);
  assert.equal(await service.contextForPlan('user-a', 'PostgreSQL project'), '');
  assert.equal(store.lastOperationUser, 'user-a');
});

test('memory enablement can be explicitly switched off and on', async () => {
  const store = new FakeMemoryStore();
  const service = new WorkMemoryService(store);
  assert.deepEqual(await service.setEnabled('user-a', false), { enabled: false });
  assert.equal(await service.contextForPlan('user-a', 'PostgreSQL project'), '');
  assert.deepEqual(await service.setEnabled('user-a', true), { enabled: true });
  assert.match(await service.contextForPlan('user-a', 'PostgreSQL project'), /PostgreSQL/);
});

test('approved workflow sources must belong to the authenticated user', async () => {
  const store = new FakeMemoryStore();
  store.completedWorkflowOwner = 'user-a';
  const service = new WorkMemoryService(store);
  await assert.rejects(
    service.create('user-b', {
      type: WorkMemoryType.WORKFLOW_OUTCOME,
      source: WorkMemorySource.APPROVED_WORKFLOW,
      sourceLabel: 'Completed automation',
      sourceId: 'automation-1',
      content: 'The workflow result was reviewed.',
    }),
    (error: unknown) => error instanceof WorkMemoryError && error.statusCode === 404
  );
});

test('memory writes preserve explicit source attribution and require inference confidence', async () => {
  const store = new FakeMemoryStore();
  const service = new WorkMemoryService(store);
  const saved = await service.create('user-a', {
    type: WorkMemoryType.PROJECT_SUMMARY,
    source: WorkMemorySource.AI_GENERATED,
    sourceLabel: 'AI-generated summary, reviewed by me',
    content: 'The project uses PostgreSQL for persistent state.',
  });
  assert.equal(saved.source, WorkMemorySource.AI_GENERATED);
  assert.equal(saved.sourceLabel, 'AI-generated summary, reviewed by me');

  await assert.rejects(
    service.create('user-a', {
      type: WorkMemoryType.PROJECT_CONTEXT,
      source: WorkMemorySource.INFERENCE,
      sourceLabel: 'Reviewed inference',
      content: 'Likely uses a relational database.',
    }),
    (error: unknown) => error instanceof WorkMemoryError && error.statusCode === 400
  );
});
