import type { Automation } from '@/features/automation/api/automationApi';
import { axiosInstance } from '@/lib/axios';

export type GitHubDevelopmentTemplateId =
  | 'repository_brief'
  | 'pull_request_investigation'
  | 'prepare_issue'
  | 'prepare_pr_comment';

export interface GitHubDevelopmentTemplate {
  id: GitHubDevelopmentTemplateId;
  title: string;
  description: string;
}

export interface GitHubDevelopmentWorkflowInput {
  template: GitHubDevelopmentTemplateId;
  repository: string;
  pullRequestNumber?: number;
  issueTitle?: string;
  issueBody?: string;
  commentBody?: string;
}

export const githubDevelopmentApi = {
  templates: async (): Promise<GitHubDevelopmentTemplate[]> => {
    const response = await axiosInstance.get<GitHubDevelopmentTemplate[]>(
      '/github/development/templates'
    );
    return response.data;
  },

  createWorkflow: async (
    input: GitHubDevelopmentWorkflowInput,
    idempotencyKey: string
  ): Promise<Automation> => {
    const response = await axiosInstance.post<Automation>(
      '/github/development/workflows',
      input,
      { headers: { 'Idempotency-Key': idempotencyKey } }
    );
    return response.data;
  },
};
