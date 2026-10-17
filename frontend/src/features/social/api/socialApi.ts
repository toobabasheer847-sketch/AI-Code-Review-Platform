import { axiosInstance } from '@/lib/axios';

export type SocialPostStatus =
  | 'DRAFT'
  | 'AWAITING_APPROVAL'
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'PUBLICATION_UNKNOWN'
  | 'CANCELED'
  | 'REJECTED';

export interface SocialAccount {
  id: string;
  provider: 'LINKEDIN';
  providerAccountId: string;
  displayName: string;
  scopes: string[];
  tokenExpiresAt: string;
  connected: boolean;
  canPublish: boolean;
}

export interface SocialProviderStatus {
  id: 'LINKEDIN';
  name: string;
  configured: boolean;
  accountConnectionAvailable: boolean;
  publishingAvailable: boolean;
  maxCharacters: number;
  capabilities: {
    textPosts: boolean;
    nativeScheduling: boolean;
    platformScheduling: boolean;
    applicationScheduling: boolean;
  };
  setupInstructions: string[];
}

export interface SocialPost {
  id: string;
  userId: string;
  accountId: string | null;
  platform: 'LINKEDIN';
  platformAccountId: string;
  destinationLabel: string;
  content: string;
  instructions: string | null;
  evidenceReviewId: string | null;
  evidenceUrl: string | null;
  status: SocialPostStatus;
  scheduledAt: string | null;
  nextAttemptAt: string | null;
  approvalExpiresAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  scheduleVersion: number;
  attemptCount: number;
  retryable: boolean;
  providerPostId: string | null;
  providerUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  account: { id: string; displayName: string } | null;
  events: Array<{ id: string; type: string; message: string; createdAt: string }>;
}

export interface SocialStatus {
  providers: SocialProviderStatus[];
  accounts: SocialAccount[];
}

export interface SocialPostInput {
  content: string;
  accountId: string | null;
  scheduledAt: string | null;
}

export const socialApi = {
  status: async (): Promise<SocialStatus> => {
    const response = await axiosInstance.get<SocialStatus>('/social/status');
    return response.data;
  },
  posts: async (): Promise<SocialPost[]> => {
    const response = await axiosInstance.get<SocialPost[]>('/social/posts');
    return response.data;
  },
  connectLinkedIn: async (): Promise<string> => {
    const response = await axiosInstance.post<{ url: string }>('/social/linkedin/connect');
    return response.data.url;
  },
  disconnect: async (accountId: string): Promise<void> => {
    await axiosInstance.delete(`/social/accounts/${accountId}`);
  },
  generateDraft: async (
    instructions: string,
    reviewId: string,
    idempotencyKey: string
  ): Promise<SocialPost> => {
    const response = await axiosInstance.post<SocialPost>(
      '/social/drafts/generate',
      { instructions, reviewId },
      { headers: { 'Idempotency-Key': idempotencyKey } }
    );
    return response.data;
  },
  createDraft: async (input: SocialPostInput, idempotencyKey: string): Promise<SocialPost> => {
    const response = await axiosInstance.post<SocialPost>(
      '/social/drafts',
      input,
      { headers: { 'Idempotency-Key': idempotencyKey } }
    );
    return response.data;
  },
  updatePost: async (postId: string, input: SocialPostInput): Promise<SocialPost> => {
    const response = await axiosInstance.patch<SocialPost>(`/social/posts/${postId}`, input);
    return response.data;
  },
  requestApproval: async (postId: string): Promise<SocialPost> => {
    const response = await axiosInstance.post<SocialPost>(
      `/social/posts/${postId}/request-approval`
    );
    return response.data;
  },
  approve: async (postId: string): Promise<SocialPost> => {
    const response = await axiosInstance.post<SocialPost>(`/social/posts/${postId}/approve`);
    return response.data;
  },
  reject: async (postId: string): Promise<SocialPost> => {
    const response = await axiosInstance.post<SocialPost>(`/social/posts/${postId}/reject`);
    return response.data;
  },
  cancel: async (postId: string): Promise<SocialPost> => {
    const response = await axiosInstance.post<SocialPost>(`/social/posts/${postId}/cancel`);
    return response.data;
  },
  retry: async (postId: string): Promise<SocialPost> => {
    const response = await axiosInstance.post<SocialPost>(`/social/posts/${postId}/retry`);
    return response.data;
  },
};
