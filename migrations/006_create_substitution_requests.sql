-- Migration 006: Substitution requests and AI suggestions
-- Purpose: Track absence-triggered substitution needs and AI recommendations

CREATE TABLE IF NOT EXISTS substitution_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timetable_id UUID REFERENCES timetables(id) ON DELETE CASCADE NOT NULL,
  time_slot_id UUID REFERENCES time_slots(id) ON DELETE CASCADE NOT NULL,
  original_teacher_id UUID REFERENCES teachers(id),
  suggested_teacher_id UUID REFERENCES teachers(id),
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'suggested', 'applied', 'rejected', 'cancelled')),
  suggestion_payload JSONB DEFAULT '{}',
  applied_by UUID REFERENCES auth.users(id),
  applied_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES auth.users(id),
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)

CREATE INDEX idx_substitution_requests_slot ON substitution_requests(time_slot_id)
CREATE INDEX idx_substitution_requests_status ON substitution_requests(status)
CREATE INDEX idx_substitution_requests_original_teacher ON substitution_requests(original_teacher_id)
CREATE INDEX idx_substitution_requests_suggested_teacher ON substitution_requests(suggested_teacher_id)
CREATE INDEX idx_substitution_requests_timetable ON substitution_requests(timetable_id)

-- Enable RLS
ALTER TABLE substitution_requests ENABLE ROW LEVEL SECURITY

CREATE POLICY "Admins can view all substitution requests" ON substitution_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('admin', 'hod')
    )
  )

CREATE POLICY "Teachers can view requests involving them" ON substitution_requests
  FOR SELECT USING (
    auth.uid() = original_teacher_id 
    OR auth.uid() = suggested_teacher_id
  )

CREATE POLICY "HODs can view requests for their classrooms" ON substitution_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM time_slots ts
      JOIN classrooms c ON ts.classroom_id = c.id
      WHERE ts.id = substitution_requests.time_slot_id
      AND c.hod_id = auth.uid()
    )
  )

CREATE POLICY "Admins can manage substitution requests" ON substitution_requests
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role = 'admin'
    )
  )

-- Add updated_at trigger
CREATE TRIGGER update_substitution_requests_updated_at BEFORE UPDATE ON substitution_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()

-- Create teacher_skill_progress table
CREATE TABLE IF NOT EXISTS teacher_skill_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id UUID REFERENCES classrooms(id) ON DELETE CASCADE NOT NULL,
  subject_code TEXT REFERENCES subjects(code) NOT NULL,
  progress_percent DECIMAL(5,2) DEFAULT 0.00 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(classroom_id, subject_code)
)

CREATE INDEX idx_teacher_skill_progress_classroom ON teacher_skill_progress(classroom_id)
CREATE INDEX idx_teacher_skill_progress_subject ON teacher_skill_progress(subject_code)
CREATE INDEX idx_teacher_skill_progress_low ON teacher_skill_progress(progress_percent) WHERE progress_percent < 75

-- Enable RLS
ALTER TABLE teacher_skill_progress ENABLE ROW LEVEL SECURITY

CREATE POLICY "Authenticated users can view progress" ON teacher_skill_progress
  FOR SELECT USING (auth.role() = 'authenticated')

CREATE POLICY "Admins and HODs can manage progress" ON teacher_skill_progress
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('admin', 'hod')
    )
  )

-- View for substitution request details with context
CREATE OR REPLACE VIEW v_substitution_request_details AS
SELECT 
  sr.id,
  sr.status,
  sr.created_at,
  ts.id as slot_id,
  ts.day_of_week,
  ts.start_time,
  ts.end_time,
  ts.title as class_title,
  c.name as classroom_name,
  c.grade,
  s.name as subject_name,
  s.weight as subject_weight,
  ot.full_name as original_teacher_name,
  ot.employee_code as original_teacher_code,
  st.full_name as suggested_teacher_name,
  st.employee_code as suggested_teacher_code,
  sr.suggestion_payload,
  tsp.progress_percent as subject_progress,
  CASE 
    WHEN tsp.progress_percent < 50 THEN 'critical'
    WHEN tsp.progress_percent < 75 THEN 'high'
    ELSE 'normal'
  END as priority
FROM substitution_requests sr
JOIN time_slots ts ON sr.time_slot_id = ts.id
LEFT JOIN classrooms c ON ts.classroom_id = c.id
LEFT JOIN subjects s ON ts.subject_code = s.code
LEFT JOIN teachers ot ON sr.original_teacher_id = ot.id
LEFT JOIN teachers st ON sr.suggested_teacher_id = st.id
LEFT JOIN teacher_skill_progress tsp ON tsp.classroom_id = c.id AND tsp.subject_code = s.code
WHERE sr.status IN ('open', 'suggested')
