import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createServiceClient, getUserFromRequest, corsHeaders } from '../../../src/lib/supabase-server.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const user = await getUserFromRequest(req)
    const url = new URL(req.url)
    const timetableId = url.searchParams.get('timetableId')
    const format = url.searchParams.get('format') || 'csv'

    if (!timetableId) {
      return new Response(
        JSON.stringify({ error: 'timetableId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createServiceClient()

    // Verify ownership
    const { data: timetable, error: timetableError } = await supabase
      .from('timetables')
      .select('id, user_id, name')
      .eq('id', timetableId)
      .single()

    if (timetableError || !timetable || timetable.user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'Timetable not found or unauthorized' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch time slots
    const { data: timeSlots, error: slotsError } = await supabase
      .from('time_slots')
      .select('*')
      .eq('timetable_id', timetableId)
      .order('day_of_week', { ascending: true })
      .order('start_time', { ascending: true })

    if (slotsError || !timeSlots) {
      throw slotsError
    }

    let fileContent: string
    let fileName: string
    let contentType: string

    if (format === 'csv') {
      fileContent = generateCSV(timeSlots, timetable.name)
      fileName = `${timetable.name.replace(/\s+/g, '_')}_${Date.now()}.csv`
      contentType = 'text/csv'
    } else if (format === 'ics') {
      fileContent = generateICS(timeSlots, timetable.name)
      fileName = `${timetable.name.replace(/\s+/g, '_')}_${Date.now()}.ics`
      contentType = 'text/calendar'
    } else {
      return new Response(
        JSON.stringify({ error: 'Invalid format. Use csv or ics' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase
      .storage
      .from('exports')
      .upload(`${user.id}/${fileName}`, fileContent, {
        contentType,
        upsert: true
      })

    if (uploadError) {
      throw uploadError
    }

    // Generate signed URL (valid for 1 hour)
    const { data: signedUrlData, error: urlError } = await supabase
      .storage
      .from('exports')
      .createSignedUrl(`${user.id}/${fileName}`, 3600)

    if (urlError) {
      throw urlError
    }

    return new Response(
      JSON.stringify({
        url: signedUrlData.signedUrl,
        fileName,
        format,
        expiresIn: 3600
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in export-timetable:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

const generateCSV = (slots: any[], timetableName: string): string => {
  const headers = ['Day', 'Start Time', 'End Time', 'Title', 'Location', 'Instructor', 'Description']
  const rows = slots.map(slot => [
    slot.day_of_week,
    slot.start_time,
    slot.end_time,
    slot.title,
    slot.location || '',
    slot.instructor || '',
    slot.description || ''
  ])

  const csvContent = [
    `# ${timetableName}`,
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n')

  return csvContent
}

const generateICS = (slots: any[], timetableName: string): string => {
  const now = new Date()
  const events = slots.map(slot => {
    const startDate = getNextOccurrence(slot.day_of_week, slot.start_time)
    const endDate = getNextOccurrence(slot.day_of_week, slot.end_time)

    return [
      'BEGIN:VEVENT',
      `UID:${slot.id}@smarty-timetable`,
      `DTSTAMP:${formatICSDate(now)}`,
      `DTSTART:${formatICSDate(startDate)}`,
      `DTEND:${formatICSDate(endDate)}`,
      `SUMMARY:${slot.title}`,
      slot.location ? `LOCATION:${slot.location}` : '',
      slot.description ? `DESCRIPTION:${slot.description}` : '',
      'RRULE:FREQ=WEEKLY;COUNT=15',
      'END:VEVENT'
    ].filter(Boolean).join('\n')
  })

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Smarty Timetable//EN',
    `X-WR-CALNAME:${timetableName}`,
    ...events,
    'END:VCALENDAR'
  ].join('\n')
}

const getNextOccurrence = (dayOfWeek: string, time: string): Date => {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const targetDay = days.indexOf(dayOfWeek)
  const now = new Date()
  const currentDay = now.getDay()
  
  let daysUntil = targetDay - currentDay
  if (daysUntil < 0) daysUntil += 7
  
  const targetDate = new Date(now)
  targetDate.setDate(now.getDate() + daysUntil)
  
  const [hours, minutes] = time.split(':').map(Number)
  targetDate.setHours(hours, minutes, 0, 0)
  
  return targetDate
}

const formatICSDate = (date: Date): string => {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}
