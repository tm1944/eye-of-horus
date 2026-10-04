-- Hypothesis Globe schema for TigerData (Postgres + Timescale).
-- Safe to re-run. Apply with: psql "$DATABASE_URL" -f sql/001_init.sql

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS mart;

CREATE TABLE IF NOT EXISTS raw.ingest_batch (
  batch_id text PRIMARY KEY,
  source text NOT NULL,
  pulled_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS mart.event (
  event_id text PRIMARY KEY,
  source text NOT NULL,
  source_event_id text NOT NULL,
  category text NOT NULL,
  subtype text,
  title text NOT NULL,
  summary text,
  info_url text,
  occurred_at timestamptz NOT NULL,
  updated_at timestamptz,
  ended_at timestamptz,
  lng double precision NOT NULL,
  lat double precision NOT NULL,
  alt_m double precision,
  geo_precision text NOT NULL,
  geo_source text NOT NULL,
  significance double precision NOT NULL,
  weight double precision,
  country_iso3 text,
  entities jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_ref text,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_event_id)
);

CREATE INDEX IF NOT EXISTS event_occurred_category
  ON mart.event (occurred_at DESC, category);

CREATE TABLE IF NOT EXISTS mart.event_tag (
  event_id text NOT NULL REFERENCES mart.event (event_id) ON DELETE CASCADE,
  tag text NOT NULL,
  tag_kind text NOT NULL,
  PRIMARY KEY (event_id, tag)
);

CREATE INDEX IF NOT EXISTS event_tag_tag ON mart.event_tag (tag);

CREATE TABLE IF NOT EXISTS mart.event_kind (
  category text PRIMARY KEY,
  detail_table text NOT NULL,
  label text NOT NULL
);

CREATE TABLE IF NOT EXISTS mart.event_link (
  link_id text PRIMARY KEY,
  source_id text NOT NULL,
  target_id text NOT NULL,
  relation text NOT NULL,
  confidence double precision NOT NULL,
  rationale text,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text
);

CREATE TABLE IF NOT EXISTS mart.earthquake (
  event_id text PRIMARY KEY REFERENCES mart.event (event_id) ON DELETE CASCADE,
  magnitude double precision,
  mag_type text,
  depth_km double precision,
  tsunami boolean,
  felt integer,
  cdi double precision,
  mmi double precision,
  sig integer,
  alert text,
  status text,
  place text,
  gdacs_event_id bigint,
  episode_id bigint,
  alert_level text,
  alert_score double precision,
  population bigint,
  glide text,
  footprint geography(Geometry, 4326)
);

CREATE TABLE IF NOT EXISTS mart.wildfire (
  event_id text PRIMARY KEY REFERENCES mart.event (event_id) ON DELETE CASCADE,
  hotspot_count integer,
  max_frp double precision,
  mean_frp double precision,
  satellite text,
  confidence text,
  daynight text,
  burned_area_ha double precision,
  gdacs_event_id bigint,
  episode_id bigint,
  alert_level text,
  alert_score double precision,
  population bigint,
  glide text,
  footprint geography(Geometry, 4326)
);

CREATE TABLE IF NOT EXISTS mart.wildfire_hotspot (
  hotspot_id text NOT NULL,
  event_id text,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  acq_at timestamptz NOT NULL,
  satellite text,
  confidence text,
  frp double precision,
  brightness double precision,
  daynight text,
  raw_ref text,
  PRIMARY KEY (hotspot_id, acq_at)
);

SELECT create_hypertable(
  'mart.wildfire_hotspot',
  'acq_at',
  if_not_exists => TRUE
);

CREATE TABLE IF NOT EXISTS mart.cyclone (
  event_id text PRIMARY KEY REFERENCES mart.event (event_id) ON DELETE CASCADE,
  gdacs_event_id bigint NOT NULL,
  episode_id bigint,
  storm_name text,
  max_wind_kmh double precision,
  storm_class text,
  pop_39kt bigint,
  pop_74kt bigint,
  pop_storm_surge bigint,
  alert_level text,
  alert_score double precision,
  population bigint,
  country text,
  iso3 text,
  glide text,
  from_date timestamptz,
  to_date timestamptz,
  footprint geography(Geometry, 4326)
);

