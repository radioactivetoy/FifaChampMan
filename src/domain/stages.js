export const PLAYOFF_STAGES = ['r16', 'qf', 'sf', 'final'];

export const STAGE_LABELS = { group: 'Group stage', r16: 'Round of 16', qf: 'Quarter-final', sf: 'Semi-final', final: 'Final' };

/** How far a team got, in order. */
export const REACHED = ['group', ...PLAYOFF_STAGES, 'champion'];

export const REACHED_LABELS = { ...STAGE_LABELS, champion: 'Champion' };

/** Controller rotation scope: each group separately, the playoff as a whole. */
export const scopeOf = match => (match.stage === 'group' ? `group:${match.groupLetter}` : 'playoff');
