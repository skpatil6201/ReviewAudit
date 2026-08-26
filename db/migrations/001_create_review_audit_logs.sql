CREATE TABLE IF NOT EXISTS review_audit_logs (
  id           TEXT PRIMARY KEY,
  device_id    TEXT        NOT NULL,
  platform     TEXT,
  app_version  TEXT,
  ts           TIMESTAMPTZ NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id      TEXT,
  actor_email  TEXT,
  actor_role   TEXT,
  level        TEXT        NOT NULL,
  category     TEXT        NOT NULL,
  label        TEXT,
  summary      TEXT,
  duration_ms  INTEGER,
  request      JSONB,
  response     JSONB,
  error        TEXT,
  context      JSONB
);

CREATE INDEX IF NOT EXISTS review_audit_logs_user_ts_idx     ON review_audit_logs (user_id, ts DESC);
CREATE INDEX IF NOT EXISTS review_audit_logs_category_ts_idx ON review_audit_logs (category, ts DESC);
CREATE INDEX IF NOT EXISTS review_audit_logs_level_ts_idx    ON review_audit_logs (level, ts DESC);
CREATE INDEX IF NOT EXISTS review_audit_logs_device_ts_idx   ON review_audit_logs (device_id, ts DESC);
