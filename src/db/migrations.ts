// Append-only: each entry runs once, in order, tracked by PRAGMA user_version.
// Timestamps are ISO-8601 UTC strings; calendar dates are YYYY-MM-DD.

export const MIGRATIONS: readonly string[] = [
  /* 1 — initial schema */ `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    google_sub TEXT UNIQUE,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    user_agent TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE login_states (
    state_hash TEXT PRIMARY KEY,
    nonce TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    next_path TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE plants (
    id INTEGER PRIMARY KEY,
    nickname TEXT NOT NULL,
    common_name TEXT NOT NULL,
    scientific_name TEXT NOT NULL,
    family TEXT,
    identification_confidence TEXT NOT NULL,
    identification_notes TEXT,
    room TEXT NOT NULL,
    indoor INTEGER NOT NULL DEFAULT 1,
    light TEXT NOT NULL,
    light_notes TEXT,
    water_interval_growing INTEGER NOT NULL,
    water_interval_rest INTEGER NOT NULL,
    watering_instructions TEXT NOT NULL,
    water_amount TEXT,
    humidity TEXT,
    humidity_notes TEXT,
    temp_min_c REAL,
    temp_max_c REAL,
    temperature_notes TEXT,
    soil TEXT,
    fertilizing TEXT,
    repotting TEXT,
    pruning TEXT,
    toxicity_pets TEXT NOT NULL DEFAULT 'unknown',
    toxicity_notes TEXT,
    difficulty TEXT,
    common_problems TEXT,
    tips TEXT,
    pot TEXT,
    notes TEXT,
    reminders_enabled INTEGER NOT NULL DEFAULT 1,
    snoozed_until TEXT,
    photo TEXT,
    archived_at TEXT,
    archive_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_via TEXT NOT NULL
  );

  CREATE TABLE care_events (
    id INTEGER PRIMARY KEY,
    plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    at TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    source TEXT NOT NULL,
    note TEXT
  );
  CREATE INDEX care_events_plant ON care_events(plant_id, type, at);

  CREATE TABLE photo_upload_tokens (
    token_hash TEXT PRIMARY KEY,
    plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    uploads INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE user_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    reminders_enabled INTEGER NOT NULL DEFAULT 1,
    reminder_time TEXT NOT NULL DEFAULT '09:00',
    last_reminder_date TEXT
  );

  CREATE TABLE push_subscriptions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at TEXT NOT NULL,
    last_success_at TEXT,
    failures INTEGER NOT NULL DEFAULT 0
  );

  -- OAuth 2.1 authorization server used by MCP clients (Claude).
  CREATE TABLE oauth_clients (
    client_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,                       -- 'dcr' | 'cimd'
    client_secret_hash TEXT,
    client_name TEXT,
    redirect_uris TEXT NOT NULL,              -- JSON array
    token_endpoint_auth_method TEXT NOT NULL,
    registration TEXT NOT NULL,               -- JSON, as returned to the client (no secret)
    created_at TEXT NOT NULL,
    expires_at TEXT                           -- CIMD cache expiry
  );

  CREATE TABLE oauth_requests (
    id_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    redirect_uri_provided INTEGER NOT NULL,
    state TEXT,
    code_challenge TEXT NOT NULL,
    scope TEXT NOT NULL,
    resource TEXT NOT NULL,
    session_hash TEXT,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE oauth_grants (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    client_name TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    resource TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
  );
  CREATE INDEX oauth_grants_user ON oauth_grants(user_id);

  CREATE TABLE oauth_codes (
    code_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redirect_uri TEXT NOT NULL,
    redirect_uri_provided INTEGER NOT NULL,
    code_challenge TEXT NOT NULL,
    scope TEXT NOT NULL,
    resource TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    grant_id TEXT
  );

  CREATE TABLE oauth_tokens (
    token_hash TEXT PRIMARY KEY,
    grant_id TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
    type TEXT NOT NULL,                       -- 'access' | 'refresh'
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    rotated_at TEXT                           -- refresh tokens: when exchanged
  );
  CREATE INDEX oauth_tokens_grant ON oauth_tokens(grant_id);

  CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];
