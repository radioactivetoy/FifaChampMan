# FIFA ChampMan

Web app to run our special Champions League on EA SPORTS FC 27. Matches are played on the console; this app
manages players, teams, the draw, who controls each team, results, stats, trophies and the story of every
championship. One machine runs it (a PC or a NAS); friends open it from their phones.

## Run

```bash
npm install
npm start
```

Open http://localhost:3210. Friends on the same Wi-Fi can use http://<this-PC-IP>:3210
(find the IP with `ipconfig`; allow Node through the Windows firewall when asked).

Options: `PORT=4000`, `DB_PATH=D:\backups\champman.db`. Everything lives in that one file (`champman.db`); see **Backups**.

## Typical season

1. **Players** – add everyone once (a photo too, from the phone's camera or gallery). Stats are kept for all players.
   Someone who stopped coming can be **deactivated** (hidden from new championships, history kept).
2. **Teams** – import the FC 27 club list as CSV (copied from the fctoolshub FC27 clubs database
   into a spreadsheet): name, overall, league, country, and optionally club badge, league badge and
   country flag image URLs and stars. Filter by stars/league/country, fix any team's stars by hand.
   **Config** – star tiers, the "Fill field randomly" default team counts per star level, and team
   templates (named sets of teams to use as a championship's team pool) all live here.
3. **Championships → New** – pick the template (or all teams) and tick who plays this time (the form shows each
   player's level and how many teams each pool has per star level). Everyone gets a team from their star level;
   players going up choose between two. The name defaults to `Championship yyyy-mm-dd hh:mm`.
4. **Field & draw** – fill the field randomly by star quotas (32 teams by default; a multiple of 4 from 8 to 32 —
   the number of groups adapts), then run the group draw (groups of 4, pots by OVR, no two clubs from the same
   country in a group when possible). A championship can instead be a **cup** (knockout only, 4–64 teams, like the
   Copa del Rey): there is no group stage and you copy the game's bracket into the Playoff tab by hand. When the
   number of qualifiers (or cup teams) is not a power of two, the bracket rounds up and the empty first-round
   places are byes (automatic for the best group winners, tick "Bye" by hand in a cup).
5. **Group stage** – generate fixtures (single round: 3 matches per team). Who controls each CPU team
   facing a human is drawn automatically (never someone with a team in the same group; press **🎲 Draw** on a
   match to re-draw), then enter results and press **Save results** once per group. CPU-vs-CPU matches are
   simulated by the console (result optional). Type the CPU teams' points from the FIFA group table (player teams
   are calculated), then **Close group stage**: two teams per group qualify (the ones you marked, or the top two by
   points) and only they can be picked in the playoff. A summary flags qualifiers with missing scores.
   **Reopen group stage** undoes it.
6. **Playoff** – the whole bracket is always shown (8 – 4 – 2 – Final, left to right). Pick the two teams
   of each tie from the dropdowns and type the scores (the CPU controller is drawn automatically), then
   press **Save playoff** once to save everything. Winners move into the next round by themselves (you see it
   while typing), and "reached" is updated from the results. ⋯ more on a match: controllers, penalties, swap, delete.
7. **Results** – check how far each team got (set from the playoff, editable up to Champion) and the stars
   earned. When every player is out (nobody qualified from the groups, or all knocked out in the playoff),
   a banner asks for the winner simulated by the console and closes the championship; if a player
   wins, it offers to close it. A decided Final sets the champion automatically. A closed championship
   shows its champion (and which player won it); reopen it to change anything.
8. **Recap** – per championship: the story in a few lines, awards (best attack and defence, goal fest, biggest
   win, upset), each player's result and stats, revenge matches, the groups and all the matches, a group photo
   (upload it from the overview) and **📜 The tale** (see below).
9. **Stats** – all-time: highlight cards, fun stats (Golden Boot, Roller Coaster, Bottler, Group of death,
   nemesis & victim…), sortable leaderboard, Elo ranking of the people, championship history, head-to-head
   grid, star journeys. From there: **Records**, **Head to head** (two players, every match between them),
   **Hall of Fame** and the **yearly ranking** (`/season`: points per championship by how far you got, plus a point
   per win). Each player has a **profile** (click their name) with Elo, records, trophies and achievements.

Every step can be edited by hand at any time (teams, controllers, scores, groups, stages, stars, dates), and the
destructive or random ones have an **Undo** bar for 30 minutes. A "Next: …" link under each championship's tabs
says what to do next.

### Trophies, achievements and fun

- 🥄 **Cuchara de Madera**: a player whose team gets 0 points and 0 goals in the group stage earns the wooden spoon.
- **Maracas Trophy**: lose all three group games 0–10 or worse. Never achieved… yet. Its holders get a vitrine in the
  Hall of Fame.
- **Achievements**: 25 badges (first title, unbeaten run, CPU tamer…); a toast pops up when someone unlocks one, and
  they show on the player's profile.
- **Revenge**: a rematch against the player who knocked you out last time is marked as such.

### Around the gaming night

- **Home** (🏠) – the current championship, what each player has to play next, the last champion.
- **Session** – a summary of the last 1, 2 or 7 days (championships, matches, highlights, best player), with a
  copyable text for the group chat.
- **TV mode** (`/tv`) – a full-screen, dark page that refreshes itself: next matches, standings, latest results.
  Leave it on the television.
- **Export / import** – a championship can be downloaded as JSON and imported into another ChampMan.

### 📜 The tale

On a finished championship's Recap, **Copy the prompt** gives a ready-made prompt (in the page's language, with the
facts of the championship and a style: bar chronicler, war report, soap opera, EA rage, conspiracy theorist… or
your own) to paste into Gemini or any chat, then paste the answer back. With a free Google AI Studio key in
`LLM_KEY`, a **Write the story** button does it in one click; the model can be chosen in **Config → Story
generator**. See [docs/DEPLOY.md](docs/DEPLOY.md).

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

`npm test` runs all tests (Node's built-in test runner). See [CLAUDE.md](CLAUDE.md) for the architecture and rules.

## Language and theme

The app is in **Spanish (Spain)** by default; the **ES | EN** switch in the top-right of the header changes it, and
**☀ / ☾** picks light or dark mode (each browser or phone remembers its own choice, otherwise it follows the
device). Team, league, country and player names are data and are never translated.

## Organisers and viewers

By default everybody who can open the app can change it. Set `EDITOR_TOKEN` in `.env` and only the devices that
opened `/editor?token=<it>` once can edit; everybody else gets a read-only view. See [docs/DEPLOY.md](docs/DEPLOY.md).

## Backups

Every time the app starts, and then once a day (`BACKUP_EVERY_HOURS`, default 24), it copies the data file into
`backups/` next to it (newest 14 kept). **Config** lists them with **Download** and **Restore** (the restore is applied
on the next start, keeping a copy of the data it replaces), plus **Back up now** and **Download backup**.

## Running on a NAS (Docker + Cloudflare Tunnel)

`docker compose up -d --build` starts the app plus a `cloudflared` tunnel container; see [docs/DEPLOY.md](docs/DEPLOY.md)
(create the tunnel and an Access policy first — the app has no login of its own).

Your own settings never go in `docker-compose.yml`: secrets in `.env`, and a NAS folder or a LAN port in
`docker-compose.override.yml` (copy `docker-compose.override.yml.example`). Both are git-ignored, so updating is always:

```bash
git pull
docker compose up -d --build
```
