import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createServiceClient, getUserFromRequest, corsHeaders } from '../../../src/lib/supabase-server.ts'
import { generateOptimizations } from '../../../src/lib/groq.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { timetableId, optimizationType = 'all', time_slots } = body

    if (!timetableId) {
      return new Response(
        JSON.stringify({ error: 'timetableId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let timeSlots = time_slots
    let user = null
    let isDemo = !req.headers.get('authorization') && !req.headers.get('Authorization')

    if (isDemo && !time_slots) {
      return new Response(
        JSON.stringify({ ok: true, demo: true, suggestions: [], summary: { total: 0 } }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!isDemo) {
      user = await getUserFromRequest(req)
      const supabase = createServiceClient()
      const isAdmin = user.role === 'service_role'

      const { data: timetable, error: timetableError } = await supabase
        .from('timetables')
        .select('id, user_id, name')
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

      const { data: slots, error: slotsError } = await supabase
        .from('time_slots')
        .select('*')
        .eq('timetable_id', timetableId)
        .order('day_of_week', { ascending: true })
        .order('start_time', { ascending: true })

      if (slotsError || !slots || slots.length === 0) {
        return new Response(
          JSON.stringify({ error: 'No time slots found' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      timeSlots = slots
    }

    if (!timeSlots || timeSlots.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, demo: isDemo, suggestions: [], summary: { total: 0 } }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Generating optimizations for ${timeSlots.length} slots...`)
    
    const result = await generateOptimizations(timeSlots, optimizationType)

    const suggestionsToInsert = result.suggestions.map(suggestion => ({
      timetable_id: timetableId,
      suggestion_type: suggestion.type,
      suggestion_text: `${suggestion.reasoning} - ${suggestion.estimated_improvement}`,
      reasoning: suggestion.reasoning,
      confidence_score: suggestion.confidence_score,
      status: 'pending',
      metadata: {
        priority: suggestion.priority,
        changes: suggestion.changes,
        estimated_improvement: suggestion.estimated_improvement
      }
    }))

    let insertedSuggestions = suggestionsToInsert

    if (!isDemo) {
      const supabase = createServiceClient()
      const { data: suggestions, error: insertError } = await supabase
        .from('ai_suggestions')
        .insert(suggestionsToInsert)
        .select()

      if (insertError) {
        throw insertError
      }
      insertedSuggestions = suggestions

      if (user) {
        await supabase
          .from('notifications')
          .insert({
            user_id: user.id,
            type: 'suggestions_generated',
            title: `${insertedSuggestions.length} optimization suggestions`,
            message: `AI has generated ${insertedSuggestions.length} ways to improve your timetable`,
            metadata: { timetable_id: timetableId }
          })
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        demo: isDemo,
        suggestions: insertedSuggestions,
        summary: {
          total: insertedSuggestions.length,
          high_confidence: insertedSuggestions.filter(s => s.confidence_score > 0.8).length
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in generate-suggestions:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
