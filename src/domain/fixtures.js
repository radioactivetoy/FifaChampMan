// Classic CL group schedule by draw position (0 = pot 1 team).
const SCHEDULE = [
  [[0, 1], [2, 3]],
  [[3, 0], [1, 2]],
  [[0, 2], [3, 1]],
  [[2, 0], [1, 3]],
  [[1, 0], [3, 2]],
  [[0, 3], [2, 1]],
];

export function groupFixtures(teamIds) {
  if (teamIds.length !== 4) throw new Error(`A group needs 4 teams, got ${teamIds.length}`);
  return SCHEDULE.flatMap((day, i) =>
    day.map(([h, a]) => ({ matchday: i + 1, homeTeamId: teamIds[h], awayTeamId: teamIds[a] })));
}
