import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createServiceClient, getUserFromRequest, corsHeaders } from '../../../src/lib/supabase-server.ts'
import { detectConflicts } from '../../../src/lib/groq.ts'
import { quickOverlapCheck, checkLocationConflicts, checkInstructorConflicts, checkTravelTimeIssues } from '../../../src/lib/conflict-utils.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const user = await getUserFromRequest(req)
    const { timetableId } = await req.json()

    if (!timetableId) {
      return new Response(
        JSON.stringify({ error: 'timetableId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createServiceClient()

    // Verify user owns this timetable
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

    if (timetable.user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch all time slots for this timetable
    const { data: timeSlots, error: slotsError } = await supabase
      .from('time_slots')
      .select('*')
      .eq('timetable_id', timetableId)
      .order('day_of_week', { ascending: true })
      .order('start_time', { ascending: true })

    if (slotsError) {
      throw slotsError
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

    // Persist conflicts to database
    const conflictsToInsert = aiResult.conflicts.map(conflict => ({
      timetable_id: timetableId,
      conflict_type: conflict.type,
      severity: conflict.severity,
      slot1_id: conflict.slot1_id,
      slot2_id: conflict.slot2_id || null,
      description: conflict.reasoning,
      detected_at: new Date().toISOString()
    }))

    let insertedConflicts = []
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

    let insertedSuggestions = []
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
    await supabase
      .from('notifications')
      .insert({
        user_id: user.id,
        type: 'conflict_detected',
        title: `${insertedConflicts.length} conflicts detected`,
        message: `Your timetable has ${insertedConflicts.length} scheduling conflicts`,
        metadata: { timetable_id: timetableId, conflict_count: insertedConflicts.length }
      })

    return new Response(
      JSON.stringify({
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
