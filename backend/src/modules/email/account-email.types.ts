export interface AccountEmailPayload {
  to: string
  url: string
}

export type AccountEmailJob =
  | { type: 'auth:verify-email'; payload: AccountEmailPayload }
  | { type: 'auth:password-reset'; payload: AccountEmailPayload }
