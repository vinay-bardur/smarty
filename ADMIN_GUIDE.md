# Smarty Backend - Admin Guide
## Teacher Availability & Substitution Management

---

## 🎯 Overview

This system provides admin-driven teacher absence detection, AI-powered substitution suggestions, and workload enforcement.

### Key Features
1. **Absence Detection** - Automatically finds affected classes when teacher is absent
2. **AI Substitution** - Groq AI suggests optimal substitutes based on skills, availability, and workload
3. **Workload Enforcement** - Ensures no teacher exceeds 18 hours/week
4. **HOD Supervision** - Guarantees minimum 2 hours/week HOD presence per class
5. **Full Audit Trail** - Every action logged for compliance

---

## 📋 Quick Start

### 1. Report Teacher Absence

**Endpoint:** `POST /functions/v1/detect-absences`

```bash
curl -X POST https://your-project.supabase.co/functions/v1/detect-absences \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "teacherId": "uuid-here",
    "date": "2025-02-01",
    "reason": "Sick leave"
  }'
```

**What Happens:**
- Creates unavailability record
- Finds all affected time slots
- Generates substitution requests
- Provides quick AI suggestions
- Notifies HOD, admins, and affected parties

### 2. Generate AI Reallocation Plan

**Endpoint:** `POST /functions/v1/reallocate-classes?timetableId=UUID&dryRun=true`

```bash
curl -X POST "https://your-project.supabase.co/functions/v1/reallocate-classes?timetableId=UUID&dryRun=true" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Dry Run Mode:**
- Returns suggestions WITHOUT applying
- Safe to test multiple times
- Shows predicted effects

**Apply Mode:** (remove `dryRun=true`)
- Persists suggestions to database
- Updates substitution requests
- Sends notifications

### 3. Apply Substitution

**Manual SQL (via Supabase Dashboard):**

```sql
-- Start transaction
BEGIN

-- Update time slot with new teacher
UPDATE time_slots
SET 
  teacher_id = 'new-teacher-uuid',
  original_teacher_id = 'original-teacher-uuid',
  status = 'substituted'
WHERE id = 'slot-uuid'

-- Mark substitution request as applied
UPDATE substitution_requests
SET 
  status = 'applied',
  applied_by = 'admin-uuid',
  applied_at = NOW()
WHERE id = 'request-uuid'

-- Workload automatically updates via trigger

COMMIT
```

### 4. Check Workload Compliance

**Endpoint:** `POST /functions/v1/enforce-workload`

```bash
curl -X POST https://your-project.supabase.co/functions/v1/enforce-workload \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Returns:**
- Teachers exceeding 18h/week
- Classes missing HOD supervision
- Alerts generated

---

## 🔧 Configuration

### System Settings (via Supabase Dashboard)

```sql
-- View current settings
SELECT * FROM system_settings

-- Update max weekly hours
UPDATE system_settings
SET value = '1200'::JSONB  -- 20 hours
WHERE key = 'teacher_max_weekly_minutes'

-- Update HOD minimum
UPDATE system_settings
SET value = '180'::JSONB  -- 3 hours
WHERE key = 'hod_min_minutes_per_class_per_week'
```

---

## 📊 Reports & Analytics

### Teacher Workload Report

```sql
SELECT 
  teacher_name,
  employee_code,
  assigned_minutes / 60.0 as hours_assigned,
  max_minutes / 60.0 as max_hours,
  utilization_percent,
  status
FROM v_teacher_workload_status
WHERE week_start = '2025-02-03'
ORDER BY utilization_percent DESC
```

### Open Substitution Requests

```sql
SELECT 
  classroom_name,
  subject_name,
  day_of_week,
  start_time,
  original_teacher_name,
  suggested_teacher_name,
  priority,
  status
FROM v_substitution_request_details
WHERE status IN ('open', 'suggested')
ORDER BY priority DESC, created_at ASC
```

### HOD Allocation Compliance

```sql
SELECT * FROM check_hod_allocation_compliance()
```

---

## 🎨 Business Rules

### Substitution Priority (in order)

1. **Subject Match** - Teacher qualified in same subject
2. **Availability** - Teacher available at that time
3. **Workload** - Teacher under weekly cap
4. **Progress** - Prioritize classes with < 75% progress
5. **Proximity** - Same building/location (if data available)

### Tie-Breaker Rules (deterministic)

When multiple teachers have same score:
1. Teacher with **least assigned minutes** this week
2. Teacher with **higher subject match**
3. **Alphabetically** by employee code

### Safety Constraints

