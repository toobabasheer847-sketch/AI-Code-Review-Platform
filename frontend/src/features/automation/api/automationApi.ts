import { axiosInstance } from '@/lib/axios';

export type AutomationMode = 'DRAFT_ONLY' | 'APPROVAL_REQUIRED' | 'AUTO_LOW_RISK';
export type AutomationStatus =
  | 'DRAFT'
  | 'AWAITING_APPROVAL'
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELED'
  | 'REJECTED';

export type AutomationApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELED';

export interface AutomationTask {
  id: string;
  key: string;
  title: string;
  description: string;
  action: 'collect_review_results' | 'generate_text_draft';
  dependencies: string[];
  output: unknown;
  status: 'PENDING' | 'READY' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED';
  attempts: number;
  errorMessage: string | null;
  executionAttempts: Array<{
    id: string;
    attemptNumber: number;
    status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED';
    output: unknown;
    errorMessage: string | null;
    startedAt: string;
    completedAt: string | null;
  }>;
}

export interface AutomationApproval {
  id: string;
  status: AutomationApprovalStatus;
  summary: string;
  payload: {
    goal: string;
    title: string;
    tasks: Array<{
      key: string;
      title: string;
      description: string;
      action: AutomationTask['action'];
      dependencies: string[];
      input: unknown;
    }>;
  };
  payloadHash: string;
  expiresAt: string;
  decidedAt: string | null;
  createdAt: string;
}

export interface AutomationEvent {
  id: string;
  type: string;
  message: string;
  createdAt: string;
}

export interface Automation {
  id: string;
  title: string;
  goal: string;
  mode: AutomationMode;
  status: AutomationStatus;
  tasks: AutomationTask[];
  events: AutomationEvent[];
  approvals: AutomationApproval[];
  createdAt: string;
}

export function getAutomationErrorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'data' in error.response &&
    typeof error.response.data === 'object' &&
    error.response.data !== null &&
    'error' in error.response.data &&
    typeof error.response.data.error === 'string'
  ) {
    return error.response.data.error;
  }
  return error instanceof Error ? error.message : 'Unable to complete the automation request.';
}

export const automationApi = {
  list: async (): Promise<Automation[]> => {
    const response = await axiosInstance.get<Automation[]>('/automations');
    return response.data;
  },
  create: async (
    goal: string,
    mode: AutomationMode,
    idempotencyKey: string
  ): Promise<Automation> => {
    const response = await axiosInstance.post<Automation>(
      '/automations',
      { goal, mode },
      { headers: { 'Idempotency-Key': idempotencyKey } }
    );
    return response.data;
  },
  approve: async (id: string): Promise<Automation> => {
    const response = await axiosInstance.post<Automation>(`/automations/${id}/approve`);
    return response.data;
  },
  reject: async (id: string): Promise<Automation> => {
    const response = await axiosInstance.post<Automation>(`/automations/${id}/reject`);
    return response.data;
  },
  cancel: async (id: string): Promise<Automation> => {
    const response = await axiosInstance.post<Automation>(`/automations/${id}/cancel`);
    return response.data;
  },
  retry: async (id: string): Promise<Automation> => {
    const response = await axiosInstance.post<Automation>(`/automations/${id}/retry`);
    return response.data;
  },
};
