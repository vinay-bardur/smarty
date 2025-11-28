-- ========================================
-- Migration 008: Enforce Weekdays and Business Hours
-- Restricts timetable to Monday-Saturday, 09:00-17:00
-- ========================================

-- Add CHECK constraint for allowed weekdays (Monday to Saturday only)
ALTER TABLE time_slots
  DROP CONSTRAINT IF EXISTS check_valid_weekday,
  ADD CONSTRAINT check_valid_weekday 
    CHECK (day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'))

-- Add CHECK constraint for business hours (09:00 to 17:00)
ALTER TABLE time_slots
  DROP CONSTRAINT IF EXISTS check_business_hours,
  ADD CONSTRAINT check_business_hours
    CHECK (
      start_time >= '09:00'::time 
      AND end_time <= '17:00'::time 
      AND start_time < end_time
    )

-- Create audit table for rejected slots
CREATE TABLE IF NOT EXISTS time_slots_audit (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  original_slot_id UUID,
  timetable_id UUID,
  day_of_week TEXT,
  start_time TIME,
  end_time TIME,
  title TEXT,
  rejection_reason TEXT,
  rejected_at TIMESTAMPTZ DEFAULT NOW()
)

-- Create trigger function to log constraint violations
CREATE OR REPLACE FUNCTION log_invalid_time_slot()
RETURNS TRIGGER AS $$
BEGIN
  -- Log to audit table before rejection
  INSERT INTO time_slots_audit (
    original_slot_id, timetable_id, day_of_week, 
    start_time, end_time, title, rejection_reason
  ) VALUES (
    NEW.id, NEW.timetable_id, NEW.day_of_week,
    NEW.start_time, NEW.end_time, NEW.title,
    CASE
      WHEN NEW.day_of_week NOT IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday')
        THEN 'Invalid day: ' || COALESCE(NEW.day_of_week, 'NULL') || ' (only Monday-Saturday allowed)'
      WHEN NEW.start_time < '09:00'::time OR NEW.end_time > '17:00'::time
        THEN 'Invalid time: ' || NEW.start_time || '-' || NEW.end_time || ' (only 09:00-17:00 allowed)'
      ELSE 'Unknown constraint violation'
    END
  )
  
  RETURN NEW
END
$$ LANGUAGE plpgsql

-- Attach trigger (fires before constraint check for logging)
DROP TRIGGER IF EXISTS before_time_slot_insert_or_update ON time_slots
CREATE TRIGGER before_time_slot_insert_or_update
  BEFORE INSERT OR UPDATE ON time_slots
  FOR EACH ROW
  EXECUTE FUNCTION log_invalid_time_slot()

-- Clean up existing invalid data (move to audit, then delete)
INSERT INTO time_slots_audit (
  original_slot_id, timetable_id, day_of_week, 
  start_time, end_time, title, rejection_reason
)
SELECT 
  id, timetable_id, day_of_week, start_time, end_time, title,
  'Migrated: Invalid day or time range'
FROM time_slots
WHERE 
  day_of_week NOT IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday')
  OR start_time < '09:00'::time 
  OR end_time > '17:00'::time

DELETE FROM time_slots
WHERE 
  day_of_week NOT IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday')
  OR start_time < '09:00'::time 
  OR end_time > '17:00'::time

-- Add index for audit queries
CREATE INDEX IF NOT EXISTS idx_time_slots_audit_rejected_at 
  ON time_slots_audit(rejected_at DESC)

-- Grant access to authenticated users
GRANT SELECT ON time_slots_audit TO authenticated

-- ========================================
-- VERIFICATION QUERIES (run after migration)
-- ========================================

-- Check distinct days (should only show Monday-Saturday)
-- SELECT DISTINCT day_of_week FROM time_slots ORDER BY 
--   CASE day_of_week
--     WHEN 'Monday' THEN 1
--     WHEN 'Tuesday' THEN 2
--     WHEN 'Wednesday' THEN 3
--     WHEN 'Thursday' THEN 4
--     WHEN 'Friday' THEN 5
--     WHEN 'Saturday' THEN 6
--   END;

-- Check time ranges (should all be 09:00-17:00)
-- SELECT MIN(start_time) as earliest, MAX(end_time) as latest FROM time_slots;

-- View rejected slots
-- SELECT * FROM time_slots_audit ORDER BY rejected_at DESC LIMIT 10;
