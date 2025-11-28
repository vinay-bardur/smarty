-- Migration 005: Teacher workload tracking
-- Purpose: Track weekly hours to enforce caps and balance load

CREATE TABLE IF NOT EXISTS teacher_workload (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE NOT NULL,
  week_start DATE NOT NULL,
  assigned_minutes INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(teacher_id, week_start)
)

CREATE INDEX idx_teacher_workload_teacher_week ON teacher_workload(teacher_id, week_start)
CREATE INDEX idx_teacher_workload_week ON teacher_workload(week_start)

-- Enable RLS
ALTER TABLE teacher_workload ENABLE ROW LEVEL SECURITY

CREATE POLICY "Teachers can view own workload" ON teacher_workload
  FOR SELECT USING (auth.uid() = teacher_id)

CREATE POLICY "Admins can view all workload" ON teacher_workload
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('admin', 'hod')
    )
  )

-- Function to get week start (Monday) for any date
CREATE OR REPLACE FUNCTION get_week_start(p_date DATE)
RETURNS DATE AS $$
BEGIN
  RETURN p_date - (EXTRACT(DOW FROM p_date)::INTEGER + 6) % 7
END
$$ LANGUAGE plpgsql IMMUTABLE

-- Function to recompute teacher workload for a specific week
CREATE OR REPLACE FUNCTION recompute_teacher_workload(
  p_teacher_id UUID,
  p_week_start DATE
)
RETURNS INTEGER AS $$
DECLARE
  total_minutes INTEGER
BEGIN
  -- Calculate total minutes from time_slots for the week
  SELECT COALESCE(SUM(
    EXTRACT(EPOCH FROM (end_time - start_time)) / 60
  ), 0)::INTEGER
  INTO total_minutes
  FROM time_slots
  WHERE teacher_id = p_teacher_id
    AND status IN ('scheduled', 'substituted')
    AND timetable_id IN (
      SELECT id FROM timetables 
      WHERE is_active = true 
      AND deleted_at IS NULL
    )
  
  -- Upsert workload record
  INSERT INTO teacher_workload (teacher_id, week_start, assigned_minutes)
  VALUES (p_teacher_id, p_week_start, total_minutes)
  ON CONFLICT (teacher_id, week_start)
  DO UPDATE SET 
    assigned_minutes = total_minutes,
    updated_at = NOW()
  
  RETURN total_minutes
END
$$ LANGUAGE plpgsql

-- Trigger function to update workload when time_slots change
CREATE OR REPLACE FUNCTION trigger_update_teacher_workload()
RETURNS TRIGGER AS $$
DECLARE
  week_start DATE
BEGIN
  week_start := get_week_start(CURRENT_DATE)
  
  -- Update for old teacher if changed
  IF TG_OP = 'UPDATE' AND OLD.teacher_id IS NOT NULL AND OLD.teacher_id != NEW.teacher_id THEN
    PERFORM recompute_teacher_workload(OLD.teacher_id, week_start)
  END IF
  
  -- Update for deleted teacher
  IF TG_OP = 'DELETE' AND OLD.teacher_id IS NOT NULL THEN
    PERFORM recompute_teacher_workload(OLD.teacher_id, week_start)
    RETURN OLD
  END IF
  
  -- Update for new/current teacher
  IF NEW.teacher_id IS NOT NULL THEN
    PERFORM recompute_teacher_workload(NEW.teacher_id, week_start)
  END IF
  
  RETURN NEW
END
$$ LANGUAGE plpgsql

-- Add trigger to time_slots
CREATE TRIGGER update_teacher_workload_on_slot_change
  AFTER INSERT OR UPDATE OR DELETE ON time_slots
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_teacher_workload()

-- Add updated_at trigger
CREATE TRIGGER update_teacher_workload_updated_at BEFORE UPDATE ON teacher_workload
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()

-- View for teacher workload with capacity info
CREATE OR REPLACE VIEW v_teacher_workload_status AS
SELECT 
  tw.teacher_id,
  t.full_name,
  t.employee_code,
  tw.week_start,
  tw.assigned_minutes,
  t.max_weekly_hours * 60 as max_minutes,
  t.min_weekly_hours * 60 as min_minutes,
  ROUND((tw.assigned_minutes::DECIMAL / (t.max_weekly_hours * 60)) * 100, 2) as utilization_percent,
  (t.max_weekly_hours * 60) - tw.assigned_minutes as available_minutes,
  CASE 
    WHEN tw.assigned_minutes > (t.max_weekly_hours * 60) THEN 'overloaded'
    WHEN tw.assigned_minutes < (t.min_weekly_hours * 60) THEN 'underutilized'
    WHEN tw.assigned_minutes >= (t.max_weekly_hours * 60 * 0.9) THEN 'near_capacity'
    ELSE 'normal'
  END as status
FROM teacher_workload tw
JOIN teachers t ON tw.teacher_id = t.id
WHERE t.status = 'active'
