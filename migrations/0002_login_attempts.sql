-- Per-source fixed windows. No raw IP address or password is stored here.
CREATE TABLE IF NOT EXISTS login_attempts (
  source TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_expiry ON login_attempts(expires_at);
