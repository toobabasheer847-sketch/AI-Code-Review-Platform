export const reviewWorkerConcurrency = 1

export function isTerminalQueueFailure(
  attemptsMade: number,
  configuredAttempts: number | undefined
): boolean {
  return attemptsMade >= (configuredAttempts ?? 1)
}
