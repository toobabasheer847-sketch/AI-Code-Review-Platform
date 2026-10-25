import type { EncryptedVerificationOtp } from './verification-otp.crypto'

export interface AccountEmailPayload {
  to: string
  url: string
}

export interface VerificationOtpEmailJob {
  to: string
  otp: EncryptedVerificationOtp
}

export interface VerificationOtpEmailPayload {
  to: string
  otp: string
}

export type AccountEmailJob =
  | { type: 'auth:verify-email'; payload: VerificationOtpEmailJob }
  | { type: 'auth:password-reset'; payload: AccountEmailPayload }
