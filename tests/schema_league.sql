-- The real schema of baseduel.db, taken from a snapshot on 2026-11-05.
CREATE TABLE bd_arena_bases (
    arena       TEXT PRIMARY KEY COLLATE NOCASE,
    bases       TEXT NOT NULL,
    updated_at  REAL,
    updated_by  TEXT
);

CREATE TABLE bd_match_players (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id      INTEGER NOT NULL REFERENCES bd_matches(id) ON DELETE CASCADE,
    player_name   TEXT NOT NULL,
    team          TEXT NOT NULL,       -- display team name they played for
    freq          INTEGER NOT NULL,
    is_captain    INTEGER NOT NULL DEFAULT 0,
    is_winner     INTEGER NOT NULL DEFAULT 0,
    safe_touches  INTEGER NOT NULL DEFAULT 0,
    kills         INTEGER NOT NULL DEFAULT 0,
    deaths        INTEGER NOT NULL DEFAULT 0,
    teamkills     INTEGER NOT NULL DEFAULT 0,
    dmg_given     INTEGER NOT NULL DEFAULT 0,
    dmg_taken     INTEGER NOT NULL DEFAULT 0,
    attaches      INTEGER NOT NULL DEFAULT 0,
    attached_to   INTEGER NOT NULL DEFAULT 0,
    reps          INTEGER NOT NULL DEFAULT 0,
    bursts        INTEGER NOT NULL DEFAULT 0,
    active_time   REAL NOT NULL DEFAULT 0,
    exit_kind     TEXT                 -- 'S' specced, 'D' disconnected, NULL = stayed
, best_streak INTEGER NOT NULL DEFAULT 0, streaks INTEGER NOT NULL DEFAULT 0, streak_ends INTEGER NOT NULL DEFAULT 0, max_bounty INTEGER NOT NULL DEFAULT 0, no_result INTEGER NOT NULL DEFAULT 0);

CREATE TABLE bd_matches (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id   INTEGER,
    team_a      TEXT NOT NULL,
    team_b      TEXT NOT NULL,
    target      INTEGER NOT NULL,
    winby       INTEGER NOT NULL,
    team_size   INTEGER NOT NULL,
    score_a     INTEGER NOT NULL,
    score_b     INTEGER NOT NULL,
    winner_freq INTEGER,
    outcome     TEXT NOT NULL,
    mode        TEXT NOT NULL DEFAULT 'league',
    arena       TEXT,
    started_at  REAL,
    ended_at    REAL
, held_seconds REAL NOT NULL DEFAULT 0, time_limit INTEGER, dead_seconds REAL NOT NULL DEFAULT 0, recording TEXT, game_mode TEXT, game_mode_freq INTEGER, game_mode_until REAL, game_mode_end TEXT);

CREATE TABLE bd_player_flags (
    arena   TEXT NOT NULL COLLATE NOCASE,
    player  TEXT NOT NULL COLLATE NOCASE,
    flag    TEXT NOT NULL,
    set_by  TEXT,
    set_at  REAL,
    PRIMARY KEY (arena, player, flag)
);

CREATE TABLE bd_round_players (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id      INTEGER NOT NULL REFERENCES bd_rounds(id) ON DELETE CASCADE,
    match_id      INTEGER NOT NULL REFERENCES bd_matches(id) ON DELETE CASCADE,
    round_no      INTEGER NOT NULL,    -- denormalised for cheap grouping
    player_name   TEXT NOT NULL,
    team          TEXT NOT NULL,
    freq          INTEGER NOT NULL,
    is_winner     INTEGER NOT NULL DEFAULT 0,   -- won THIS round, not the match
    safe_touches  INTEGER NOT NULL DEFAULT 0,
    kills         INTEGER NOT NULL DEFAULT 0,
    deaths        INTEGER NOT NULL DEFAULT 0,
    teamkills     INTEGER NOT NULL DEFAULT 0,
    dmg_given     INTEGER NOT NULL DEFAULT 0,
    dmg_taken     INTEGER NOT NULL DEFAULT 0,
    attaches      INTEGER NOT NULL DEFAULT 0,
    attached_to   INTEGER NOT NULL DEFAULT 0,
    reps          INTEGER NOT NULL DEFAULT 0,
    bursts        INTEGER NOT NULL DEFAULT 0,
    active_time   REAL NOT NULL DEFAULT 0
, streaks INTEGER NOT NULL DEFAULT 0, streak_ends INTEGER NOT NULL DEFAULT 0);

