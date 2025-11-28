import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createServiceClient, getUserFromRequest, corsHeaders } from '../../../src/lib/supabase-server.ts'
import { deterministicTieBreaker, calculatePriority, buildSubstitutionPayload } from '../../../src/lib/scheduling-utils.ts'
import { notifyAbsenceReported, getAdminUserIds } from '../../../src/lib/notifications.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { teacherId, teacher_id, date, startTime, endTime, reason } = body
    const tid = teacherId || teacher_id

    if (!tid || !date) {
      return new Response(
        JSON.stringify({ error: 'teacher_id and date are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let isDemo = !req.headers.get('authorization') && !req.headers.get('Authorization')

    if (isDemo) {
      return new Response(
        JSON.stringify({
          ok: true,
          demo: true,
          message: 'Absence recorded (demo mode)',
          teacher_id: tid,
          date,
          reason: reason || 'Not specified',
          affected_slots: 2,
          substitution_requests: [
            { id: 'demo-sub-1', status: 'suggested', suggested_teacher: 'Teacher A' },
            { id: 'demo-sub-2', status: 'open', suggested_teacher: null }
          ],
          summary: { total_requests: 2, with_suggestions: 1, critical: 0 }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const user = await getUserFromRequest(req)

    const supabase = createServiceClient()

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin' && user.id !== tid) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: availability, error: availError } = await supabase
      .from('teacher_availability')
      .insert({
        teacher_id: tid,
        date,
        start_time: startTime || null,
        end_time: endTime || null,
        type: 'unavailable',
        reason,
        reported_by: user.id,
        source: profile?.role === 'admin' ? 'admin' : 'self'
      })
      .select()
      .single()

    if (availError) throw availError

    const dayOfWeek = new Date(date).toLocaleDateString('en-US', { weekday: 'long' })
    
    let slotsQuery = supabase
      .from('time_slots')
      .select(`
        *,
        classroom:classrooms(id, name, grade, hod_id),
        subject:subjects(code, name, weight),
        timetable:timetables(id, name)
      `)
      .eq('teacher_id', tid)
      .eq('day_of_week', dayOfWeek)
      .in('status', ['scheduled'])

    if (startTime && endTime) {
      slotsQuery = slotsQuery.gte('start_time', startTime).lte('end_time', endTime)
    }

    const { data: affectedSlots, error: slotsError } = await slotsQuery

    if (slotsError) throw slotsError

    if (!affectedSlots || affectedSlots.length === 0) {
      return new Response(
        JSON.stringify({
          message: 'Absence recorded, no affected slots found',
          availability_id: availability.id,
          affected_slots: 0
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const substitutionRequests = []
    const quickSuggestions = []

    for (const slot of affectedSlots) {
      const { data: candidates } = await supabase
        .rpc('find_eligible_substitutes', {
          p_time_slot_id: slot.id,
          p_date: date,
          p_limit: 5
        })

      const sortedCandidates = deterministicTieBreaker(candidates || [])
      const topCandidate = sortedCandidates[0]

      const context = {
        slot_id: slot.id,
        day_of_week: slot.day_of_week,
        start_time: slot.start_time,
        end_time: slot.end_time,
        subject_code: slot.subject_code,
        classroom_id: slot.classroom?.id,
        classroom_name: slot.classroom?.name,
        original_teacher_id: tid,
        duration_minutes: (new Date(`1970-01-01T${slot.end_time}`) - new Date(`1970-01-01T${slot.start_time}`)) / 60000,
        subject_weight: slot.subject?.weight || 1,
        progress_percent: 50
      }

      const priority = calculatePriority(context)
      const suggestionPayload = topCandidate 
        ? buildSubstitutionPayload(topCandidate, context, priority)
        : null

      const { data: subRequest, error: subError } = await supabase
        .from('substitution_requests')
        .insert({
          timetable_id: slot.timetable_id,
          time_slot_id: slot.id,
          original_teacher_id: tid,
          suggested_teacher_id: topCandidate?.teacher_id || null,
          status: topCandidate ? 'suggested' : 'open',
          suggestion_payload: suggestionPayload
        })
        .select()
        .single()

      if (!subError && subRequest) {
        substitutionRequests.push(subRequest)
        
        if (topCandidate) {
          quickSuggestions.push({
            substitution_request_id: subRequest.id,
            slot: slot,
            suggested_teacher: topCandidate,
            priority
          })
        }
      }

      await supabase
        .from('time_slots')
        .update({
          status: 'cancelled',
          substitution_request_id: subRequest?.id
        })
        .eq('id', slot.id)
    }

    const adminIds = await getAdminUserIds()
    const hodId = affectedSlots[0]?.classroom?.hod_id
    
    await notifyAbsenceReported(tid, hodId, adminIds, affectedSlots.length, date)

    await supabase
      .from('audit_logs')
      .insert({
        user_id: user.id,
        action: 'absence_reported',
        resource_type: 'teacher_availability',
        resource_id: availability.id,
        metadata: {
          teacher_id: tid,
          date,
          affected_slots: affectedSlots.length,
          substitution_requests: substitutionRequests.length
        }
      })

    return new Response(
      JSON.stringify({
        message: 'Absence detected and substitution requests created',
        availability_id: availability.id,
        affected_slots: affectedSlots.length,
        substitution_requests: substitutionRequests,
        quick_suggestions: quickSuggestions,
        summary: {
          total_requests: substitutionRequests.length,
          with_suggestions: quickSuggestions.length,
          critical: quickSuggestions.filter(s => s.priority === 'critical').length
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in detect-absences:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
