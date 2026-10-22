import { z } from 'zod';

export const findingStatuses = [
  'UNREVIEWED',
  'CONFIRMED',
  'FALSE_POSITIVE',
  'DUPLICATE',
  'FIXED',
  'WONT_FIX',
] as const;

export type FindingStatusValue = (typeof findingStatuses)[number];

const validTransitions: Record<FindingStatusValue, readonly FindingStatusValue[]> = {
  UNREVIEWED: ['CONFIRMED', 'FALSE_POSITIVE', 'DUPLICATE', 'FIXED', 'WONT_FIX'],
  CONFIRMED: ['UNREVIEWED', 'FALSE_POSITIVE', 'DUPLICATE', 'FIXED', 'WONT_FIX'],
  FALSE_POSITIVE: ['UNREVIEWED', 'CONFIRMED'],
  DUPLICATE: ['UNREVIEWED', 'CONFIRMED'],
  FIXED: ['UNREVIEWED', 'CONFIRMED'],
  WONT_FIX: ['UNREVIEWED', 'CONFIRMED'],
};

export const updateFindingStatusSchema = z
  .object({
    status: z.enum(findingStatuses),
    reason: z.string().trim().max(1_000).optional(),
  })
  .strict()
  .transform(({ status, reason }) => ({
    status,
    ...(reason ? { reason } : {}),
  }));

export function canTransitionFindingStatus(
  current: FindingStatusValue,
  next: FindingStatusValue
): boolean {
  return validTransitions[current].includes(next);
}

export interface FindingLifecycleRecord {
  status: FindingStatusValue;
  independentlyVerifiedAt: Date | null;
}

export function summarizeFindingLifecycle(
  findings: readonly FindingLifecycleRecord[]
): {
  total: number;
  statusCounts: Record<FindingStatusValue, number>;
  developerMarkedFixed: number;
  independentlyVerifiedFixed: number;
} {
  const statusCounts = Object.fromEntries(
    findingStatuses.map((status) => [status, 0])
  ) as Record<FindingStatusValue, number>;

  for (const finding of findings) {
    statusCounts[finding.status] += 1;
  }

  return {
    total: findings.length,
    statusCounts,
    developerMarkedFixed: statusCounts.FIXED,
    independentlyVerifiedFixed: findings.filter(
      (finding) => finding.status === 'FIXED' && finding.independentlyVerifiedAt !== null
    ).length,
  };
}
