// Single round robin by draw position (0 = pot 1 team): each team plays the other three once.
const SCHEDULE = [
  [[0, 1], [2, 3]],
  [[3, 0], [1, 2]],
  [[0, 2], [3, 1]],
];

export function groupFixtures(teamIds) {
  if (teamIds.length !== 4) throw new Error(`A group needs 4 teams, got ${teamIds.length}`);
  return SCHEDULE.flatMap((day, i) =>
    day.map(([h, a]) => ({ matchday: i + 1, homeTeamId: teamIds[h], awayTeamId: teamIds[a] })));
}
