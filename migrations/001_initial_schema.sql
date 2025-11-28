-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT,
  avatar_url TEXT,
  email TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Create timetables table
CREATE TABLE IF NOT EXISTS timetables (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  academic_year TEXT,
  semester TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_timetables_user_id ON timetables(user_id);
CREATE INDEX idx_timetables_active ON timetables(is_active) WHERE deleted_at IS NULL;

ALTER TABLE timetables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own timetables" ON timetables
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own timetables" ON timetables
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own timetables" ON timetables
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own timetables" ON timetables
  FOR DELETE USING (auth.uid() = user_id);

-- Create time_slots table
CREATE TABLE IF NOT EXISTS time_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  timetable_id UUID REFERENCES timetables(id) ON DELETE CASCADE NOT NULL,
  day_of_week TEXT NOT NULL CHECK (day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  instructor TEXT,
  color TEXT DEFAULT '#3B82F6',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT valid_time_range CHECK (end_time > start_time)
);

CREATE INDEX idx_time_slots_timetable ON time_slots(timetable_id);
CREATE INDEX idx_time_slots_day_time ON time_slots(day_of_week, start_time);

ALTER TABLE time_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view slots of own timetables" ON time_slots
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM timetables 
      WHERE timetables.id = time_slots.timetable_id 
      AND timetables.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create slots in own timetables" ON time_slots
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM timetables 
      WHERE timetables.id = time_slots.timetable_id 
      AND timetables.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update slots in own timetables" ON time_slots
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM timetables 
      WHERE timetables.id = time_slots.timetable_id 
      AND timetables.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete slots in own timetables" ON time_slots
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM timetables 
      WHERE timetables.id = time_slots.timetable_id 
      AND timetables.user_id = auth.uid()
    )
  );

-- Create conflicts table
CREATE TABLE IF NOT EXISTS conflicts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  timetable_id UUID REFERENCES timetables(id) ON DELETE CASCADE NOT NULL,
  conflict_type TEXT NOT NULL CHECK (conflict_type IN ('time_overlap', 'location_conflict', 'instructor_conflict', 'travel_time')),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  slot1_id UUID REFERENCES time_slots(id) ON DELETE CASCADE NOT NULL,
  slot2_id UUID REFERENCES time_slots(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  detected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conflicts_timetable ON conflicts(timetable_id);
CREATE INDEX idx_conflicts_unresolved ON conflicts(resolved) WHERE resolved = false;

ALTER TABLE conflicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view conflicts of own timetables" ON conflicts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM timetables 
      WHERE timetables.id = conflicts.timetable_id 
      AND timetables.user_id = auth.uid()
    )
  );

-- Create ai_suggestions table
CREATE TABLE IF NOT EXISTS ai_suggestions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  timetable_id UUID REFERENCES timetables(id) ON DELETE CASCADE NOT NULL,
  suggestion_type TEXT NOT NULL,
  suggestion_text TEXT NOT NULL,
  reasoning TEXT,
  confidence_score DECIMAL(3,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'applied')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  applied_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ
);

CREATE INDEX idx_ai_suggestions_timetable ON ai_suggestions(timetable_id);
CREATE INDEX idx_ai_suggestions_status ON ai_suggestions(status);

ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view suggestions for own timetables" ON ai_suggestions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM timetables 
      WHERE timetables.id = ai_suggestions.timetable_id 
      AND timetables.user_id = auth.uid()
    )
  );

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, read) WHERE read = false;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications" ON notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications" ON notifications
  FOR UPDATE USING (auth.uid() = user_id);

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  metadata JSONB DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all audit logs" ON audit_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role = 'admin'
    )
  );

-- Create function to handle new user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, email)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.email
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for new user
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for updated_at
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_timetables_updated_at BEFORE UPDATE ON timetables
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_time_slots_updated_at BEFORE UPDATE ON time_slots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create storage bucket for exports
INSERT INTO storage.buckets (id, name, public) 
VALUES ('exports', 'exports', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Users can upload own exports" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'exports' AND 
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can view own exports" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'exports' AND 
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete own exports" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'exports' AND 
    auth.uid()::text = (storage.foldername(name))[1]
  );
