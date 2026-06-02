-- Add floor plan image URL to zones so supervisors can upload a floor plan
-- image on the web admin. Inspectors on mobile then access the pre-configured
-- plan instead of having to draw it themselves.
ALTER TABLE zones ADD COLUMN IF NOT EXISTS floor_plan_image_url TEXT;
