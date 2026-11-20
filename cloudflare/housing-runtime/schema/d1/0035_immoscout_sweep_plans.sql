-- Leaf plan of the ImmoScout24 price-range sweep: one small JSON row per source and property type.
CREATE TABLE IF NOT EXISTS immoscout_sweep_plans (
  source_id INTEGER NOT NULL,
  property_type TEXT NOT NULL,
  leaves TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_id, property_type)
);
