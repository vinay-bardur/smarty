import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createServiceClient, getUserFromRequest, corsHeaders } from '../../../src/lib/supabase-server.ts'
import { buildReallocationPrompt, parseGroqResponse } from '../../../src/lib/groq-templates.ts'
import { notifySubstitutionSuggested, getAdminUserIds } from '../../../src/lib/notifications.ts'

const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') || ''
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const user = await getUserFromRequest(req)
    const url = new URL(req.url)
    const timetableId = url.searchParams.get('timetableId')
    const dryRun = url.searchParams.get('dryRun') === 'true'

    if (!timetableId) {
      return new Response(
        JSON.stringify({ error: 'timetableId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createServiceClient()

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin' && profile?.role !== 'hod') {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - admin or HOD only' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: openRequests } = await supabase
      .from('v_substitution_request_details')
      .select('*')
      .eq('status', 'open')
      .or(`status.eq.suggested`)

    if (!openRequests || openRequests.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No open substitution requests found' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: teachers } = await supabase
      .from('teachers')
      .select('*')
      .eq('status', 'active')

    const { data: workload } = await supabase
      .from('v_teacher_workload_status')
      .select('*')

    const { data: settings } = await supabase
      .from('system_settings')
      .select('*')

    const settingsMap = settings?.reduce((acc, s) => {
      acc[s.key] = s.value
      return acc
    }, {}) || {}

    const context = {
      substitution_requests: openRequests,
      teachers: teachers || [],
      teacher_workload: workload || [],
      constraints: {
        max_weekly_minutes: parseInt(settingsMap['teacher_max_weekly_minutes'] || '1080'),
        hod_min_minutes: parseInt(settingsMap['hod_min_minutes_per_class_per_week'] || '120')
      },
      timetable_id: timetableId
    }

    const prompt = buildReallocationPrompt(context)

    console.log('Calling Groq API for reallocation...')

    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You are a timetable reallocation expert. Always return valid JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.statusText}`)
    }

    const data = await response.json()
    const content = data.choices[0]?.message?.content || '{}'
    
    const aiResult = parseGroqResponse(content)

    if (!aiResult) {
      throw new Error('Failed to parse Groq response')
    }

    if (dryRun) {
      return new Response(
        JSON.stringify({
          dry_run: true,
          suggestions: aiResult.substitution_suggestions || [],
          plan_summary: aiResult.plan_summary || {}
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const updatedRequests = []

    for (const suggestion of aiResult.substitution_suggestions || []) {
      const { data: updated } = await supabase
        .from('substitution_requests')
        .update({
          suggested_teacher_id: suggestion.candidate_teacher_id,
          status: 'suggested',
          suggestion_payload: {
            score: suggestion.score,
            reasoning: suggestion.reasoning,
            tradeoffs: suggestion.tradeoffs,
            predicted_effects: suggestion.predicted_effects,
            confidence: suggestion.confidence,
            ai_generated: true,
            timestamp: new Date().toISOString()
          }
        })
        .eq('time_slot_id', suggestion.time_slot_id)
        .select()
        .single()

      if (updated) {
        updatedRequests.push(updated)

        await supabase
          .from('ai_suggestions')
          .insert({
            timetable_id: timetableId,
            suggestion_type: 'substitution',
            suggestion_text: suggestion.reasoning,
            reasoning: JSON.stringify(suggestion.tradeoffs),
            confidence_score: suggestion.confidence,
            status: 'pending',
            metadata: {
              substitution_request_id: updated.id,
              candidate_teacher_id: suggestion.candidate_teacher_id,
              predicted_effects: suggestion.predicted_effects
            }
          })
      }
    }

    const adminIds = await getAdminUserIds()
    
    for (const req of updatedRequests) {
      if (req.suggested_teacher_id) {
        const slotDetails = openRequests.find(r => r.slot_id === req.time_slot_id)
        if (slotDetails) {
          await notifySubstitutionSuggested(
            req.suggested_teacher_id,
            adminIds,
            req.id,
            slotDetails
          )
        }
      }
    }

    await supabase
      .from('audit_logs')
      .insert({
        user_id: user.id,
        action: 'reallocation_suggested',
        resource_type: 'substitution_requests',
        metadata: {
          timetable_id: timetableId,
          suggestions_count: updatedRequests.length,
          ai_confidence: aiResult.plan_summary?.overall_confidence
        }
      })

    return new Response(
      JSON.stringify({
        message: 'Reallocation suggestions generated',
        suggestions: updatedRequests,
        plan_summary: aiResult.plan_summary,
        dry_run: false
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in reallocate-classes:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
