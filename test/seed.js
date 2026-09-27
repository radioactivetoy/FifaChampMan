import { saveTeam } from '../src/repo/teams.js';
import { savePlayer } from '../src/repo/players.js';

/** 100 teams, OVR 90 down to 41 (two per OVR), countries C0..C7. Every star tier has teams. */
export function seedTeams(db, count = 100) {
  return Array.from({ length: count }, (_, i) => saveTeam(db, {
    name: `Team ${String(i).padStart(3, '0')}`, country: `C${i % 8}`, league: `L${i % 8}`, ovr: 90 - Math.floor(i / 2),
  }));
}

export function seedPlayers(db, names = ['Ana', 'Ben', 'Cris']) {
  return names.map(name => savePlayer(db, { name }));
}
