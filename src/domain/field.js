import { shuffle } from './rng.js';

export const FIELD_SIZE = 32;

export const DEFAULT_FIELD_QUOTAS = { 5: 4, 4.5: 4, 4: 4, 3.5: 3, 3: 3, 2.5: 3, 2: 3, 1.5: 3, 1: 3, 0.5: 2 };

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
