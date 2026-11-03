export const MAX_DUPLICATE_CANDIDATES = 50;

export type DuplicateUserAssessment =
  | 'TRUE_POSITIVE'
  | 'FALSE_POSITIVE'
  | 'ALREADY_FIXED'
  | 'NEEDS_REVIEW';

export interface DuplicateSubject {
  id: string;
  reviewId: string;
  file: string;
  line: number;
  endLine?: number | null;
  category: string;
  title?: string | null;
  message: string;
  evidence?: string | null;
  createdAt: Date;
  userAssessment?: DuplicateUserAssessment | null;
}

export interface DuplicateCandidate {
  findingId: string;
  reviewId: string;
  matchedFindingId: string;
  matchedReviewId: string;
  category: string;
  file: string;
  line: number;
  priorUserAssessment: DuplicateUserAssessment | null;
  reason: string;
  suppressed: false;
  requiresHumanReview: true;
}

function normalize(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

function rangesOverlap(left: DuplicateSubject, right: DuplicateSubject): boolean {
  const leftEnd = left.endLine ?? left.line;
  const rightEnd = right.endLine ?? right.line;
  return left.line <= rightEnd && right.line <= leftEnd;
}

function isSimilar(current: DuplicateSubject, prior: DuplicateSubject): boolean {
  if (current.id === prior.id || current.reviewId === prior.reviewId) return false;
  if (current.file.toLowerCase() !== prior.file.toLowerCase()) return false;
  if (current.category !== prior.category) return false;
  if (!rangesOverlap(current, prior)) return false;

  const currentEvidence = current.evidence ? normalize(current.evidence) : '';
  const priorEvidence = prior.evidence ? normalize(prior.evidence) : '';
  const evidenceMatches = currentEvidence.length > 0 && currentEvidence === priorEvidence;
  const currentTitle = current.title ? normalize(current.title) : '';
  const priorTitle = prior.title ? normalize(prior.title) : '';
  const titleMatches = currentTitle.length >= 8 && currentTitle === priorTitle;
  return evidenceMatches || titleMatches;
}

function candidateReason(prior: DuplicateSubject): string {
  if (prior.userAssessment === 'FALSE_POSITIVE') {
    return 'A similar earlier finding was user-assessed as a false positive. This match is a candidate for human review and was not deleted or suppressed.';
  }
  return 'A similar finding exists in an earlier review. Confirm the match before changing either finding.';
}

export function findCrossReviewDuplicateCandidates(
  findings: DuplicateSubject[],
  priorFindings: DuplicateSubject[]
): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = [];
  for (const finding of findings) {
    for (const prior of priorFindings) {
      if (!isSimilar(finding, prior)) continue;
      candidates.push({
        findingId: finding.id,
        reviewId: finding.reviewId,
        matchedFindingId: prior.id,
        matchedReviewId: prior.reviewId,
        category: finding.category,
        file: finding.file,
        line: finding.line,
        priorUserAssessment: prior.userAssessment ?? null,
        reason: candidateReason(prior),
        suppressed: false,
        requiresHumanReview: true,
      });
      if (candidates.length >= MAX_DUPLICATE_CANDIDATES) return candidates;
    }
  }
  return candidates;
}

export function findRepositoryDuplicateCandidates(
  findings: DuplicateSubject[]
): DuplicateCandidate[] {
  const ordered = [...findings].sort((left, right) => {
    const time = left.createdAt.getTime() - right.createdAt.getTime();
    if (time !== 0) return time;
    return left.id.localeCompare(right.id);
  });
  const candidates: DuplicateCandidate[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    if (!current) continue;
    candidates.push(...findCrossReviewDuplicateCandidates([current], ordered.slice(0, index)));
    if (candidates.length >= MAX_DUPLICATE_CANDIDATES) break;
  }
  return candidates.slice(0, MAX_DUPLICATE_CANDIDATES);
}
