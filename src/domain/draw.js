import { shuffle } from './rng.js';

export const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
export const GROUP_SIZE = 4;
export const MIN_GROUP_TEAMS = 8; // 2 groups
export const MAX_GROUP_TEAMS = GROUP_LETTERS.length * GROUP_SIZE; // 8 groups = 32
const MAX_STEPS = 200000;

/** Teams must fill whole groups of four: 8, 12, 16 … 32. */
export const isValidGroupTeamCount = n => Number.isInteger(n) && n % GROUP_SIZE === 0 && n >= MIN_GROUP_TEAMS && n <= MAX_GROUP_TEAMS;

/** The group letters used by a field of `teamCount` teams (A, B, … one per four teams). */
export const groupLettersFor = teamCount => GROUP_LETTERS.slice(0, Math.floor(teamCount / GROUP_SIZE));

/** teams: [{ id, name, country, ovr }] — a multiple of 4 (8–32). Returns 4 pots of teams/4, strongest first. */
export function makePots(teams) {
  if (!isValidGroupTeamCount(teams.length)) throw new Error(`The draw needs 8 to 32 teams in a multiple of 4, got ${teams.length}`);
  const potSize = teams.length / GROUP_SIZE;
  const sorted = [...teams].sort((a, b) => b.ovr - a.ovr || a.name.localeCompare(b.name));
  return [0, 1, 2, 3].map(p => sorted.slice(p * potSize, (p + 1) * potSize));
}

/**
 * Classic CL draw: teams come out pot by pot in random order; each goes into the first
 * group (A, B, …) with a free slot for its pot, no same-country team, and a solvable remainder.
 */
export function drawGroups(pots, rng) {
  const sequence = pots.flatMap(pot => shuffle(pot, rng));
  const letters = groupLettersFor(sequence.length);
  return place(sequence, true, letters) ?? place(sequence, false, letters);
}

function place(sequence, respectCountry, letters) {
  const groups = letters.map(letter => ({ letter, teams: [] }));
  const potSize = letters.length;
  let steps = 0;
  const fits = (team, group, slot) =>
    group.teams.length === slot &&
    !(respectCountry && team.country && group.teams.some(o => o.country === team.country));

  function solve(i) {
    if (i === sequence.length) return true;
    if (++steps > MAX_STEPS) return false;
    const team = sequence[i];
    const slot = Math.floor(i / potSize);
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
