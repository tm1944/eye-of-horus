-- ACLED kind tables. Safe to re-run after sql/001_init.sql.
-- Older databases created mart.event before entities existed.
ALTER TABLE mart.event ADD COLUMN IF NOT EXISTS entities jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS mart.conflict (
  event_id text PRIMARY KEY REFERENCES mart.event (event_id) ON DELETE CASCADE,
  event_type text NOT NULL,
  disorder_type text,
  fatalities integer,
  civilian_targeting text,
  actor1 text,
  assoc_actor_1 text,
  actor2 text,
  assoc_actor_2 text,
  inter1 text,
  inter2 text,
  interaction text,
  time_precision integer,
  geo_precision_code integer,
  location text,
  admin1 text,
  admin2 text,
  admin3 text,
  region text,
  country text,
  iso integer,
  source_name text,
  source_scale text,
  population_best double precision
);

CREATE TABLE IF NOT EXISTS mart.strategic_development (
  event_id text PRIMARY KEY REFERENCES mart.event (event_id) ON DELETE CASCADE,
  event_type text NOT NULL,
  disorder_type text,
  fatalities integer,
  civilian_targeting text,
  actor1 text,
  assoc_actor_1 text,
  actor2 text,
  assoc_actor_2 text,
  inter1 text,
  inter2 text,
  interaction text,
  time_precision integer,
  geo_precision_code integer,
  location text,
  admin1 text,
  admin2 text,
  admin3 text,
  region text,
  country text,
  iso integer,
  source_name text,
  source_scale text,
  population_best double precision
);

CREATE TABLE IF NOT EXISTS mart.protest (
  event_id text PRIMARY KEY REFERENCES mart.event (event_id) ON DELETE CASCADE,
  event_type text NOT NULL,
  disorder_type text,
  fatalities integer,
  civilian_targeting text,
  actor1 text,
  assoc_actor_1 text,
  actor2 text,
  assoc_actor_2 text,
  inter1 text,
  inter2 text,
  interaction text,
  time_precision integer,
  geo_precision_code integer,
  location text,
  admin1 text,
  admin2 text,
  admin3 text,
  region text,
  country text,
  iso integer,
  source_name text,
  source_scale text,
  population_best double precision,
  crowd_size text
);

INSERT INTO mart.event_kind (category, detail_table, label) VALUES
  ('conflict', 'mart.conflict', 'Conflict'),
  ('protest', 'mart.protest', 'Protest'),
  ('strategic_development', 'mart.strategic_development', 'Strategic development')
ON CONFLICT (category) DO UPDATE
  SET detail_table = EXCLUDED.detail_table,
      label = EXCLUDED.label;

CREATE OR REPLACE VIEW mart.v_conflict AS
SELECT e.*, c.event_type, c.disorder_type, c.fatalities, c.civilian_targeting,
       c.actor1, c.actor2, c.interaction, c.location, c.country, c.population_best
FROM mart.event e
JOIN mart.conflict c ON c.event_id = e.event_id
WHERE e.category = 'conflict';

CREATE OR REPLACE VIEW mart.v_protest AS
SELECT e.*, p.event_type, p.disorder_type, p.fatalities, p.civilian_targeting,
       p.actor1, p.actor2, p.crowd_size, p.location, p.country, p.population_best
FROM mart.event e
JOIN mart.protest p ON p.event_id = e.event_id
WHERE e.category = 'protest';

CREATE OR REPLACE VIEW mart.v_strategic_development AS
SELECT e.*, s.event_type, s.disorder_type, s.fatalities, s.civilian_targeting,
       s.actor1, s.actor2, s.interaction, s.location, s.country, s.population_best
FROM mart.event e
JOIN mart.strategic_development s ON s.event_id = e.event_id
WHERE e.category = 'strategic_development';
