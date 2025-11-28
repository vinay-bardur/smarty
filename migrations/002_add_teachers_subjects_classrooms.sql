-- Migration 002: Add teachers, subjects, and classrooms tables
-- Purpose: Core entities for admin-driven scheduling

-- Update profiles to include teacher/hod roles
ALTER TABLE profiles 
  DROP CONSTRAINT IF EXISTS profiles_role_check,
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('user', 'admin', 'hod', 'teacher'))

-- Create subjects table
CREATE TABLE IF NOT EXISTS subjects (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  weight INTEGER DEFAULT 1,
  default_slot_duration INTEGER DEFAULT 60,
  created_at TIMESTAMPTZ DEFAULT NOW()
)

CREATE INDEX idx_subjects_weight ON subjects(weight DESC)

-- Create teachers table
CREATE TABLE IF NOT EXISTS teachers (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_code TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  subjects TEXT[] DEFAULT '{}',
  max_weekly_hours INTEGER DEFAULT 18,
  min_weekly_hours INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'on_leave', 'resigned', 'suspended')),
  preferences JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)

CREATE INDEX idx_teachers_status ON teachers(status) WHERE status = 'active'
CREATE INDEX idx_teachers_subjects ON teachers USING GIN(subjects)

-- Create classrooms table
CREATE TABLE IF NOT EXISTS classrooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  grade TEXT,
  hod_id UUID REFERENCES teachers(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
)

CREATE INDEX idx_classrooms_hod ON classrooms(hod_id)

-- Enable RLS
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY
ALTER TABLE classrooms ENABLE ROW LEVEL SECURITY

-- RLS Policies for subjects (readable by all authenticated users)
CREATE POLICY "Authenticated users can view subjects" ON subjects
  FOR SELECT USING (auth.role() = 'authenticated')

CREATE POLICY "Admins can manage subjects" ON subjects
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role = 'admin'
    )
  )

-- RLS Policies for teachers
CREATE POLICY "Teachers can view own record" ON teachers
  FOR SELECT USING (auth.uid() = id)

CREATE POLICY "Admins can view all teachers" ON teachers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('admin', 'hod')
    )
  )

CREATE POLICY "Admins can manage teachers" ON teachers
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role = 'admin'
    )
  )

-- RLS Policies for classrooms
CREATE POLICY "Authenticated users can view classrooms" ON classrooms
  FOR SELECT USING (auth.role() = 'authenticated')

CREATE POLICY "Admins and HODs can manage classrooms" ON classrooms
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('admin', 'hod')
    )
  )

-- Add updated_at trigger for teachers
CREATE TRIGGER update_teachers_updated_at BEFORE UPDATE ON teachers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()

-- Insert default subjects (can be customized)
INSERT INTO subjects (code, name, weight, default_slot_duration) VALUES
  ('MATH', 'Mathematics', 5, 60),
  ('ENG', 'English', 5, 60),
  ('SCI', 'Science', 4, 60),
  ('HIST', 'History', 3, 60),
  ('GEO', 'Geography', 3, 60),
  ('PHY', 'Physics', 4, 60),
  ('CHEM', 'Chemistry', 4, 60),
  ('BIO', 'Biology', 4, 60),
  ('CS', 'Computer Science', 3, 60),
  ('ART', 'Art', 2, 60),
  ('PE', 'Physical Education', 2, 60)
ON CONFLICT (code) DO NOTHING