CREATE TABLE IF NOT EXISTS mart.flood (
  event_id text PRIMARY KEY REFERENCES mart.event (event_id) ON DELETE CASCADE,
  gdacs_event_id bigint NOT NULL,
  episode_id bigint,
  flood_severity_score double precision,
  severity_text text,
  alert_level text,
  alert_score double precision,
  population bigint,
  country text,
  iso3 text,
  glide text,
  from_date timestamptz,
  to_date timestamptz,
  footprint geography(Geometry, 4326)
);

CREATE TABLE IF NOT EXISTS mart.drought (
  event_id text PRIMARY KEY REFERENCES mart.event (event_id) ON DELETE CASCADE,
  gdacs_event_id bigint NOT NULL,
  episode_id bigint,
  affected_area_km2 double precision,
  drought_index double precision,
  alert_level text,
  alert_score double precision,
  population bigint,
  country text,
  iso3 text,
  glide text,
  from_date timestamptz,
  to_date timestamptz,
  footprint geography(Geometry, 4326)
);

CREATE TABLE IF NOT EXISTS mart.volcano (
  event_id text PRIMARY KEY REFERENCES mart.event (event_id) ON DELETE CASCADE,
  gdacs_event_id bigint NOT NULL,
  episode_id bigint,
  volcano_name text,
  vei double precision,
  severity_text text,
  alert_level text,
  alert_score double precision,
  population bigint,
  country text,
  iso3 text,
  glide text,
  from_date timestamptz,
  to_date timestamptz,
  footprint geography(Geometry, 4326)
);

INSERT INTO mart.event_kind (category, detail_table, label) VALUES
  ('earthquake', 'mart.earthquake', 'Earthquake'),
  ('wildfire', 'mart.wildfire', 'Wildfire'),
  ('cyclone', 'mart.cyclone', 'Cyclone'),
  ('flood', 'mart.flood', 'Flood'),
  ('volcano', 'mart.volcano', 'Volcano'),
  ('drought', 'mart.drought', 'Drought')
ON CONFLICT (category) DO UPDATE
  SET detail_table = EXCLUDED.detail_table,
      label = EXCLUDED.label;

CREATE OR REPLACE VIEW mart.v_earthquake AS
SELECT e.*, q.magnitude, q.mag_type, q.depth_km, q.tsunami, q.felt, q.cdi, q.mmi,
       q.sig, q.alert, q.status, q.place, q.alert_level, q.alert_score, q.population
FROM mart.event e
JOIN mart.earthquake q ON q.event_id = e.event_id
WHERE e.category = 'earthquake';

CREATE OR REPLACE VIEW mart.v_wildfire AS
SELECT e.*, w.hotspot_count, w.max_frp, w.mean_frp, w.satellite, w.confidence,
       w.daynight, w.burned_area_ha, w.alert_level, w.alert_score, w.population
FROM mart.event e
JOIN mart.wildfire w ON w.event_id = e.event_id
WHERE e.category = 'wildfire';

CREATE OR REPLACE VIEW mart.v_cyclone AS
SELECT e.*, c.storm_name, c.max_wind_kmh, c.storm_class, c.pop_39kt, c.pop_74kt,
       c.pop_storm_surge, c.alert_level, c.alert_score, c.population, c.country, c.iso3
FROM mart.event e
JOIN mart.cyclone c ON c.event_id = e.event_id
WHERE e.category = 'cyclone';

CREATE OR REPLACE VIEW mart.v_flood AS
SELECT e.*, f.flood_severity_score, f.severity_text, f.alert_level, f.alert_score,
       f.population, f.country, f.iso3
FROM mart.event e
JOIN mart.flood f ON f.event_id = e.event_id
WHERE e.category = 'flood';

CREATE OR REPLACE VIEW mart.v_volcano AS
SELECT e.*, v.volcano_name, v.vei, v.severity_text, v.alert_level, v.alert_score,
       v.population, v.country, v.iso3
FROM mart.event e
JOIN mart.volcano v ON v.event_id = e.event_id
WHERE e.category = 'volcano';

CREATE OR REPLACE VIEW mart.v_drought AS
SELECT e.*, d.affected_area_km2, d.drought_index, d.alert_level, d.alert_score,
       d.population, d.country, d.iso3
FROM mart.event e
JOIN mart.drought d ON d.event_id = e.event_id
WHERE e.category = 'drought';
