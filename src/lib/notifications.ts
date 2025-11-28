// Notification utilities for realtime and persistent notifications (no semicolons)

import { createServiceClient } from './supabase-server.ts'

export interface NotificationPayload {
  user_id: string
  type: string
  title: string
  message: string
  metadata?: any
}

export const createNotification = async (payload: NotificationPayload) => {
  const supabase = createServiceClient()
  
  const { data, error } = await supabase
    .from('notifications')
    .insert({
      user_id: payload.user_id,
      type: payload.type,
      title: payload.title,
      message: payload.message,
      metadata: payload.metadata || {}
    })
    .select()
    .single()
  
  if (error) {
    console.error('Failed to create notification:', error)
    return null
  }
  
  return data
}

export const notifyAbsenceReported = async (
  teacherId: string,
  hodId: string,
  adminIds: string[],
  affectedSlotsCount: number,
  date: string
) => {
  const notifications: NotificationPayload[] = []
  
  // Notify teacher
  notifications.push({
    user_id: teacherId,
    type: 'absence_confirmed',
    title: 'Absence Recorded',
    message: `Your absence on ${date} has been recorded. ${affectedSlotsCount} classes affected.`,
    metadata: { date, affected_slots: affectedSlotsCount }
  })
  
  // Notify HOD
  if (hodId) {
    notifications.push({
      user_id: hodId,
      type: 'absence_reported',
      title: 'Teacher Absence Reported',
      message: `A teacher in your department is absent on ${date}. ${affectedSlotsCount} classes need coverage.`,
      metadata: { teacher_id: teacherId, date, affected_slots: affectedSlotsCount }
    })
  }
  
  // Notify admins
  for (const adminId of adminIds) {
    notifications.push({
      user_id: adminId,
      type: 'absence_reported',
      title: 'Teacher Absence Alert',
      message: `Teacher absence on ${date}. ${affectedSlotsCount} substitutions needed.`,
      metadata: { teacher_id: teacherId, date, affected_slots: affectedSlotsCount }
    })
  }
  
  // Create all notifications
  for (const notif of notifications) {
    await createNotification(notif)
  }
}

export const notifySubstitutionSuggested = async (
  suggestedTeacherId: string,
  adminIds: string[],
  substitutionRequestId: string,
  slotDetails: any
) => {
  const notifications: NotificationPayload[] = []
  
  // Notify suggested teacher
  notifications.push({
    user_id: suggestedTeacherId,
    type: 'substitution_suggested',
    title: 'Substitution Request',
    message: `You've been suggested to cover ${slotDetails.subject_name} on ${slotDetails.day_of_week} at ${slotDetails.start_time}`,
    metadata: {
      substitution_request_id: substitutionRequestId,
      slot_id: slotDetails.slot_id,
      classroom: slotDetails.classroom_name
    }
  })
  
  // Notify admins
  for (const adminId of adminIds) {
    notifications.push({
      user_id: adminId,
      type: 'substitution_suggested',
      title: 'Substitution Suggestion Ready',
      message: `AI has suggested a substitute for ${slotDetails.classroom_name}`,
      metadata: {
        substitution_request_id: substitutionRequestId,
        suggested_teacher_id: suggestedTeacherId
      }
    })
  }
  
  for (const notif of notifications) {
    await createNotification(notif)
  }
}

export const notifySubstitutionApplied = async (
  originalTeacherId: string,
  newTeacherId: string,
  classroomStudents: string[],
  slotDetails: any
) => {
  const notifications: NotificationPayload[] = []
  
  // Notify original teacher
  if (originalTeacherId) {
    notifications.push({
      user_id: originalTeacherId,
      type: 'substitution_applied',
      title: 'Substitution Confirmed',
      message: `Your class on ${slotDetails.day_of_week} has been covered`,
      metadata: { slot_id: slotDetails.slot_id, substitute_teacher_id: newTeacherId }
    })
  }
  
  // Notify new teacher
  notifications.push({
    user_id: newTeacherId,
    type: 'substitution_applied',
    title: 'Substitution Assigned',
    message: `You are now assigned to ${slotDetails.classroom_name} on ${slotDetails.day_of_week} at ${slotDetails.start_time}`,
    metadata: { slot_id: slotDetails.slot_id }
  })
  
  // Notify students (if user IDs available)
  for (const studentId of classroomStudents) {
    notifications.push({
      user_id: studentId,
      type: 'teacher_change',
      title: 'Teacher Change',
      message: `Your ${slotDetails.subject_name} class will be taught by a substitute teacher`,
      metadata: { slot_id: slotDetails.slot_id }
    })
  }
  
  for (const notif of notifications) {
    await createNotification(notif)
  }
}

export const getAdminUserIds = async (): Promise<string[]> => {
  const supabase = createServiceClient()
  
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .in('role', ['admin', 'hod'])
  
  if (error || !data) {
    console.error('Failed to fetch admin IDs:', error)
    return []
  }
  
  return data.map(p => p.id)
}
