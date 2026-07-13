-- Loregrid — schema inicial
-- Três sistemas de coordenadas desacoplados: semântico (relationships),
-- board (board_nodes/edges), geográfico (map_pins).

-- ── extensões ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- email case-insensitive
CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector (RAG)

-- ── enums ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE entry_type AS ENUM (
    'character','location','region','faction','item','magic_system',
    'species','creature','deity','religion','event','lore',
    'language','scene','chapter','note'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE entry_status AS ENUM ('draft','canon','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ai_status AS ENUM ('open','ignored','resolved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ai_kind AS ENUM ('inconsistency','suggestion','gap','interview');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── helper: updated_at ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ── núcleo ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext UNIQUE NOT NULL,
  password_hash text,
  provider      text NOT NULL DEFAULT 'local',
  provider_id   text,
  display_name  text,
  avatar_url    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_id)
);
DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  slug        text NOT NULL,
  description text,
  cover_url   text,
  calendar    jsonb NOT NULL DEFAULT '{}',
  settings    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects (user_id);
DROP TRIGGER IF EXISTS trg_projects_updated ON projects;
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type        entry_type NOT NULL,
  title       text NOT NULL,
  summary     text,
  body        jsonb NOT NULL DEFAULT '{}',
  cover_url   text,
  importance  smallint NOT NULL DEFAULT 0,
  status      entry_status NOT NULL DEFAULT 'draft',
  metadata    jsonb NOT NULL DEFAULT '{}',
  embedding   vector(1536),
  search      tsvector GENERATED ALWAYS AS
                (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(summary,''))) STORED,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_entries_project_type ON entries (project_id, type);
CREATE INDEX IF NOT EXISTS idx_entries_user ON entries (user_id);
CREATE INDEX IF NOT EXISTS idx_entries_metadata ON entries USING gin (metadata);
CREATE INDEX IF NOT EXISTS idx_entries_search ON entries USING gin (search);
CREATE INDEX IF NOT EXISTS idx_entries_embedding ON entries USING hnsw (embedding vector_cosine_ops);
DROP TRIGGER IF EXISTS trg_entries_updated ON entries;
CREATE TRIGGER trg_entries_updated BEFORE UPDATE ON entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── coordenada #1: semântica ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memberships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  container_id uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  member_id    uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  role         text,
  position     int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (container_id, member_id),
  CHECK (container_id <> member_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_container ON memberships (container_id);
CREATE INDEX IF NOT EXISTS idx_memberships_member ON memberships (member_id);
CREATE INDEX IF NOT EXISTS idx_memberships_project ON memberships (project_id);

CREATE TABLE IF NOT EXISTS relationships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_id  uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  target_id  uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  type       text NOT NULL,
  label      text,
  metadata   jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, target_id, type),
  CHECK (source_id <> target_id)
);
CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships (source_id);
CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships (target_id);
CREATE INDEX IF NOT EXISTS idx_rel_project_type ON relationships (project_id, type);

CREATE TABLE IF NOT EXISTS attributes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entry_id   uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  key        text NOT NULL,
  value      text,
  value_num  numeric,
  unit       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, key)
);
CREATE INDEX IF NOT EXISTS idx_attributes_project_key ON attributes (project_id, key);

CREATE TABLE IF NOT EXISTS tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text,
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id   uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);

-- ── coordenada #2: board / canvas ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS boards (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       text NOT NULL DEFAULT 'Main',
  viewport   jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_boards_project ON boards (project_id);
DROP TRIGGER IF EXISTS trg_boards_updated ON boards;
CREATE TRIGGER trg_boards_updated BEFORE UPDATE ON boards
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS board_nodes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  board_id       uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  entry_id       uuid REFERENCES entries(id) ON DELETE CASCADE,
  kind           text NOT NULL DEFAULT 'card',
  x              double precision NOT NULL DEFAULT 0,
  y              double precision NOT NULL DEFAULT 0,
  width          double precision,
  height         double precision,
  z_index        int NOT NULL DEFAULT 0,
  parent_node_id uuid REFERENCES board_nodes(id) ON DELETE SET NULL,
  style          jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_board_nodes_board ON board_nodes (board_id);
CREATE INDEX IF NOT EXISTS idx_board_nodes_entry ON board_nodes (entry_id);
DROP TRIGGER IF EXISTS trg_board_nodes_updated ON board_nodes;
CREATE TRIGGER trg_board_nodes_updated BEFORE UPDATE ON board_nodes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS board_edges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  board_id        uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  source_node_id  uuid NOT NULL REFERENCES board_nodes(id) ON DELETE CASCADE,
  target_node_id  uuid NOT NULL REFERENCES board_nodes(id) ON DELETE CASCADE,
  relationship_id uuid REFERENCES relationships(id) ON DELETE SET NULL,
  label           text,
  style           jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_board_edges_board ON board_edges (board_id);

-- ── coordenada #3: geográfica ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          text NOT NULL,
  image_url     text NOT NULL,
  width         int,
  height        int,
  parent_map_id uuid REFERENCES maps(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_maps_project ON maps (project_id);
DROP TRIGGER IF EXISTS trg_maps_updated ON maps;
CREATE TRIGGER trg_maps_updated BEFORE UPDATE ON maps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS map_pins (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  map_id       uuid NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  entry_id     uuid REFERENCES entries(id) ON DELETE CASCADE,
  x            double precision NOT NULL,
  y            double precision NOT NULL,
  label        text,
  icon         text,
  color        text,
  child_map_id uuid REFERENCES maps(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_map_pins_map ON map_pins (map_id);
CREATE INDEX IF NOT EXISTS idx_map_pins_entry ON map_pins (entry_id);

-- ── timeline / referências / IA ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS timeline_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entry_id     uuid REFERENCES entries(id) ON DELETE SET NULL,
  title        text NOT NULL,
  description  text,
  start_value  bigint NOT NULL,
  start_struct jsonb NOT NULL DEFAULT '{}',
  end_value    bigint,
  end_struct   jsonb,
  importance   smallint NOT NULL DEFAULT 0,
  color        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_timeline_project_start ON timeline_events (project_id, start_value);
DROP TRIGGER IF EXISTS trg_timeline_updated ON timeline_events;
CREATE TRIGGER trg_timeline_updated BEFORE UPDATE ON timeline_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS timeline_event_entries (
  event_id uuid NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  role     text,
  PRIMARY KEY (event_id, entry_id)
);

CREATE TABLE IF NOT EXISTS references_ (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entry_id      uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  kind          text NOT NULL DEFAULT 'link',
  url           text,
  title         text,
  content       text,
  thumbnail_url text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_references_entry ON references_ (entry_id);

CREATE TABLE IF NOT EXISTS ai_checks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entry_id    uuid REFERENCES entries(id) ON DELETE CASCADE,
  kind        ai_kind NOT NULL,
  severity    text NOT NULL DEFAULT 'info',
  title       text NOT NULL,
  detail      text,
  payload     jsonb NOT NULL DEFAULT '{}',
  status      ai_status NOT NULL DEFAULT 'open',
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ai_checks_project_status ON ai_checks (project_id, status);
