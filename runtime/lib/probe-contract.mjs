export function isSyntheticFollowupBatch(value) {
  if (!value || !Array.isArray(value.candidates) || value.candidates.length !== 1) return false;
  const candidate = value.candidates[0];
  return !!candidate && typeof candidate === 'object'
    && typeof candidate.title === 'string' && candidate.title.trim().length > 0
    && candidate.kind === 'followup'
    && typeof candidate.dueExpression === 'string' && candidate.dueExpression.trim().toLowerCase() === 'friday'
    && typeof candidate.followupExpression === 'string' && candidate.followupExpression.trim().toLowerCase() === 'today'
    && typeof candidate.evidence === 'string' && candidate.evidence.includes('delivery is on Friday; follow-up is today');
}
