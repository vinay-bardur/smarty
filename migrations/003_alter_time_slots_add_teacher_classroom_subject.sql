-- Migration 003: Extend time_slots for teacher assignment and classroom mapping
-- Purpose: Link slots to teachers, classrooms, and subjects

-- Add new columns to time_slots
ALTER TABLE time_slots
  ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES teachers(id),
  ADD COLUMN IF NOT EXISTS classroom_id UUID REFERENCES classrooms(id),
  ADD COLUMN IF NOT EXISTS subject_code TEXT REFERENCES subjects(code),
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled', 'substituted', 'completed')),
  ADD COLUMN IF NOT EXISTS substitution_request_id UUID,
  ADD COLUMN IF NOT EXISTS original_teacher_id UUID REFERENCES teachers(id)

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_time_slots_teacher ON time_slots(teacher_id)
CREATE INDEX IF NOT EXISTS idx_time_slots_classroom ON time_slots(classroom_id)
CREATE INDEX IF NOT EXISTS idx_time_slots_subject ON time_slots(subject_code)
CREATE INDEX IF NOT EXISTS idx_time_slots_status ON time_slots(status)
CREATE INDEX IF NOT EXISTS idx_time_slots_date_teacher ON time_slots(day_of_week, teacher_id)

-- Update RLS policies to include classroom-based access
DROP POLICY IF EXISTS "Users can view slots of own timetables" ON time_slots
DROP POLICY IF EXISTS "Users can create slots in own timetables" ON time_slots
DROP POLICY IF EXISTS "Users can update slots in own timetables" ON time_slots
DROP POLICY IF EXISTS "Users can delete slots in own timetables" ON time_slots

-- New RLS policies with classroom and teacher access
CREATE POLICY "Users can view slots of own timetables or assigned classes" ON time_slots
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM timetables 
      WHERE timetables.id = time_slots.timetable_id 
      AND timetables.user_id = auth.uid()
    )
    OR auth.uid() = teacher_id
    OR EXISTS (
      SELECT 1 FROM classrooms
      WHERE classrooms.id = time_slots.classroom_id
      AND classrooms.hod_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'hod')
    )
  )

CREATE POLICY "Admins and HODs can manage all slots" ON time_slots
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('admin', 'hod')
    )
  )

CREATE POLICY "Users can manage slots in own timetables" ON time_slots
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM timetables 
      WHERE timetables.id = time_slots.timetable_id 
      AND timetables.user_id = auth.uid()
    )
  )

-- Create function to calculate slot duration in minutes
CREATE OR REPLACE FUNCTION calculate_slot_duration(start_t TIME, end_t TIME)
RETURNS INTEGER AS $$
BEGIN
  RETURN EXTRACT(EPOCH FROM (end_t - start_t)) / 60
END
$$ LANGUAGE plpgsql IMMUTABLE

-- Create view for weekly schedule with teacher info
CREATE OR REPLACE VIEW v_weekly_schedule AS
SELECT 
  ts.id,
  ts.timetable_id,
  ts.day_of_week,
  ts.start_time,
  ts.end_time,
  calculate_slot_duration(ts.start_time, ts.end_time) as duration_minutes,
  ts.title,
  ts.teacher_id,
  t.full_name as teacher_name,
  t.employee_code,
  ts.classroom_id,
  c.name as classroom_name,
  c.grade,
  ts.subject_code,
  s.name as subject_name,
  s.weight as subject_weight,
  ts.status,
  ts.location
FROM time_slots ts
LEFT JOIN teachers t ON ts.teacher_id = t.id
LEFT JOIN classrooms c ON ts.classroom_id = c.id
LEFT JOIN subjects s ON ts.subject_code = s.code
WHERE ts.status != 'cancelled'