- ❌ Never exceed teacher's `max_weekly_hours`
- ❌ Never assign unavailable teacher
- ❌ Never assign more than 4 consecutive hours/day
- ✅ Always respect teacher preferences (unless admin override)
- ✅ Always maintain audit trail

---

## 🚨 Emergency Procedures

### Override AI Suggestion

```sql
-- Manually assign different teacher
UPDATE substitution_requests
SET 
  suggested_teacher_id = 'override-teacher-uuid',
  status = 'suggested',
  suggestion_payload = jsonb_set(
    suggestion_payload,
    '{admin_override}',
    'true'::JSONB
  )
WHERE id = 'request-uuid'
```

### Cancel Substitution Request

```sql
UPDATE substitution_requests
SET 
  status = 'cancelled',
  rejection_reason = 'Class cancelled for the day'
WHERE id = 'request-uuid'

-- Revert slot status
UPDATE time_slots
SET status = 'cancelled'
WHERE id = 'slot-uuid'
```

### Rollback Applied Substitution

```sql
BEGIN

-- Restore original teacher
UPDATE time_slots
SET 
  teacher_id = original_teacher_id,
  status = 'scheduled',
  original_teacher_id = NULL
WHERE id = 'slot-uuid'

-- Mark request as rejected
UPDATE substitution_requests
SET 
  status = 'rejected',
  rejected_by = 'admin-uuid',
  rejected_at = NOW(),
  rejection_reason = 'Rollback - original teacher available'
WHERE id = 'request-uuid'

COMMIT
```

---

## 📱 Notification Flow

### Absence Reported
- ✉️ **Teacher** - Confirmation of absence
- ✉️ **HOD** - Alert with affected classes
- ✉️ **Admins** - Substitution requests created

### Suggestion Generated
- ✉️ **Suggested Teacher** - Request to cover class
- ✉️ **Admins** - Review and approve

### Substitution Applied
- ✉️ **Original Teacher** - Class covered
- ✉️ **New Teacher** - Assignment confirmed
- ✉️ **Students** - Teacher change notice

---

## 🧪 Testing Scenarios

### Scenario 1: Single Absence

```bash
# 1. Report absence
POST /detect-absences
{
  "teacherId": "teacher-1-uuid",
  "date": "2025-02-05",
  "reason": "Medical appointment"
}

# 2. Check suggestions
GET /admin/substitution-requests?status=suggested

# 3. Apply suggestion (via SQL or future endpoint)
```

### Scenario 2: Multiple Overlapping Absences

```bash
# Report multiple absences
POST /detect-absences (Teacher A)
POST /detect-absences (Teacher B)

# Run AI reallocation
POST /reallocate-classes?timetableId=UUID&dryRun=true

# Review plan, then apply
POST /reallocate-classes?timetableId=UUID
```

### Scenario 3: Workload Violation

```bash
# Run enforcement check
POST /enforce-workload

# Review alerts
SELECT * FROM notifications WHERE type = 'workload_violation'

# Manually redistribute load or run reallocation
```

---

## 📈 Performance Tips

1. **Run enforce-workload daily** (via cron)
2. **Use dry-run first** before applying AI suggestions
3. **Monitor Groq API usage** (rate limits)
4. **Index optimization** - Already included in migrations
5. **Cache teacher availability** for current week

---

## 🔐 Security Notes

- All endpoints require authentication
- Admin/HOD role required for management functions
- Service role key NEVER exposed to client
- RLS policies enforce data isolation
- Full audit trail for compliance

---

## 📞 Troubleshooting

### Issue: No suggestions generated

**Check:**
```sql
-- Are there eligible teachers?
SELECT * FROM find_eligible_substitutes('slot-uuid', '2025-02-05', 10)

-- Is Groq API key set?
SELECT current_setting('app.settings.groq_api_key', true)
```

### Issue: Workload not updating

**Fix:**
```sql
-- Manually trigger recompute
SELECT recompute_teacher_workload('teacher-uuid', '2025-02-03')
```

### Issue: HOD deficit not detected

**Check:**
```sql
-- Verify HOD assignment
SELECT * FROM classrooms WHERE hod_id IS NULL

-- Check minimum setting
SELECT * FROM system_settings WHERE key = 'hod_min_minutes_per_class_per_week'
```

---

## 🎯 Best Practices

1. ✅ **Report absences early** - Better substitution options
2. ✅ **Review AI suggestions** - Don't blindly apply
3. ✅ **Monitor workload weekly** - Prevent burnout
4. ✅ **Update teacher skills** - Better matching
5. ✅ **Track subject progress** - Prioritize critical classes
6. ✅ **Use audit logs** - Compliance and debugging

---

**System designed for safety, fairness, and transparency** 🎓
