import { shuffle } from './rng.js';

export const FIELD_SIZE = 32;

// A real Champions League field is almost entirely mid-table-or-better sides from strong leagues,
// or big fish from smaller ones — essentially nobody below "decent" (2★, ~64 OVR) makes the group
// stage. Weighted toward the top and tapering off, editable on the Config page.
export const DEFAULT_FIELD_QUOTAS = { 5: 4, 4.5: 6, 4: 6, 3.5: 6, 3: 5, 2.5: 3, 2: 2, 1.5: 0, 1: 0, 0.5: 0 };

/**
 * The "teams per star level" quotas scaled to a field of `size` teams (the defaults add up to 32): each level keeps its share,
 * rounded with the largest-remainder method so the total is exactly `size`. Levels with quota 0 stay 0.
 */
export function scaleQuotas(quotas, size) {
  const entries = Object.entries(quotas).map(([stars, quota]) => [stars, Number(quota)]);
  const total = entries.reduce((sum, [, q]) => sum + q, 0);
  if (total === 0 || total === size) return { ...quotas };
  const raw = entries.map(([stars, q]) => ({ stars, exact: (q * size) / total }));
  const scaled = raw.map(r => ({ ...r, n: Math.floor(r.exact) }));
  let left = size - scaled.reduce((sum, r) => sum + r.n, 0);
  for (const r of [...scaled].sort((a, b) => (b.exact - b.n) - (a.exact - a.n) || Number(b.stars) - Number(a.stars))) {
    if (left-- <= 0) break;
    r.n++;
  }
  return Object.fromEntries(scaled.map(r => [r.stars, r.n]));
}

/**
 * teams: [{ id, stars }] — every team available.
 * humanTeamIds: ids that must be in the field.
 * Returns team ids: humans first, then CPU teams; length `size` when enough teams exist.
 */
export function fillField({ teams, humanTeamIds, quotas = DEFAULT_FIELD_QUOTAS, rng, size = FIELD_SIZE }) {
  const humans = new Set(humanTeamIds);
  const cpuPool = teams.filter(t => !humans.has(t.id));
  const picked = [];
  for (const [starsKey, quota] of Object.entries(quotas)) {
    const stars = Number(starsKey);
    const humansInTier = teams.filter(t => humans.has(t.id) && t.stars === stars).length;
    const need = Math.max(0, quota - humansInTier);
    picked.push(...shuffle(cpuPool.filter(t => t.stars === stars), rng).slice(0, need).map(t => t.id));
  }
  const cpuSlots = Math.max(0, size - humans.size);
  let cpu = shuffle(picked, rng).slice(0, cpuSlots);
  if (cpu.length < cpuSlots) {
    const chosen = new Set(cpu);
    const extra = shuffle(cpuPool.filter(t => !chosen.has(t.id)), rng).slice(0, cpuSlots - cpu.length);
    cpu = [...cpu, ...extra.map(t => t.id)];
  }
  return [...humans, ...cpu];
}
