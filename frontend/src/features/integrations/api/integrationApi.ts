import { axiosInstance } from '@/lib/axios';

export interface IntegrationAction {
  id: string;
  provider: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  permissions: string[];
  retryBehavior: string;
  approvalRequired: boolean;
}

export interface IntegrationAccount {
  id: string;
  displayName: string;
  providerAccountId?: string;
  scopes?: string[];
  authorizationStatus?: string;
  lastSuccessfulConnectionCheckAt: string | null;
}

export interface IntegrationProvider {
  id: 'github' | 'linkedin';
  name: string;
  summary: string;
  requiredPermissions: string[];
  setupInstructions: string[];
  limitations: string[];
  actions: IntegrationAction[];
  configured: boolean;
  connectionStatus: 'connected' | 'not_connected' | 'setup_required' | 'reconnect_required';
  authorizationStatus: 'verified' | 'not_authorized' | 'expired' | 'permission_missing';
  accounts: IntegrationAccount[];
}

export const integrationApi = {
  list: async (): Promise<IntegrationProvider[]> => {
    const response = await axiosInstance.get<{ providers: IntegrationProvider[] }>('/integrations');
    return response.data.providers;
  },
  check: async (provider: IntegrationProvider['id'], accountId?: string): Promise<void> => {
    await axiosInstance.post(`/integrations/${provider}/check`, accountId ? { accountId } : {});
  },
};
