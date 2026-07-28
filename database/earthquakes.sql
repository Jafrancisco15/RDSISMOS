-- Optional PostgreSQL/PostGIS schema for durable historical storage.
-- The current Vercel deployment has no database configured; apply this migration
-- after provisioning PostgreSQL and set DATABASE_URL in the runtime.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS earthquake_events (
  id BIGSERIAL PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  source_catalog TEXT NOT NULL,
  time_utc TIMESTAMPTZ NOT NULL,
  updated_utc TIMESTAMPTZ NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  depth_km DOUBLE PRECISION NOT NULL,
  magnitude DOUBLE PRECISION NOT NULL,
  magnitude_type TEXT,
  place TEXT,
  country_or_region TEXT,
  event_type TEXT,
  status TEXT,
  network TEXT,
  location_source TEXT,
  magnitude_source TEXT,
  station_count INTEGER,
  gap DOUBLE PRECISION,
  dmin DOUBLE PRECISION,
  rms DOUBLE PRECISION,
  horizontal_error DOUBLE PRECISION,
  depth_error DOUBLE PRECISION,
  magnitude_error DOUBLE PRECISION,
  magnitude_station_count INTEGER,
  source_url TEXT,
  raw_payload JSONB,
  geom GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS earthquake_events_time_idx ON earthquake_events (time_utc DESC);
CREATE INDEX IF NOT EXISTS earthquake_events_magnitude_idx ON earthquake_events (magnitude DESC);
CREATE INDEX IF NOT EXISTS earthquake_events_depth_idx ON earthquake_events (depth_km);
CREATE INDEX IF NOT EXISTS earthquake_events_source_idx ON earthquake_events (source_catalog);
CREATE INDEX IF NOT EXISTS earthquake_events_geom_idx ON earthquake_events USING GIST (geom);

CREATE TABLE IF NOT EXISTS earthquake_sync_jobs (
  id UUID PRIMARY KEY,
  state TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  current_start TIMESTAMPTZ,
  current_end TIMESTAMPTZ,
  processed BIGINT NOT NULL DEFAULT 0,
  inserted BIGINT NOT NULL DEFAULT 0,
  updated BIGINT NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  stopped BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
