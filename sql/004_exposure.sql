-- Satellite-derived population exposure for natural hazards.
-- Safe to re-run. Apply with: python -m jobs.ingest.apply_schema

CREATE TABLE IF NOT EXISTS mart.hazard_exposure (
  event_id text PRIMARY KEY REFERENCES mart.event (event_id) ON DELETE CASCADE,
  people_exposed bigint NOT NULL,
  radius_km double precision NOT NULL,
  intensity double precision NOT NULL,
  impact_score double precision NOT NULL,
  impact_class text NOT NULL,
  exposure_source text NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
