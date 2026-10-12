CREATE TABLE IF NOT EXISTS dooo_devices (
  id uuid PRIMARY KEY, name text NOT NULL, enabled boolean NOT NULL DEFAULT true,
  last_seen timestamptz NOT NULL DEFAULT now(), locked boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS dooo_runs (
  id uuid PRIMARY KEY, request_id uuid NOT NULL UNIQUE, device_id uuid NOT NULL REFERENCES dooo_devices(id),
  instruction text NOT NULL, task_id text, task_run_id text, task_session jsonb, source text NOT NULL,
  status text NOT NULL DEFAULT 'queued', summary text NOT NULL DEFAULT '', instance_id uuid,
  model_calls integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS dooo_one_run_per_pc ON dooo_runs(device_id) WHERE status IN ('queued','running','waiting_approval');
ALTER TABLE dooo_devices ADD COLUMN IF NOT EXISTS control_version integer NOT NULL DEFAULT 1;
ALTER TABLE dooo_runs ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'desktop';
ALTER TABLE dooo_runs ADD COLUMN IF NOT EXISTS safety_calls integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS dooo_run_events (
  id bigserial PRIMARY KEY, run_id uuid NOT NULL REFERENCES dooo_runs(id) ON DELETE CASCADE,
  kind text NOT NULL, summary text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dooo_approvals (
  id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES dooo_runs(id) ON DELETE CASCADE,
  action jsonb NOT NULL, frame_hash text NOT NULL, description text NOT NULL,
  decision text, consumed boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dooo_one_pending_approval ON dooo_approvals(run_id) WHERE decision IS NULL;
CREATE TABLE IF NOT EXISTS dooo_frames (
  device_id uuid PRIMARY KEY REFERENCES dooo_devices(id), image bytea NOT NULL, width integer NOT NULL,
  height integer NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dooo_pair_codes (
  hash text PRIMARY KEY, expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);
CREATE TABLE IF NOT EXISTS dooo_phone_sessions (
  hash text PRIMARY KEY, label text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days'
);
CREATE TABLE IF NOT EXISTS dooo_push (
  session_hash text PRIMARY KEY REFERENCES dooo_phone_sessions(hash) ON DELETE CASCADE,
  subscription jsonb NOT NULL
);
