// Scheduling utilities with deterministic tie-breakers (no semicolons)

export interface TeacherCandidate {
  teacher_id: string
  teacher_name: string
  employee_code: string
  match_score: number
  available_minutes: number
  subjects: string[]
  reason: string
}

export interface SubstitutionContext {
  slot_id: string
  day_of_week: string
  start_time: string
  end_time: string
  subject_code: string
  classroom_id: string
  classroom_name: string
  original_teacher_id: string
  duration_minutes: number
  subject_weight: number
  progress_percent: number
}

export const deterministicTieBreaker = (
  candidates: TeacherCandidate[]
): TeacherCandidate[] => {
  return candidates.sort((a, b) => {
    // 1. Higher match score wins
    if (a.match_score !== b.match_score) {
      return b.match_score - a.match_score
    }
    
    // 2. More available minutes wins (less loaded)
    if (a.available_minutes !== b.available_minutes) {
      return b.available_minutes - a.available_minutes
    }
    
    // 3. Alphabetic by employee code
    return a.employee_code.localeCompare(b.employee_code)
  })
}

export const calculatePriority = (context: SubstitutionContext): string => {
  const { progress_percent, subject_weight } = context
  
  if (progress_percent < 50 && subject_weight >= 4) {
    return 'critical'
  }
  
  if (progress_percent < 75 && subject_weight >= 3) {
    return 'high'
  }
  
  if (progress_percent < 75) {
    return 'medium'
  }
  
  return 'normal'
}

export const formatSubstitutionReason = (
  candidate: TeacherCandidate,
  context: SubstitutionContext
): string => {
  const reasons = []
  
  if (candidate.subjects.includes(context.subject_code)) {
    reasons.push(`Qualified in ${context.subject_code}`)
  }
  
  if (candidate.available_minutes > 300) {
    reasons.push(`High availability (${Math.floor(candidate.available_minutes / 60)}h free)`)
  }
  
  if (candidate.match_score > 0.7) {
    reasons.push('Strong match')
  }
  
  return reasons.join(', ') || 'Available and under capacity'
}

export const validateWorkloadConstraints = (
  teacherId: string,
  currentMinutes: number,
  additionalMinutes: number,
  maxMinutes: number = 1080
): { valid: boolean; reason?: string } => {
  const totalMinutes = currentMinutes + additionalMinutes
  
  if (totalMinutes > maxMinutes) {
    return {
      valid: false,
      reason: `Would exceed weekly cap (${totalMinutes}/${maxMinutes} minutes)`
    }
  }
  
  return { valid: true }
}

export const buildSubstitutionPayload = (
  candidate: TeacherCandidate,
  context: SubstitutionContext,
  priority: string
) => {
  return {
    suggested_teacher_id: candidate.teacher_id,
    suggested_teacher_name: candidate.teacher_name,
    match_score: candidate.match_score,
    priority,
    reasoning: formatSubstitutionReason(candidate, context),
    subject_match: candidate.subjects.includes(context.subject_code),
    available_capacity_minutes: candidate.available_minutes,
    estimated_impact: {
      teacher_load_increase: context.duration_minutes,
      subject_progress_maintained: candidate.subjects.includes(context.subject_code)
    },
    confidence: candidate.match_score,
    timestamp: new Date().toISOString()
  }
}

export const timeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

export const checkTimeOverlap = (
  start1: string,
  end1: string,
  start2: string,
  end2: string
): boolean => {
  const s1 = timeToMinutes(start1)
  const e1 = timeToMinutes(end1)
  const s2 = timeToMinutes(start2)
  const e2 = timeToMinutes(end2)
  
  return s1 < e2 && s2 < e1
}
