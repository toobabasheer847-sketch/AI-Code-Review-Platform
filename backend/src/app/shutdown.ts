export const shutdownStepTimeoutMs = 10_000

export async function runShutdownStep(
  cleanup: () => Promise<unknown>,
  timeoutMs = shutdownStepTimeoutMs
): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      cleanup(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Shutdown step timed out')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
