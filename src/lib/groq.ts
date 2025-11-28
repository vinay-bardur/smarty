const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') || ''
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'

export interface ConflictDetectionResult {
  conflicts: Array<{
    type: 'time_overlap' | 'location_conflict' | 'instructor_conflict' | 'travel_time'
    severity: 'low' | 'medium' | 'high' | 'critical'
    slot1_id: string
    slot2_id?: string
    suggestion: string
    reasoning: string
    confidence_score: number
  }>
}

export interface OptimizationSuggestion {
  suggestions: Array<{
    type: 'minimize_gaps' | 'balance_load' | 'reduce_travel' | 'optimize_breaks'
    priority: number
    changes: Array<{
      slot_id: string
      field: string
      current_value: string
      suggested_value: string
    }>
    reasoning: string
    confidence_score: number
    estimated_improvement: string
  }>
}

export const detectConflicts = async (timeSlots: any[]): Promise<ConflictDetectionResult> => {
  if (!GROQ_API_KEY) {
    console.warn('GROQ_API_KEY not set, using local conflict detection only')
    return { conflicts: [] }
  }

  const prompt = `You are a timetable conflict detection expert. Analyze the following time slots and identify ALL conflicts.

Time Slots:
${JSON.stringify(timeSlots, null, 2)}

Identify conflicts of these types:
1. time_overlap: Two classes scheduled at the same time
2. location_conflict: Same location booked for overlapping times
3. instructor_conflict: Same instructor assigned to overlapping times
4. travel_time: Insufficient time between classes in different locations (< 15 min)

Return ONLY valid JSON in this exact format:
{
  "conflicts": [
    {
      "type": "time_overlap",
      "severity": "high",
      "slot1_id": "uuid1",
      "slot2_id": "uuid2",
      "suggestion": "Move one class to a different time",
      "reasoning": "Both classes scheduled Monday 9:00-10:00",
      "confidence_score": 0.95
    }
  ]
}

If no conflicts found, return: {"conflicts": []}`

  try {
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
            content: 'You are a precise timetable analyzer. Always return valid JSON only.'
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
      console.error(`Groq API error: ${response.statusText}`)
      return { conflicts: [] }
    }

    const data = await response.json()
    const content = data.choices[0]?.message?.content || '{}'
    
    return JSON.parse(content)
  } catch (e) {
    console.error('Groq API call failed:', e)
    return { conflicts: [] }
  }
}

export const generateOptimizations = async (
  timeSlots: any[],
  optimizationType: string = 'all'
): Promise<OptimizationSuggestion> => {
  if (!GROQ_API_KEY) {
    console.warn('GROQ_API_KEY not set, skipping AI optimization')
    return { suggestions: [] }
  }

  const prompt = `You are a timetable optimization expert. Analyze this schedule and suggest improvements.

Current Schedule:
${JSON.stringify(timeSlots, null, 2)}

Optimization Goals:
- Minimize gaps between classes
- Balance daily workload
- Reduce travel time between locations
- Optimize break times

Return ONLY valid JSON in this exact format:
{
  "suggestions": [
    {
      "type": "minimize_gaps",
      "priority": 1,
      "changes": [
        {
          "slot_id": "uuid",
          "field": "start_time",
          "current_value": "10:00",
          "suggested_value": "09:00"
        }
      ],
      "reasoning": "Moving this class earlier eliminates a 2-hour gap",
      "confidence_score": 0.88,
      "estimated_improvement": "Reduces daily gaps by 2 hours"
    }
  ]
}`

  try {
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
            content: 'You are a timetable optimization expert. Always return valid JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      console.error(`Groq API error: ${response.statusText}`)
      return { suggestions: [] }
    }

    const data = await response.json()
    const content = data.choices[0]?.message?.content || '{}'
    
    return JSON.parse(content)
  } catch (e) {
    console.error('Groq API call failed:', e)
    return { suggestions: [] }
  }
}