CREATE TABLE bd_rounds (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id      INTEGER NOT NULL REFERENCES bd_matches(id) ON DELETE CASCADE,
    seq           INTEGER NOT NULL,    -- monotonic open-order; stable identity
    round_no      INTEGER NOT NULL,    -- may repeat/step back; display value
    attempt       INTEGER NOT NULL DEFAULT 1,   -- display only; 2 = a replay
    counted       INTEGER NOT NULL DEFAULT 1,
    base_num      INTEGER,
    winner_freq   INTEGER,             -- NULL when the round produced no point
    ended_by      TEXT NOT NULL,
    scorer_name   TEXT,                -- display name on 'touch'; else NULL
    score_a       INTEGER NOT NULL DEFAULT 0,   -- running score AFTER the round
    score_b       INTEGER NOT NULL DEFAULT 0,
    started_at    REAL,
    ended_at      REAL,
    duration_s    REAL NOT NULL DEFAULT 0
);

CREATE TABLE bd_settings (
    arena       TEXT NOT NULL COLLATE NOCASE,
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,
    updated_at  REAL,
    updated_by  TEXT,
    PRIMARY KEY (arena, key)
);

CREATE TABLE kill_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id        INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    killer          TEXT NOT NULL,
    victim          TEXT NOT NULL,
    killer_squad_id INTEGER,
    victim_squad_id INTEGER,
    seq             INTEGER NOT NULL,       -- kill order within the match
    kill_time       REAL,                   -- epoch seconds (for multi-kills)
    revenge         INTEGER NOT NULL DEFAULT 0,  -- killed your most-recent killer
    clutch          INTEGER NOT NULL DEFAULT 0   -- killer was last alive on team
);

CREATE TABLE match_players (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id      INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_name   TEXT NOT NULL,
    squad_id      INTEGER REFERENCES squads(id) ON DELETE SET NULL,
    freq          INTEGER NOT NULL,
    is_sub        INTEGER NOT NULL DEFAULT 0,   -- 1 = filled in, NOT on squad_players
    kills         INTEGER NOT NULL DEFAULT 0,
    deaths        INTEGER NOT NULL DEFAULT 0,
    dmg_given     INTEGER NOT NULL DEFAULT 0,
    dmg_taken     INTEGER NOT NULL DEFAULT 0,
    best_streak   INTEGER NOT NULL DEFAULT 0,
    kos           INTEGER NOT NULL DEFAULT 0,    -- kills that eliminated a player
    placement     INTEGER,                      -- 1 = winner
    time_alive_s  REAL NOT NULL DEFAULT 0,
    disconnected  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE matches (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id   INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
    mode        TEXT NOT NULL,        -- 'ffa' | 'team2'..'team5'
    match_type  TEXT NOT NULL,        -- 'league' | 'casual'
    num_teams   INTEGER NOT NULL,
    team_size   INTEGER NOT NULL,
    started_at  REAL,
    ended_at    REAL,
    winner_freq INTEGER,
    arena TEXT
);

CREATE TABLE ratings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id       INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    player_name     TEXT NOT NULL,
    elo             REAL NOT NULL DEFAULT 1500,
    matches_played  INTEGER NOT NULL DEFAULT 0,
    UNIQUE(season_id, player_name)
);

CREATE TABLE seasons (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    created_at  REAL NOT NULL,
    active      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE squad_players (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    squad_id    INTEGER NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
    player_name TEXT NOT NULL,
    UNIQUE(squad_id, player_name)
);

CREATE TABLE squads (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id   INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    created_at  REAL NOT NULL,
    UNIQUE(season_id, name)
);

CREATE INDEX idx_bd_match_players_match
    ON bd_match_players(match_id);

CREATE INDEX idx_bd_match_players_name
    ON bd_match_players(player_name);

CREATE INDEX idx_bd_round_players_match
    ON bd_round_players(match_id, round_no);

CREATE INDEX idx_bd_round_players_name
    ON bd_round_players(player_name);

CREATE INDEX idx_bd_round_players_round
    ON bd_round_players(round_id);

CREATE INDEX idx_bd_rounds_match
    ON bd_rounds(match_id, seq);

CREATE INDEX idx_kill_log_killer ON kill_log(killer);

CREATE INDEX idx_kill_log_match  ON kill_log(match_id);

CREATE INDEX idx_kill_log_victim ON kill_log(victim);

CREATE INDEX idx_match_players_match ON match_players(match_id);

CREATE INDEX idx_match_players_name  ON match_players(player_name);

CREATE INDEX idx_squad_players_squad ON squad_players(squad_id);

