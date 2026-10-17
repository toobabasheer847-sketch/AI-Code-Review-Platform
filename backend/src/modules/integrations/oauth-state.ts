import { timingSafeEqual } from 'node:crypto';

export function isValidOAuthState(state: string, cookieState: string | null): boolean {
  if (!cookieState || !/^[\da-f]{64}$/i.test(state) || !/^[\da-f]{64}$/i.test(cookieState)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(state, 'hex'), Buffer.from(cookieState, 'hex'));
}
