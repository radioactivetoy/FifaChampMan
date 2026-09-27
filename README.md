# FIFA ChampMan

Local web app to run our special Champions League on EA SPORTS FC 27. Matches are played on the
console; this app manages players, teams, the draw, who controls each team, results and stats.

## Run

```bash
npm install
npm start
```

Open http://localhost:3210. Friends on the same Wi-Fi can use http://<this-PC-IP>:3210
(find the IP with `ipconfig`; allow Node through the Windows firewall when asked).

Options: `PORT=4000`, `DB_PATH=D:\backups\champman.db`.

**Backup:** everything is in `champman.db`. Stop the app and copy the file.

## Typical season

1. **Players** – add everyone once. Stats are kept for all players.
2. **Teams** – import the FC 27 club list as CSV (copied from the fctoolshub FC27 clubs database
   into a spreadsheet): name, overall, league, country, and optionally club badge, league badge and
   country flag image URLs and stars. Filter by stars/league/country, fix any team's stars by hand,
   and adjust **Star tiers** if needed.
   **Templates** – save named sets of teams to use as a championship's team pool.
3. **Championships → New** – pick the template (or all teams) and tick who plays this time.
   Everyone gets a team from their star level; players going up choose between two.
4. **Field & draw** – fill the 32-team field randomly by star quotas, then run the group draw
   (8 groups of 4, pots by OVR, no two clubs from the same country in a group when possible).
5. **Group stage** – generate fixtures (single round: 3 matches per team). Who controls each CPU team
   facing a human is drawn automatically (press **🎲 Draw** on a match to re-draw), then
   enter results. CPU-vs-CPU matches are simulated by the console (result optional).
   Mark who qualified.
6. **Playoff** – add each match by hand (the CPU controller is drawn automatically), enter results.
7. **Results** – set how far each team got (up to Champion) and check the stars earned.
   When every player is out (nobody qualified from the groups, or all knocked out in the playoff),
   a banner asks for the winner simulated by the console and closes the championship; if a player
   wins, it offers to close it.
8. **Recap** – per championship: each player's result and stats (group position, points, goals,
   all matches, record as CPU controller), the groups with players and all their matches.
9. **Stats** – all-time: highlight cards, sortable leaderboard (titles, finals, stars, own-team
   and CPU-controller records, win %, points per game), championship history grid, head-to-head
   grid, hall of champions and biggest wins.

Everything (teams, controllers, scores, groups, stages, stars) can be edited at any time.

## Yearly team refresh (new FC game)

1. Open the fctoolshub clubs database sorted by overall, e.g.
   https://fctoolshub.com/en/database/fc27/clubs?sort%5B0%5D=data.overall%3Adesc (change `fc27`).
2. Press F12 → Console, paste the contents of [tools/export-fctoolshub.js](tools/export-fctoolshub.js),
   press Enter and wait (a few minutes; it browses slowly because the site rate-limits).
   `champman-teams.csv` downloads.
3. ChampMan → Teams → Import from CSV → choose the file.
4. Refresh the Champions League template (all European top-division clubs):

```bash
node tools/create-ucl-template.mjs
```

5. Check **Star tiers**: the new game's OVR spread may need the tiers adjusted so every level has clubs.

## Star rules

| Result | Next level |
|---|---|
| Champion | 5★ |
| Reached final | 4.5★ |
| Semi-final | 4★ |
| Quarter-final | 3.5★ |
| Qualified from group | 3★ |
| Won a game | 2★ |
| Got a point | 1.5★ |
| Scored a goal | 1★ |
| Nothing | 0.5★ |

Default star tiers (FC 27 has no clubs under 54 OVR, so the bottom levels are shifted up):
0.5★ ≤60, 1★ 61–62, 1.5★ 63, 2★ 64, 2.5★ 65–66, 3★ 67–69, 3.5★ 70–72, 4★ 73–76, 4.5★ 77–81, 5★ 82+.

Going up a level: choose between two random teams of the new level. Otherwise a team is assigned.

## Develop

`npm test` runs all tests (Node's built-in test runner).
