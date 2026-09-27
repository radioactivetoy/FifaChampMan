# FIFA ChampMan

Local web app to run our special Champions League on EA SPORTS FC 27. Matches are played on the
console; this app manages players, teams, the draw, who controls each team, results and stats.

## Run

```bash
npm install
npm start
```

Open http://localhost:3000. Friends on the same Wi-Fi can use http://<this-PC-IP>:3000
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
5. **Group stage** – generate fixtures (single round: 3 matches per team). Play matches in any
   order: before a human-vs-CPU match press **🎲 Draw** to pick who controls the CPU team, then
   enter the result. CPU-vs-CPU matches are simulated by the console (result optional).
   Mark who qualified.
6. **Playoff** – add each match by hand, press 🎲 Draw before playing, enter results.
7. **Results** – set how far each team got (up to Champion), check the stars earned, mark finished.
8. **Stats** – all-time table.

Everything (teams, controllers, scores, groups, stages, stars) can be edited at any time.

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

Going up a level: choose between two random teams of the new level. Otherwise a team is assigned.

## Develop

`npm test` runs all tests (Node's built-in test runner).
