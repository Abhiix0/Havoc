CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ship_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  client_ship_check_id TEXT NOT NULL,
  target_origin TEXT NOT NULL,
  readiness TEXT NOT NULL CHECK (readiness IN ('READY','NEEDS_ATTENTION','BLOCKED','UNKNOWN')),
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, client_ship_check_id)
);

CREATE TABLE ship_check_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ship_check_id UUID NOT NULL REFERENCES ship_checks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DONE','ERRORED','SKIPPED')),
  ordinal SMALLINT NOT NULL
);

CREATE TABLE findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ship_check_id UUID NOT NULL REFERENCES ship_checks(id) ON DELETE CASCADE,
  client_finding_id TEXT NOT NULL,
  check_kind TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  description TEXT NOT NULL
);

CREATE TABLE evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id UUID NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE remediations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id UUID NOT NULL UNIQUE REFERENCES findings(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  what_happened TEXT NOT NULL,
  why_it_matters TEXT NOT NULL,
  how_to_fix JSONB NOT NULL,
  fix_prompt TEXT NOT NULL CHECK (char_length(fix_prompt) <= 10000)
);

CREATE INDEX idx_ship_checks_project_created ON ship_checks(project_id, created_at DESC);
CREATE INDEX idx_findings_ship_check ON findings(ship_check_id);
CREATE INDEX idx_evidence_finding ON evidence(finding_id);
