PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tiers (
  stars REAL PRIMARY KEY,
  min_ovr INTEGER NOT NULL
);

-- Default "teams per star level" quotas the random field fill starts from (Config page; editable).
CREATE TABLE IF NOT EXISTS field_quotas (
  stars REAL PRIMARY KEY,
  quota INTEGER NOT NULL
);

-- edition default must match domain/editions.js's DEFAULT_EDITION (SQL DEFAULT can't reference JS).
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  edition TEXT NOT NULL DEFAULT 'FC 27',
  country TEXT NOT NULL DEFAULT '',
  league TEXT NOT NULL DEFAULT '',
  ovr INTEGER NOT NULL,
  stars_override REAL,
  badge_url TEXT NOT NULL DEFAULT '',
  league_badge_url TEXT NOT NULL DEFAULT '',
  country_flag_url TEXT NOT NULL DEFAULT '',
  UNIQUE (name, edition)
);

-- Named sets of teams used as a championship's team pool.
CREATE TABLE IF NOT EXISTS team_templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS team_template_teams (
  template_id INTEGER NOT NULL REFERENCES team_templates(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  PRIMARY KEY (template_id, team_id)
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  photo BLOB,
  photo_type TEXT
);

CREATE TABLE IF NOT EXISTS championships (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  edition TEXT NOT NULL DEFAULT 'FC 27', -- keep in sync with domain/editions.js's DEFAULT_EDITION
  status TEXT NOT NULL DEFAULT 'active',
  template_id INTEGER REFERENCES team_templates(id) ON DELETE SET NULL,
  group_stage_closed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A player taking part in a championship, with the level and team they play with.
CREATE TABLE IF NOT EXISTS championship_players (
  championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id),
  stars REAL NOT NULL DEFAULT 0.5,
  team_id INTEGER REFERENCES teams(id),
  offered_team_ids TEXT NOT NULL DEFAULT '[]',
  result_stars_override REAL,
  PRIMARY KEY (championship_id, player_id)
);

-- The 32-team field: human and CPU teams, their pot, group and how far they got.
CREATE TABLE IF NOT EXISTS championship_teams (
  championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  pot INTEGER,
  group_letter TEXT,
  reached TEXT NOT NULL DEFAULT 'group',
  points_override INTEGER,
  PRIMARY KEY (championship_id, team_id)
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY,
  championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  group_letter TEXT,
  matchday INTEGER,
  leg INTEGER,
  slot INTEGER,
  home_team_id INTEGER NOT NULL REFERENCES teams(id),
  away_team_id INTEGER NOT NULL REFERENCES teams(id),
  home_score INTEGER,
  away_score INTEGER,
  home_pens INTEGER,
  away_pens INTEGER,
  home_controller_id INTEGER REFERENCES players(id),
  away_controller_id INTEGER REFERENCES players(id)
);

-- Steps to reverse the last destructive actions (see repo/undo.js); short-lived.
CREATE TABLE IF NOT EXISTS undo_log (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  steps TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
