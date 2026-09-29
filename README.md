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
   country flag image URLs and stars. Filter by stars/league/country, fix any team's stars by hand.
   **Config** – star tiers, the "Fill field randomly" default team counts per star level, and team
   templates (named sets of teams to use as a championship's team pool) all live here.
3. **Championships → New** – pick the template (or all teams) and tick who plays this time.
   Everyone gets a team from their star level; players going up choose between two.
4. **Field & draw** – fill the 32-team field randomly by star quotas, then run the group draw
   (8 groups of 4, pots by OVR, no two clubs from the same country in a group when possible).
5. **Group stage** – generate fixtures (single round: 3 matches per team). Who controls each CPU team
   facing a human is drawn automatically (press **🎲 Draw** on a match to re-draw), then
   enter results. CPU-vs-CPU matches are simulated by the console (result optional).
   Type the CPU teams' points from the FIFA group table (player teams are calculated), then
   **Close group stage**: two teams per group qualify (the ones you marked, or the top two by points)
   and only they can be picked in the playoff. **Reopen group stage** undoes it.
6. **Playoff** – the whole bracket is always shown (8 – 4 – 2 – Final, left to right). Pick the two teams
   of each tie from the dropdowns and type the scores (the CPU controller is drawn automatically), then
   press **Save playoff** once to save everything. Winners move into the next round by themselves, and
   "reached" is updated from the results. ⋯ more on a match: controllers, penalties, swap, delete.
7. **Results** – check how far each team got (set from the playoff, editable up to Champion) and the stars
   earned. When every player is out (nobody qualified from the groups, or all knocked out in the playoff),
   a banner asks for the winner simulated by the console and closes the championship; if a player
   wins, it offers to close it. A decided Final sets the champion automatically. A closed championship
   shows its champion (and which player won it) on every tab; reopen it to change anything.
   🥄 **Cuchara de Madera**: a player whose team gets 0 points and 0 goals in the group stage earns the
   wooden spoon — shown on Results, Recap, the finished championship header and Stats.
8. **Recap** – per championship: each player's result and stats (group position, points, goals,
   all matches, record as CPU controller), the groups with players and all their matches.
9. **Stats** – all-time: highlight cards, sortable leaderboard (titles, finals, stars, own-team
   and CPU-controller records, win %, points per game), championship history grid (one row per championship, one column per player, plus the champion), head-to-head
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

5. Check **Config → Star tiers**: if the new game's star bands moved, adjust them (or **Reset to EA table**).

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

Default star tiers — EA's own team-overall → star table (EA doesn't publish it; this is what the community guides give for FC 25/26,
and it matches real clubs): 0.5★ ≤59, 1★ 60–62, 1.5★ 63–64, 2★ 65–66, 2.5★ 67–68, 3★ 69–70, 3.5★ 71–74, 4★ 75–78, 4.5★ 79–82, 5★ 83+.
They are stored per database and editable on **Config**, which also has **Reset to EA table**.

Going up a level: choose between two random teams of the new level. Otherwise a team is assigned.

## Develop

`npm test` runs all tests (Node's built-in test runner).

## Language

The app is in **Spanish (Spain)** by default; the **ES | EN** switch in the top-right of the header changes it (each browser or phone
remembers its own choice). Team, league, country and player names are data and are never translated.

## Player photos

**Players → Add photo** (works from a phone's camera or gallery too). The picture is cropped square and shrunk in the
browser before it is saved, and shows next to the player's name on Stats, Results, Recap and their profile.

## Backups

Every time the app starts it copies the data file into `backups/` (newest 10 kept). **Config → Download backup**
gives a consistent copy on demand. To restore, stop the app and put a backup file back as `champman.db`.
