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
  action:
    | 'collect_review_results'
    | 'generate_text_draft'
    | 'collect_github_context'
    | 'create_github_issue'
    | 'create_github_pr_comment';
  dependencies: string[];
  output: unknown;
  status:
    | 'PENDING'
    | 'AWAITING_APPROVAL'
    | 'READY'
    | 'RUNNING'
    | 'COMPLETED'
    | 'SKIPPED'
    | 'FAILED'
    | 'CANCELED';
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

export type VisualAction =
  | 'collect_review_results'
  | 'generate_text_draft'
  | 'collect_github_context'
  | 'create_github_issue'
  | 'create_github_pr_comment';

export type VisualCondition =
  | { kind: 'review_count'; operator: 'gt' | 'eq'; value: number }
  | { kind: 'github_context_status'; equals: 'complete' | 'partial' }
  | { kind: 'github_write_status'; equals: 'created' | 'already_created' };

export type VisualWorkflowNode =
  | { id: string; type: 'manual'; label: string }
  | {
      id: string;
      type: 'action';
      title: string;
      description: string;
      action: VisualAction;
      input: Record<string, unknown>;
    }
  | { id: string; type: 'condition'; title: string; condition: VisualCondition }
  | { id: string; type: 'approval'; title: string; message: string }
  | { id: string; type: 'end' | 'result'; title: string; resultLabel?: string };

export interface VisualWorkflowDefinition {
  title: string;
  nodes: VisualWorkflowNode[];
  edges: Array<{ id: string; from: string; to: string; branch?: 'true' | 'false' }>;
}

export interface VisualWorkflowValidation {
  valid: true;
  title: string;
  plan: {
    title: string;
    tasks: Array<{
      key: string;
      title: string;
      description: string;
      action: VisualAction;
      input: Record<string, unknown>;
      dependsOn: string[];
    }>;
  };
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
  workflowDefinition: VisualWorkflowDefinition | null;
  mode: AutomationMode;
  status: AutomationStatus;
  tasks: AutomationTask[];
  events: AutomationEvent[];
  approvals: AutomationApproval[];
  createdAt: string;
}

export type AutomationScheduleStatus = 'ACTIVE' | 'PAUSED' | 'CANCELED';
export type AutomationScheduleRunStatus =
  | 'PENDING'
  | 'AWAITING_APPROVAL'
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED';

export interface AutomationScheduleRun {
  id: string;
  scheduledFor: string;
  status: AutomationScheduleRunStatus;
  automationId: string | null;
  errorCode: string | null;
  updatedAt: string;
}

export interface AutomationSchedule {
  id: string;
  title: string;
  frequency: 'DAILY' | 'WEEKLY';
  timeZone: string;
  localTime: string;
  dayOfWeek: number | null;
  status: AutomationScheduleStatus;
  nextRunAt: string;
  lastRunAt: string | null;
  consecutiveFailures: number;
  missedRuns: number;
  totalRuns: number;
  runs: AutomationScheduleRun[];
}

export interface AutomationNotificationPreferences {
  failureNotifications: boolean;
  repeatedFailureThreshold: number;
  dailySummaryEnabled: boolean;
  dailySummaryTime: string;
  dailySummaryTimeZone: string;
}

export interface AutomationSchedulesResponse {
  schedules: AutomationSchedule[];
  notificationPreferences: AutomationNotificationPreferences;
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
  schedules: async (): Promise<AutomationSchedulesResponse> => {
    const response = await axiosInstance.get<AutomationSchedulesResponse>('/automations/schedules');
    return response.data;
  },
  createSchedule: async (input: {
    automationId: string;
    frequency: 'DAILY' | 'WEEKLY';
    timeZone: string;
    localTime: string;
    dayOfWeek?: number;
  }): Promise<AutomationSchedule> => {
    const response = await axiosInstance.post<AutomationSchedule>('/automations/schedules', input);
    return response.data;
  },
  updateSchedule: async (
    id: string,
    input: {
      frequency: 'DAILY' | 'WEEKLY';
      timeZone: string;
      localTime: string;
      dayOfWeek?: number;
    }
  ): Promise<AutomationSchedule> => {
    const response = await axiosInstance.patch<AutomationSchedule>(
      `/automations/schedules/${id}`,
      input
    );
    return response.data;
  },
  setScheduleStatus: async (
    id: string,
    status: 'ACTIVE' | 'PAUSED'
  ): Promise<AutomationSchedule> => {
    const response = await axiosInstance.post<AutomationSchedule>(
      `/automations/schedules/${id}/${status === 'ACTIVE' ? 'resume' : 'pause'}`
    );
    return response.data;
  },
  cancelSchedule: async (id: string): Promise<{ id: string; status: 'CANCELED' }> => {
    const response = await axiosInstance.delete<{ id: string; status: 'CANCELED' }>(
      `/automations/schedules/${id}`
    );
    return response.data;
  },
  updateNotificationPreferences: async (
    input: AutomationNotificationPreferences
  ): Promise<AutomationNotificationPreferences> => {
    const response = await axiosInstance.put<AutomationNotificationPreferences>(
      '/automations/notification-preferences',
      input
    );
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
  validateVisual: async (
    goal: string,
    workflow: VisualWorkflowDefinition
  ): Promise<VisualWorkflowValidation> => {
    const response = await axiosInstance.post<VisualWorkflowValidation>(
      '/automations/visual/validate',
      { goal, workflow }
    );
    return response.data;
  },
  saveVisual: async (goal: string, workflow: VisualWorkflowDefinition): Promise<Automation> => {
    const response = await axiosInstance.post<Automation>('/automations/visual', {
      goal,
      workflow,
    });
    return response.data;
  },
  executeDraft: async (id: string): Promise<Automation> => {
    const response = await axiosInstance.post<Automation>(`/automations/${id}/execute-draft`);
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
