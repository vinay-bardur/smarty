-- Migration 007: System settings and helper functions
-- Purpose: Configurable constraints and utility functions

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
)

-- Insert default settings
INSERT INTO system_settings (key, value, description) VALUES
  ('teacher_max_weekly_minutes', '1080', 'Maximum weekly minutes per teacher (18 hours)'),
  ('teacher_min_weekly_minutes', '0', 'Minimum weekly minutes per teacher'),
  ('hod_min_minutes_per_class_per_week', '120', 'Minimum HOD supervision per class per week (2 hours)'),
  ('max_consecutive_hours', '4', 'Maximum consecutive teaching hours per day'),
  ('min_travel_time_minutes', '15', 'Minimum time between classes in different locations'),
  ('auto_suggest_enabled', 'true', 'Enable automatic AI suggestions on absence detection'),
  ('notification_channels', '["email", "realtime", "sms"]', 'Enabled notification channels')
ON CONFLICT (key) DO NOTHING

-- Enable RLS
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY

CREATE POLICY "Authenticated users can view settings" ON system_settings
  FOR SELECT USING (auth.role() = 'authenticated')

CREATE POLICY "Admins can manage settings" ON system_settings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role = 'admin'
    )
  )

-- Helper function to get setting value
CREATE OR REPLACE FUNCTION get_setting(p_key TEXT, p_default JSONB DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  result JSONB
BEGIN
  SELECT value INTO result FROM system_settings WHERE key = p_key
  RETURN COALESCE(result, p_default)
END
$$ LANGUAGE plpgsql STABLE

-- Function to find eligible substitute teachers
CREATE OR REPLACE FUNCTION find_eligible_substitutes(
  p_time_slot_id UUID,
  p_date DATE,
  p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
  teacher_id UUID,
  teacher_name TEXT,
  employee_code TEXT,
  match_score DECIMAL,
  available_minutes INTEGER,
  subjects TEXT[],
  reason TEXT
) AS $$
DECLARE
  slot_record RECORD
  max_minutes INTEGER
BEGIN
  -- Get slot details
  SELECT 
    ts.start_time,
    ts.end_time,
    ts.subject_code,
    ts.classroom_id,
    EXTRACT(EPOCH FROM (ts.end_time - ts.start_time)) / 60 as duration_minutes
  INTO slot_record
  FROM time_slots ts
  WHERE ts.id = p_time_slot_id
  
  max_minutes := (get_setting('teacher_max_weekly_minutes', '1080'::JSONB))::TEXT::INTEGER
  
  RETURN QUERY
  SELECT 
    t.id,
    t.full_name,
    t.employee_code,
    -- Calculate match score
    (
      CASE WHEN slot_record.subject_code = ANY(t.subjects) THEN 0.5 ELSE 0.0 END +
      CASE WHEN tw.assigned_minutes < (max_minutes * 0.5) THEN 0.3 
           WHEN tw.assigned_minutes < (max_minutes * 0.8) THEN 0.2 
           ELSE 0.1 END +
      CASE WHEN is_teacher_available(t.id, p_date, slot_record.start_time, slot_record.end_time) THEN 0.2 ELSE 0.0 END
    )::DECIMAL as match_score,
    (max_minutes - COALESCE(tw.assigned_minutes, 0))::INTEGER as available_minutes,
    t.subjects,
    CASE 
      WHEN slot_record.subject_code = ANY(t.subjects) THEN 'Subject match'
      WHEN array_length(t.subjects, 1) > 3 THEN 'Multi-subject teacher'
      ELSE 'Available capacity'
    END as reason
  FROM teachers t
  LEFT JOIN teacher_workload tw ON t.id = tw.teacher_id 
    AND tw.week_start = get_week_start(p_date)
  WHERE t.status = 'active'
    AND is_teacher_available(t.id, p_date, slot_record.start_time, slot_record.end_time)
    AND (COALESCE(tw.assigned_minutes, 0) + slot_record.duration_minutes) <= max_minutes
  ORDER BY match_score DESC, tw.assigned_minutes ASC NULLS FIRST, t.id
  LIMIT p_limit
END
$$ LANGUAGE plpgsql STABLE

-- Function to check HOD allocation compliance
CREATE OR REPLACE FUNCTION check_hod_allocation_compliance()
RETURNS TABLE (
  classroom_id UUID,
  classroom_name TEXT,
  hod_id UUID,
  hod_name TEXT,
  required_minutes INTEGER,
  assigned_minutes INTEGER,
  deficit_minutes INTEGER
) AS $$
DECLARE
  min_hod_minutes INTEGER
BEGIN
  min_hod_minutes := (get_setting('hod_min_minutes_per_class_per_week', '120'::JSONB))::TEXT::INTEGER
  
  RETURN QUERY
  SELECT 
    c.id,
    c.name,
    c.hod_id,
    t.full_name,
    min_hod_minutes,
    COALESCE(SUM(EXTRACT(EPOCH FROM (ts.end_time - ts.start_time)) / 60), 0)::INTEGER as assigned,
    (min_hod_minutes - COALESCE(SUM(EXTRACT(EPOCH FROM (ts.end_time - ts.start_time)) / 60), 0))::INTEGER as deficit
  FROM classrooms c
  LEFT JOIN teachers t ON c.hod_id = t.id
  LEFT JOIN time_slots ts ON ts.classroom_id = c.id 
    AND ts.teacher_id = c.hod_id
    AND ts.status IN ('scheduled', 'substituted')
  WHERE c.hod_id IS NOT NULL
  GROUP BY c.id, c.name, c.hod_id, t.full_name
  HAVING COALESCE(SUM(EXTRACT(EPOCH FROM (ts.end_time - ts.start_time)) / 60), 0) < min_hod_minutes
END
$$ LANGUAGE plpgsql STABLE
