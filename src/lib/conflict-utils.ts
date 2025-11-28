export interface TimeSlot {
  id: string
  timetable_id: string
  day_of_week: string
  start_time: string
  end_time: string
  title: string
  location?: string
  instructor?: string
  color: string
}

export const quickOverlapCheck = (slots: TimeSlot[]): Array<[TimeSlot, TimeSlot]> => {
  const overlaps: Array<[TimeSlot, TimeSlot]> = []
  
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const slot1 = slots[i]
      const slot2 = slots[j]
      
      if (slot1.day_of_week !== slot2.day_of_week) continue
      
      const start1 = timeToMinutes(slot1.start_time)
      const end1 = timeToMinutes(slot1.end_time)
      const start2 = timeToMinutes(slot2.start_time)
      const end2 = timeToMinutes(slot2.end_time)
      
      if (start1 < end2 && start2 < end1) {
        overlaps.push([slot1, slot2])
      }
    }
  }
  
  return overlaps
}

export const checkLocationConflicts = (slots: TimeSlot[]): Array<[TimeSlot, TimeSlot]> => {
  const conflicts: Array<[TimeSlot, TimeSlot]> = []
  
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const slot1 = slots[i]
      const slot2 = slots[j]
      
      if (!slot1.location || !slot2.location) continue
      if (slot1.location !== slot2.location) continue
      if (slot1.day_of_week !== slot2.day_of_week) continue
      
      const start1 = timeToMinutes(slot1.start_time)
      const end1 = timeToMinutes(slot1.end_time)
      const start2 = timeToMinutes(slot2.start_time)
      const end2 = timeToMinutes(slot2.end_time)
      
      if (start1 < end2 && start2 < end1) {
        conflicts.push([slot1, slot2])
      }
    }
  }
  
  return conflicts
}

export const checkInstructorConflicts = (slots: TimeSlot[]): Array<[TimeSlot, TimeSlot]> => {
  const conflicts: Array<[TimeSlot, TimeSlot]> = []
  
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const slot1 = slots[i]
      const slot2 = slots[j]
      
      if (!slot1.instructor || !slot2.instructor) continue
      if (slot1.instructor !== slot2.instructor) continue
      if (slot1.day_of_week !== slot2.day_of_week) continue
      
      const start1 = timeToMinutes(slot1.start_time)
      const end1 = timeToMinutes(slot1.end_time)
      const start2 = timeToMinutes(slot2.start_time)
      const end2 = timeToMinutes(slot2.end_time)
      
      if (start1 < end2 && start2 < end1) {
        conflicts.push([slot1, slot2])
      }
    }
  }
  
  return conflicts
}

export const checkTravelTimeIssues = (slots: TimeSlot[], minTravelMinutes: number = 15): Array<[TimeSlot, TimeSlot]> => {
  const issues: Array<[TimeSlot, TimeSlot]> = []
  
  const slotsByDay = slots.reduce((acc, slot) => {
    if (!acc[slot.day_of_week]) acc[slot.day_of_week] = []
    acc[slot.day_of_week].push(slot)
    return acc
  }, {} as Record<string, TimeSlot[]>)
  
  Object.values(slotsByDay).forEach(daySlots => {
    const sorted = daySlots.sort((a, b) => 
      timeToMinutes(a.start_time) - timeToMinutes(b.start_time)
    )
    
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i]
      const next = sorted[i + 1]
      
      if (!current.location || !next.location) continue
      if (current.location === next.location) continue
      
      const currentEnd = timeToMinutes(current.end_time)
      const nextStart = timeToMinutes(next.start_time)
      const gap = nextStart - currentEnd
      
      if (gap < minTravelMinutes) {
        issues.push([current, next])
      }
    }
  })
  
  return issues
}

const timeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

export const formatConflictMessage = (type: string, slot1: TimeSlot, slot2?: TimeSlot): string => {
  switch (type) {
    case 'time_overlap':
      return `"${slot1.title}" and "${slot2?.title}" overlap on ${slot1.day_of_week} (${slot1.start_time}-${slot1.end_time})`
    case 'location_conflict':
      return `${slot1.location} is double-booked on ${slot1.day_of_week}`
    case 'instructor_conflict':
      return `${slot1.instructor} is assigned to multiple classes on ${slot1.day_of_week}`
    case 'travel_time':
      return `Insufficient travel time between ${slot1.location} and ${slot2?.location} on ${slot1.day_of_week}`
    default:
      return 'Unknown conflict type'
  }
}
