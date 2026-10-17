import { axiosInstance } from '@/lib/axios';

export type MemoryType =
  | 'PROJECT_SUMMARY'
  | 'TECHNICAL_DECISION'
  | 'PREFERENCE'
  | 'WORKFLOW_OUTCOME'
  | 'LESSON'
  | 'INTEGRATION_REFERENCE'
  | 'PROJECT_CONTEXT';

export type MemorySource = 'USER_PROVIDED' | 'APPROVED_WORKFLOW' | 'AI_GENERATED' | 'INFERENCE';

export interface WorkMemory {
  id: string;
  type: MemoryType;
  source: MemorySource;
  sourceLabel: string;
  sourceId: string | null;
  content: string;
  confidence: number | null;
  repositoryId: string | null;
  repository: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkMemoryInput {
  type: MemoryType;
  source: MemorySource;
  sourceLabel: string;
  sourceId?: string;
  content: string;
  repositoryId?: string;
  confidence?: number;
}

export interface MemoryProject {
  id: string;
  name: string;
}

export const memoryApi = {
  list: async (): Promise<WorkMemory[]> => (await axiosInstance.get<WorkMemory[]>('/memory')).data,
  projects: async (): Promise<MemoryProject[]> =>
    (await axiosInstance.get<MemoryProject[]>('/memory/projects')).data,
  getSettings: async (): Promise<{ enabled: boolean }> =>
    (await axiosInstance.get<{ enabled: boolean }>('/memory/settings')).data,
  setEnabled: async (enabled: boolean): Promise<{ enabled: boolean }> =>
    (await axiosInstance.patch<{ enabled: boolean }>('/memory/settings', { enabled })).data,
  create: async (input: WorkMemoryInput): Promise<WorkMemory> =>
    (await axiosInstance.post<WorkMemory>('/memory', input)).data,
  update: async (id: string, input: WorkMemoryInput): Promise<WorkMemory> =>
    (await axiosInstance.patch<WorkMemory>(`/memory/${id}`, input)).data,
  delete: async (id: string): Promise<void> => {
    await axiosInstance.delete(`/memory/${id}`);
  },
};
