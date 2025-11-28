import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createServiceClient, getUserFromRequest, corsHeaders } from '../../../src/lib/supabase-server.ts'
import { createNotification, getAdminUserIds } from '../../../src/lib/notifications.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const user = await getUserFromRequest(req)
    const supabase = createServiceClient()

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - admin only' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const weekStart = new Date()
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1)
    const weekStartStr = weekStart.toISOString().split('T')[0]

    const { data: teachers } = await supabase
      .from('teachers')
      .select('id')
      .eq('status', 'active')

    for (const teacher of teachers || []) {
      await supabase.rpc('recompute_teacher_workload', {
        p_teacher_id: teacher.id,
        p_week_start: weekStartStr
      })
    }

    const { data: overloaded } = await supabase
      .from('v_teacher_workload_status')
      .select('*')
      .eq('status', 'overloaded')
      .eq('week_start', weekStartStr)

    const { data: hodDeficits } = await supabase
      .rpc('check_hod_allocation_compliance')

    const adminIds = await getAdminUserIds()
    const alerts = []

    for (const teacher of overloaded || []) {
      alerts.push({
        type: 'workload_violation',
        teacher_id: teacher.teacher_id,
        teacher_name: teacher.full_name,
        assigned_minutes: teacher.assigned_minutes,
        max_minutes: teacher.max_minutes,
        excess_minutes: teacher.assigned_minutes - teacher.max_minutes
      })

      for (const adminId of adminIds) {
        await createNotification({
          user_id: adminId,
          type: 'workload_violation',
          title: 'Teacher Workload Exceeded',
          message: `${teacher.full_name} is overloaded: ${Math.floor(teacher.assigned_minutes / 60)}h/${Math.floor(teacher.max_minutes / 60)}h`,
          metadata: {
            teacher_id: teacher.teacher_id,
            excess_minutes: teacher.assigned_minutes - teacher.max_minutes
          }
        })
      }
    }

    for (const deficit of hodDeficits || []) {
      alerts.push({
        type: 'hod_deficit',
        classroom_id: deficit.classroom_id,
        classroom_name: deficit.classroom_name,
        hod_id: deficit.hod_id,
        hod_name: deficit.hod_name,
        required_minutes: deficit.required_minutes,
        assigned_minutes: deficit.assigned_minutes,
        deficit_minutes: deficit.deficit_minutes
      })

      for (const adminId of adminIds) {
        await createNotification({
          user_id: adminId,
          type: 'hod_deficit',
          title: 'HOD Allocation Below Minimum',
          message: `${deficit.classroom_name} needs ${Math.floor(deficit.deficit_minutes / 60)}h more HOD supervision`,
          metadata: {
            classroom_id: deficit.classroom_id,
            hod_id: deficit.hod_id,
            deficit_minutes: deficit.deficit_minutes
          }
        })
      }
    }

    await supabase
      .from('audit_logs')
      .insert({
        user_id: user.id,
        action: 'workload_enforcement_run',
        resource_type: 'teacher_workload',
        metadata: {
          week_start: weekStartStr,
          overloaded_count: overloaded?.length || 0,
          hod_deficits_count: hodDeficits?.length || 0,
          alerts_generated: alerts.length
        }
      })

    return new Response(
      JSON.stringify({
        message: 'Workload enforcement completed',
        week_start: weekStartStr,
        summary: {
          teachers_checked: teachers?.length || 0,
          overloaded: overloaded?.length || 0,
          hod_deficits: hodDeficits?.length || 0,
          alerts_generated: alerts.length
        },
        alerts
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in enforce-workload:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
