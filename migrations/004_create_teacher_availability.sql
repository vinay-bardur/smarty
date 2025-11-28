-- Migration 004: Teacher availability and absence tracking
-- Purpose: Track when teachers are available/unavailable

CREATE TABLE IF NOT EXISTS teacher_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  type TEXT CHECK (type IN ('available', 'unavailable', 'partial')) DEFAULT 'available',
  reason TEXT,
  reported_by UUID REFERENCES auth.users(id),
  source TEXT DEFAULT 'self' CHECK (source IN ('self', 'admin', 'auto')),
  created_at TIMESTAMPTZ DEFAULT NOW()
)

-- Indexes for fast lookups
CREATE INDEX idx_teacher_availability_teacher_date ON teacher_availability(teacher_id, date)
CREATE INDEX idx_teacher_availability_type ON teacher_availability(type) WHERE type = 'unavailable'
CREATE INDEX idx_teacher_availability_date_range ON teacher_availability(date, start_time, end_time)

-- Enable RLS
ALTER TABLE teacher_availability ENABLE ROW LEVEL SECURITY

-- RLS Policies
CREATE POLICY "Teachers can view own availability" ON teacher_availability
  FOR SELECT USING (auth.uid() = teacher_id)

CREATE POLICY "Teachers can insert own availability" ON teacher_availability
  FOR INSERT WITH CHECK (
    auth.uid() = teacher_id 
    AND source = 'self'
  )

CREATE POLICY "Admins can view all availability" ON teacher_availability
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('admin', 'hod')
    )
  )

CREATE POLICY "Admins can manage all availability" ON teacher_availability
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role = 'admin'
    )
  )

-- Function to check if teacher is available at specific time
CREATE OR REPLACE FUNCTION is_teacher_available(
  p_teacher_id UUID,
  p_date DATE,
  p_start_time TIME,
  p_end_time TIME
)
RETURNS BOOLEAN AS $$
DECLARE
  unavailable_count INTEGER
BEGIN
  -- Check for any unavailability records that overlap
  SELECT COUNT(*) INTO unavailable_count
  FROM teacher_availability
  WHERE teacher_id = p_teacher_id
    AND date = p_date
    AND type = 'unavailable'
    AND (
      -- Whole day unavailable (no specific times)
      (start_time IS NULL AND end_time IS NULL)
      OR
      -- Specific time range overlaps
      (start_time < p_end_time AND end_time > p_start_time)
    )
  
  RETURN unavailable_count = 0
END
$$ LANGUAGE plpgsql STABLE

-- View for daily teacher availability summary
CREATE OR REPLACE VIEW v_daily_teacher_availability AS
SELECT 
  t.id as teacher_id,
  t.full_name,
  t.employee_code,
  ta.date,
  ta.type,
  ta.start_time,
  ta.end_time,
  ta.reason,
  ta.source,
  COUNT(ts.id) as affected_slots_count
FROM teachers t
LEFT JOIN teacher_availability ta ON t.id = ta.teacher_id
LEFT JOIN time_slots ts ON ts.teacher_id = t.id 
  AND ts.day_of_week = TO_CHAR(ta.date, 'Day')
  AND ts.start_time >= COALESCE(ta.start_time, '00:00'::TIME)
  AND ts.end_time <= COALESCE(ta.end_time, '23:59'::TIME)
WHERE ta.type = 'unavailable' OR ta.type IS NULL
GROUP BY t.id, t.full_name, t.employee_code, ta.date, ta.type, ta.start_time, ta.end_time, ta.reason, ta.source
