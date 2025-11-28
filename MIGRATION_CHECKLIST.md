# Migration & Deployment Checklist

## 📋 Pre-Migration

- [ ] Backup current database
- [ ] Document current timetable structure
- [ ] Export existing teacher/class data
- [ ] Verify Supabase project access
- [ ] Get Groq API key (https://console.groq.com)

---

## 🗄️ Database Migrations (Run in Order)

### Step 1: Core Tables
```bash
# In Supabase SQL Editor
# Run: migrations/002_add_teachers_subjects_classrooms.sql
```
**Creates:** teachers, subjects, classrooms tables

**Verify:**
```sql
SELECT COUNT(*) FROM teachers
SELECT COUNT(*) FROM subjects
SELECT COUNT(*) FROM classrooms
```

### Step 2: Time Slots Extension
```bash
# Run: migrations/003_alter_time_slots_add_teacher_classroom_subject.sql
```
**Adds:** teacher_id, classroom_id, subject_code to time_slots

**Verify:**
```sql
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'time_slots'
```

### Step 3: Availability Tracking
```bash
# Run: migrations/004_create_teacher_availability.sql
```
**Creates:** teacher_availability table + helper functions

**Verify:**
```sql
SELECT * FROM teacher_availability LIMIT 1
SELECT is_teacher_available('uuid', '2025-02-01', '09:00', '10:00')
```

### Step 4: Workload Management
```bash
# Run: migrations/005_create_teacher_workload.sql
```
**Creates:** teacher_workload table + auto-update triggers

**Verify:**
```sql
SELECT * FROM v_teacher_workload_status LIMIT 5
```

### Step 5: Substitution System
```bash
# Run: migrations/006_create_substitution_requests.sql
```
**Creates:** substitution_requests, teacher_skill_progress tables

**Verify:**
```sql
SELECT * FROM v_substitution_request_details LIMIT 1
```

### Step 6: Settings & Helpers
```bash
# Run: migrations/007_create_settings_and_helpers.sql
```
**Creates:** system_settings, helper functions

**Verify:**
```sql
SELECT * FROM system_settings
SELECT * FROM find_eligible_substitutes('slot-uuid', '2025-02-01', 5)
```

---

## 👥 Data Migration

### Migrate Teachers
```sql
-- Create teacher records from existing profiles
INSERT INTO teachers (id, employee_code, full_name, email, subjects, max_weekly_hours)
SELECT 
  id,
  'EMP' || LPAD(ROW_NUMBER() OVER (ORDER BY created_at)::TEXT, 4, '0'),
  full_name,
  email,
  ARRAY['MATH', 'SCI']::TEXT[],  -- Update per teacher
  18
FROM profiles
WHERE role = 'teacher'
ON CONFLICT (id) DO NOTHING
```

### Create Classrooms
```sql
-- Example: Create classrooms
INSERT INTO classrooms (name, grade, hod_id) VALUES
  ('Class 10A', '10', 'hod-teacher-uuid'),
  ('Class 10B', '10', 'hod-teacher-uuid'),
  ('Class 9A', '9', 'hod-teacher-uuid')
ON CONFLICT (name) DO NOTHING
```

### Link Time Slots
```sql
-- Update existing time_slots with teacher/classroom/subject
-- This requires manual mapping or admin UI

UPDATE time_slots
SET 
  teacher_id = 'teacher-uuid',
  classroom_id = 'classroom-uuid',
  subject_code = 'MATH'
WHERE title LIKE '%Math%'
```

### Initialize Workload
```sql
-- Compute initial workload for all teachers
DO $$
DECLARE
  teacher_rec RECORD
BEGIN
  FOR teacher_rec IN SELECT id FROM teachers WHERE status = 'active'
  LOOP
    PERFORM recompute_teacher_workload(
      teacher_rec.id,
      get_week_start(CURRENT_DATE)
    )
  END LOOP
END $$
```

---

## 🚀 Edge Functions Deployment

### Set Secrets (Supabase Dashboard)
```bash
# Go to: Edge Functions → Secrets

SUPABASE_URL=https://kkeadoiztzjpehqpbaiv.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
GROQ_API_KEY=your_groq_api_key
```

### Deploy Functions
```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link project
supabase link --project-ref kkeadoiztzjpehqpbaiv

# Deploy all functions
cd smarty-backend
supabase functions deploy detect-absences
supabase functions deploy reallocate-classes
supabase functions deploy enforce-workload
```

### Verify Deployment
```bash
# Check logs
supabase functions logs detect-absences --tail

# Test endpoint
curl -X POST https://kkeadoiztzjpehqpbaiv.supabase.co/functions/v1/detect-absences \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"teacherId": "uuid", "date": "2025-02-01"}'
```

---

## ✅ Post-Migration Validation

### 1. Test Absence Detection
```bash
# Report test absence
POST /detect-absences
{
  "teacherId": "test-teacher-uuid",
  "date": "2025-02-10",
  "reason": "Test"
}

# Verify substitution requests created
SELECT * FROM substitution_requests WHERE original_teacher_id = 'test-teacher-uuid'
```

### 2. Test AI Reallocation
```bash
# Dry run
POST /reallocate-classes?timetableId=UUID&dryRun=true

# Check response has suggestions
```

### 3. Test Workload Enforcement
```bash
POST /enforce-workload

# Check alerts generated
SELECT * FROM notifications WHERE type IN ('workload_violation', 'hod_deficit')
```

### 4. Verify Triggers
```sql
-- Insert test slot
INSERT INTO time_slots (timetable_id, teacher_id, day_of_week, start_time, end_time, title)
VALUES ('timetable-uuid', 'teacher-uuid', 'Monday', '09:00', '10:00', 'Test')

-- Check workload updated
SELECT * FROM teacher_workload WHERE teacher_id = 'teacher-uuid'
```

### 5. Check RLS Policies
```sql
-- As teacher user
SELECT * FROM teacher_availability WHERE teacher_id = auth.uid()  -- Should work

-- As teacher user
SELECT * FROM teacher_availability WHERE teacher_id != auth.uid()  -- Should fail
```

---

## 🔄 Rollback Plan

### If Issues Occur

1. **Stop Edge Functions**
```bash
# Disable in Supabase Dashboard
```

2. **Restore Database**
```sql
-- Restore from backup
-- Or drop new tables
DROP TABLE IF EXISTS substitution_requests CASCADE
DROP TABLE IF EXISTS teacher_skill_progress CASCADE
DROP TABLE IF EXISTS teacher_workload CASCADE
DROP TABLE IF EXISTS teacher_availability CASCADE
DROP TABLE IF EXISTS classrooms CASCADE
DROP TABLE IF EXISTS teachers CASCADE
DROP TABLE IF EXISTS subjects CASCADE
```

3. **Revert time_slots**
```sql
ALTER TABLE time_slots
  DROP COLUMN IF EXISTS teacher_id,
  DROP COLUMN IF EXISTS classroom_id,
  DROP COLUMN IF EXISTS subject_code,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS substitution_request_id,
  DROP COLUMN IF EXISTS original_teacher_id
```

---

## 📊 Success Metrics

After migration, verify:

- [ ] All teachers have records in `teachers` table
- [ ] All classrooms created with HOD assignments
- [ ] Time slots linked to teachers/classrooms/subjects
- [ ] Workload computed for current week
- [ ] Edge Functions responding (200 OK)
- [ ] Notifications being created
- [ ] Audit logs recording actions
- [ ] RLS policies enforcing access control

---

## 🎯 Timeline Estimate

| Phase | Duration | Notes |
|-------|----------|-------|
| Pre-migration prep | 1 hour | Backup, document |
| Run migrations | 30 min | Execute SQL files |
| Data migration | 2 hours | Map teachers/classes |
| Deploy Edge Functions | 30 min | Set secrets, deploy |
| Testing | 1 hour | Validate all features |
| **Total** | **5 hours** | Can be done in stages |

---

## 🆘 Support

### Common Issues

**Issue:** Migration fails on foreign key
**Fix:** Ensure parent tables created first, check UUIDs exist

**Issue:** Edge Function 500 error
**Fix:** Check secrets set, view logs with `supabase functions logs`

**Issue:** RLS blocking queries
**Fix:** Use service role in Edge Functions, verify policies

**Issue:** Groq API timeout
**Fix:** Check API key, verify rate limits, reduce context size

---

## 📝 Final Steps

- [ ] Update frontend to call new endpoints
- [ ] Train admins on new workflows
- [ ] Document custom configurations
- [ ] Set up monitoring/alerts
- [ ] Schedule weekly `enforce-workload` cron
- [ ] Archive old system (if applicable)

---

**Migration complete! System ready for production** ✅
