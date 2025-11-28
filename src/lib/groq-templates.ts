// Groq prompt templates for substitution and reallocation (no semicolons)

export const buildReallocationPrompt = (context: any): string => {
  return `You are a timetable scheduling expert. Analyze the following context and provide optimal substitution recommendations.

CONTEXT:
${JSON.stringify(context, null, 2)}

CONSTRAINTS:
- Maximum weekly minutes per teacher: ${context.constraints.max_weekly_minutes}
- Minimum HOD minutes per class per week: ${context.constraints.hod_min_minutes}
- Teachers must not exceed their weekly cap
- Prioritize subject-qualified teachers
- Consider subject progress (lower progress = higher priority)
- Respect teacher availability

TIE-BREAKER RULES (apply in order):
1. Teacher with least assigned minutes this week
2. Higher subject match score
3. Alphabetically by teacher ID

REQUIRED OUTPUT FORMAT (strict JSON only):
{
  "substitution_suggestions": [
    {
      "suggestion_id": "unique-id",
      "time_slot_id": "uuid",
      "candidate_teacher_id": "uuid",
      "candidate_teacher_name": "string",
      "score": 0.95,
      "reasoning": "Detailed explanation",
      "tradeoffs": ["list of considerations"],
      "predicted_effects": {
        "teacher_load_delta_minutes": 60,
        "subject_progress_impact": "maintained|improved|at_risk",
        "workload_balance_impact": "improved|neutral|degraded"
      },
      "confidence": 0.92
    }
  ],
  "plan_summary": {
    "total_substitutions": 3,
    "high_confidence_count": 2,
    "overall_confidence": 0.88,
    "recommended_action": "apply|review|escalate"
  }
}

Return ONLY valid JSON. No prose outside JSON structure.`
}

export const buildConflictDetectionPrompt = (slots: any[], availability: any[]): string => {
  return `You are a scheduling conflict detection expert. Analyze time slots and teacher availability.

TIME SLOTS:
${JSON.stringify(slots, null, 2)}

TEACHER AVAILABILITY:
${JSON.stringify(availability, null, 2)}

Detect:
1. Time overlaps (same teacher, same time)
2. Missing coverage (no teacher assigned)
3. Workload violations (exceeding caps)
4. Availability conflicts (teacher unavailable)

REQUIRED OUTPUT FORMAT (strict JSON only):
{
  "conflicts": [
    {
      "type": "time_overlap|missing_coverage|workload_violation|availability_conflict",
      "severity": "low|medium|high|critical",
      "slot_ids": ["uuid1", "uuid2"],
      "teacher_id": "uuid",
      "description": "Clear explanation",
      "actionable_recommendation": "Specific fix"
    }
  ],
  "summary": {
    "total_conflicts": 5,
    "critical_count": 1,
    "requires_immediate_action": true
  }
}

Return ONLY valid JSON.`
}

export const validateGroqResponse = (response: any): { valid: boolean; errors: string[] } => {
  const errors: string[] = []
  
  if (!response) {
    errors.push('Response is null or undefined')
    return { valid: false, errors }
  }
  
  if (response.substitution_suggestions) {
    if (!Array.isArray(response.substitution_suggestions)) {
      errors.push('substitution_suggestions must be an array')
    } else {
      response.substitution_suggestions.forEach((sug: any, idx: number) => {
        if (!sug.time_slot_id) errors.push(`Suggestion ${idx}: missing time_slot_id`)
        if (!sug.candidate_teacher_id) errors.push(`Suggestion ${idx}: missing candidate_teacher_id`)
        if (typeof sug.score !== 'number') errors.push(`Suggestion ${idx}: score must be number`)
        if (sug.score < 0 || sug.score > 1) errors.push(`Suggestion ${idx}: score must be 0-1`)
      })
    }
  }
  
  if (response.conflicts) {
    if (!Array.isArray(response.conflicts)) {
      errors.push('conflicts must be an array')
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  }
}

export const parseGroqResponse = (content: string): any => {
  try {
    const parsed = JSON.parse(content)
    const validation = validateGroqResponse(parsed)
    
    if (!validation.valid) {
      console.error('Groq response validation failed:', validation.errors)
      return null
    }
    
    return parsed
  } catch (e) {
    console.error('Failed to parse Groq response:', e)
    return null
  }
}
