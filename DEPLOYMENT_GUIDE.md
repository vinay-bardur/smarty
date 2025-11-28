# Smarty Backend - Fast Deployment Guide

## 🚀 2-Day Hackathon Timeline

### Day 1 Morning (2 hours)
**Goal: Get Edge Functions running with auth**

1. **Setup Supabase Project** (15 min)
   ```bash
   # Already done - using existing project
   # URL: https://kkeadoiztzjpehqpbaiv.supabase.co
   ```

2. **Run Database Migration** (10 min)
   - Go to Supabase SQL Editor
   - Copy `migrations/001_initial_schema.sql`
   - Execute
   - Verify tables created

3. **Get Groq API Key** (5 min)
   - Visit https://console.groq.com
   - Sign up (free)
   - Create API key
   - Copy key

4. **Set Edge Function Secrets** (10 min)
   ```bash
   # In Supabase Dashboard → Edge Functions → Secrets
   SUPABASE_URL=https://kkeadoiztzjpehqpbaiv.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=[from Supabase Settings → API]
   GROQ_API_KEY=[from Groq console]
   ```

5. **Deploy Edge Functions** (30 min)
   ```bash
   # Install Supabase CLI
   npm install -g supabase

   # Login
   supabase login

   # Link project
   supabase link --project-ref kkeadoiztzjpehqpbaiv

   # Deploy
   cd smarty-backend
   supabase functions deploy detect-conflicts
   supabase functions deploy generate-suggestions
   supabase functions deploy export-timetable
   ```

6. **Test with Postman** (30 min)
   - Import `postman_collection.json`
   - Get user token from frontend auth
   - Test detect-conflicts endpoint
   - Verify response

### Day 1 Afternoon (3 hours)
**Goal: Integrate with frontend**

1. **Connect Frontend to Edge Functions** (1 hour)
   ```typescript
   // In frontend
   const detectConflicts = async (timetableId: string) => {
     const { data, error } = await supabase.functions.invoke('detect-conflicts', {
       body: { timetableId }
     })
     return data
   }
   ```

2. **Add Conflict Detection UI** (1 hour)
   - Show conflicts in timetable view
   - Display AI reasoning
   - Show confidence scores

3. **Test End-to-End** (1 hour)
   - Create timetable
   - Add overlapping slots
   - Trigger conflict detection
   - Verify conflicts appear
   - Check notifications

### Day 1 Evening (2 hours)
**Goal: Polish core features**

1. **Add Realtime Notifications** (45 min)
   ```typescript
   // Subscribe to notifications
   supabase
     .channel('notifications')
     .on('postgres_changes', 
       { event: 'INSERT', schema: 'public', table: 'notifications' },
       (payload) => showNotification(payload.new)
     )
     .subscribe()
   ```

2. **Improve Error Handling** (30 min)
   - Add loading states
   - Show error messages
   - Add retry logic

3. **Quick UI Polish** (45 min)
   - Add loading spinners
   - Improve conflict display
   - Add success messages

### Day 2 Morning (2 hours)
**Goal: Add AI suggestions and export**

1. **Implement Suggestions Flow** (1 hour)
   - Button to generate suggestions
   - Display suggestions with reasoning
   - Accept/reject buttons

2. **Add Export Feature** (30 min)
   - Export button
   - Format selection (CSV/ICS)
   - Download handling

3. **Test All Features** (30 min)
   - Full user flow
   - Edge cases
   - Error scenarios

### Day 2 Afternoon (3 hours)
**Goal: Final polish and demo prep**

1. **Performance Optimization** (45 min)
   - Add caching where needed
   - Optimize queries
   - Test with large datasets

2. **Demo Preparation** (1 hour)
   - Create demo account
   - Prepare sample timetable
   - Practice demo flow
   - Prepare talking points

3. **Documentation** (45 min)
   - Update README
   - Add screenshots
   - Document known issues

4. **Final Testing** (30 min)
   - Test on different browsers
   - Test mobile view
   - Verify all features work

---

## ⚡ Quick Commands Reference

### Deploy Single Function
```bash
supabase functions deploy detect-conflicts
```

### View Logs
```bash
supabase functions logs detect-conflicts --tail
```

### Test Locally (Optional)
```bash
supabase functions serve detect-conflicts
```

### Rollback Deployment
```bash
# Redeploy previous version
supabase functions deploy detect-conflicts --no-verify-jwt
```

---

## 🎯 Demo Script (60 seconds)

### Setup (Before Demo)
1. Have demo account logged in
2. Sample timetable with 2 conflicts ready
3. Browser window sized properly

### Demo Flow

**[0-15s] Introduction**
> "Smarty is an AI-powered timetable manager that detects conflicts and suggests optimizations."

**[15-35s] Conflict Detection**
1. Show timetable with overlapping classes
2. Click "Detect Conflicts"
3. Point to realtime notification
4. Show conflict details with AI reasoning
> "Notice how AI explains WHY this is a conflict and suggests a fix with 95% confidence"

**[35-50s] AI Suggestions**
1. Click "Generate Optimizations"
2. Show suggestion with reasoning
3. Click "Apply Suggestion"
4. Show updated timetable
> "One-click apply with full audit trail and undo capability"

**[50-60s] Export**
1. Click "Export"
2. Select CSV
3. Show download
> "Export to CSV or ICS for calendar integration"

### Key Talking Points
- ✅ Explainable AI (shows reasoning)
- ✅ Instant feedback (< 3 seconds)
- ✅ One-click apply with rollback
- ✅ Privacy-first (RLS enabled)
- ✅ Production-ready (Supabase + Groq)

---

## 🐛 Common Issues & Fixes

### Issue: Edge Function 500 Error
```bash
# Check logs
supabase functions logs detect-conflicts

# Common causes:
# 1. Missing secrets → Set in dashboard
# 2. Invalid Groq key → Regenerate
# 3. RLS blocking query → Use service role
```

### Issue: Groq API Rate Limit
```bash
# Free tier: 30 req/min
# Solution: Add caching or upgrade plan
# Quick fix: Add delay between requests
```

### Issue: CORS Error
```bash
# Ensure corsHeaders included in response
# Check Edge Function returns proper headers
```

### Issue: Auth Token Invalid
```bash
# Token expires after 1 hour
# Frontend should refresh token automatically
# Check supabase.auth.getSession()
```

---

## 📊 Success Metrics

### Must Have (Day 1)
- ✅ Edge Functions deployed
- ✅ Conflict detection working
- ✅ Frontend integration complete

### Should Have (Day 2 Morning)
- ✅ AI suggestions working
- ✅ Export functionality
- ✅ Realtime notifications

### Nice to Have (Day 2 Afternoon)
- ✅ Performance optimized
- ✅ Error handling polished
- ✅ Demo ready

---

## 🎓 Learning Resources

### Supabase Edge Functions
- https://supabase.com/docs/guides/functions
- https://supabase.com/docs/guides/functions/deploy

### Groq API
- https://console.groq.com/docs/quickstart
- https://console.groq.com/docs/models

### RLS Policies
- https://supabase.com/docs/guides/auth/row-level-security

---

**Ready to ship! 🚀**
