import { shuffle } from './rng.js';

export const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const POT_SIZE = GROUP_LETTERS.length;
const MAX_STEPS = 200000;

/** teams: [{ id, name, country, ovr }] — exactly 32. Returns 4 pots of 8, strongest first. */
export function makePots(teams) {
  if (teams.length !== POT_SIZE * 4) throw new Error(`The draw needs exactly 32 teams, got ${teams.length}`);
  const sorted = [...teams].sort((a, b) => b.ovr - a.ovr || a.name.localeCompare(b.name));
  return [0, 1, 2, 3].map(p => sorted.slice(p * POT_SIZE, (p + 1) * POT_SIZE));
}

/**
 * Classic CL draw: teams come out pot by pot in random order; each goes into the first
 * group (A..H) with a free slot for its pot, no same-country team, and a solvable remainder.
 */
export function drawGroups(pots, rng) {
  const sequence = pots.flatMap(pot => shuffle(pot, rng));
  return place(sequence, true) ?? place(sequence, false);
}

function place(sequence, respectCountry) {
  const groups = GROUP_LETTERS.map(letter => ({ letter, teams: [] }));
  let steps = 0;
  const fits = (team, group, slot) =>
    group.teams.length === slot &&
    !(respectCountry && team.country && group.teams.some(o => o.country === team.country));

  function solve(i) {
    if (i === sequence.length) return true;
    if (++steps > MAX_STEPS) return false;
    const team = sequence[i];
    const slot = Math.floor(i / POT_SIZE);
    for (const group of groups) {
      if (!fits(team, group, slot)) continue;
      group.teams.push(team);
      if (solve(i + 1)) return true;
      group.teams.pop();
    }
    return false;
  }

  return solve(0) ? groups : null;
}
