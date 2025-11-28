import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createServiceClient, getUserFromRequest, corsHeaders } from '../../../src/lib/supabase-server.ts'
import { detectConflicts } from '../../../src/lib/groq.ts'
import { quickOverlapCheck, checkLocationConflicts, checkInstructorConflicts, checkTravelTimeIssues } from '../../../src/lib/conflict-utils.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { timetableId, sample, time_slots } = body

    if (!timetableId) {
      return new Response(
        JSON.stringify({ error: 'timetableId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let timeSlots = time_slots
    let user = null
    let isDemo = !req.headers.get('authorization') && !req.headers.get('Authorization')

    // Demo mode: return sample conflicts
    if (isDemo && sample) {
      return new Response(
        JSON.stringify({
          ok: true,
          demo: true,
          conflicts: [
            {
              id: 'demo-1',
              timetable_id: timetableId,
              conflict_type: 'time_overlap',
              severity: 'high',
              slot1_id: 's1',
              slot2_id: 's2',
              description: 'Teacher has overlapping classes on Monday 09:00-10:30',
              detected_at: new Date().toISOString()
            }
          ],
          summary: { total_conflicts: 1, critical: 0, high: 1 }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Demo mode with inline time_slots: skip DB fetch
    if (isDemo && time_slots) {
      console.log('Demo mode: using inline time_slots')
      // timeSlots already set from body
    } else if (isDemo) {
      // Demo mode without time_slots: return empty
      return new Response(
        JSON.stringify({
          ok: true,
          demo: true,
          timetableId,
          conflicts: [],
          summary: { total_conflicts: 0, critical: 0, high: 0 }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } else {
      // Authenticated mode
      user = await getUserFromRequest(req)
      const supabase = createServiceClient()
      const isAdmin = user.role === 'service_role'

      // Verify user owns this timetable (skip for admin)
      const { data: timetable, error: timetableError } = await supabase
        .from('timetables')
        .select('id, user_id')
        .eq('id', timetableId)
        .single()

      if (timetableError || !timetable) {
        return new Response(
          JSON.stringify({ error: 'Timetable not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (!isAdmin && timetable.user_id !== user.id) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Fetch all time slots for this timetable
      const { data: slots, error: slotsError } = await supabase
        .from('time_slots')
        .select('*')
        .eq('timetable_id', timetableId)
        .order('day_of_week', { ascending: true })
        .order('start_time', { ascending: true })

      if (slotsError) {
        throw slotsError
      }

      timeSlots = slots
    }

    if (!timeSlots || timeSlots.length === 0) {
      return new Response(
        JSON.stringify({ conflicts: [], ai_suggestions: [], message: 'No time slots to analyze' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fast local pre-checks
    const overlaps = quickOverlapCheck(timeSlots)
    const locationConflicts = checkLocationConflicts(timeSlots)
    const instructorConflicts = checkInstructorConflicts(timeSlots)
    const travelIssues = checkTravelTimeIssues(timeSlots)

    const hasLocalConflicts = overlaps.length > 0 || locationConflicts.length > 0 || 
                              instructorConflicts.length > 0 || travelIssues.length > 0

    let aiResult = { conflicts: [] }
    
    // Only call Groq if we have potential conflicts or need deeper analysis
    if (hasLocalConflicts || timeSlots.length > 5) {
      console.log('Running AI analysis with Groq...')
      aiResult = await detectConflicts(timeSlots)
    }

    // Prepare conflicts for response
    const conflictsToInsert = aiResult.conflicts.map(conflict => ({
      timetable_id: timetableId,
      conflict_type: conflict.type,
      severity: conflict.severity,
      slot1_id: conflict.slot1_id,
      slot2_id: conflict.slot2_id || null,
      description: conflict.reasoning,
      detected_at: new Date().toISOString()
    }))

    let insertedConflicts = conflictsToInsert
    let insertedSuggestions = []

    // Only persist to DB if authenticated (not demo mode)
    if (!isDemo) {
      const supabase = createServiceClient()
      
      if (conflictsToInsert.length > 0) {
        // Clear old conflicts first
        await supabase
          .from('conflicts')
          .delete()
          .eq('timetable_id', timetableId)

        const { data: conflicts, error: conflictError } = await supabase
          .from('conflicts')
          .insert(conflictsToInsert)
          .select()

        if (conflictError) {
          console.error('Error inserting conflicts:', conflictError)
        } else {
          insertedConflicts = conflicts || []
        }
      }

      // Persist AI suggestions
      const suggestionsToInsert = aiResult.conflicts
        .filter(c => c.suggestion && c.confidence_score > 0.5)
        .map(conflict => ({
          timetable_id: timetableId,
          suggestion_type: 'conflict_resolution',
          suggestion_text: conflict.suggestion,
          reasoning: conflict.reasoning,
          confidence_score: conflict.confidence_score,
          status: 'pending',
          metadata: {
            conflict_type: conflict.type,
            severity: conflict.severity,
            slot_ids: [conflict.slot1_id, conflict.slot2_id].filter(Boolean)
          }
        }))

      if (suggestionsToInsert.length > 0) {
        const { data: suggestions, error: suggestionError } = await supabase
          .from('ai_suggestions')
          .insert(suggestionsToInsert)
          .select()

        if (suggestionError) {
          console.error('Error inserting suggestions:', suggestionError)
        } else {
          insertedSuggestions = suggestions || []
        }
      }

      // Send realtime notification
      if (user) {
        await supabase
          .from('notifications')
          .insert({
            user_id: user.id,
            type: 'conflict_detected',
            title: `${insertedConflicts.length} conflicts detected`,
            message: `Your timetable has ${insertedConflicts.length} scheduling conflicts`,
            metadata: { timetable_id: timetableId, conflict_count: insertedConflicts.length }
          })
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        demo: isDemo,
        conflicts: insertedConflicts,
        ai_suggestions: insertedSuggestions,
        summary: {
          total_conflicts: insertedConflicts.length,
          critical: insertedConflicts.filter(c => c.severity === 'critical').length,
          high: insertedConflicts.filter(c => c.severity === 'high').length,
          suggestions_generated: insertedSuggestions.length
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in detect-conflicts:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
