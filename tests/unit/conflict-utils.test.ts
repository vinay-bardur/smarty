import { describe, it, expect } from 'vitest'
import { quickOverlapCheck, checkLocationConflicts, checkInstructorConflicts, checkTravelTimeIssues } from '../../src/lib/conflict-utils'

describe('Conflict Detection Utils', () => {
  const mockSlots = [
    {
      id: '1',
      timetable_id: 'tt1',
      day_of_week: 'Monday',
      start_time: '09:00',
      end_time: '10:00',
      title: 'Math',
      location: 'Room 101',
      instructor: 'Dr. Smith',
      color: '#3B82F6'
    },
    {
      id: '2',
      timetable_id: 'tt1',
      day_of_week: 'Monday',
      start_time: '09:30',
      end_time: '10:30',
      title: 'Physics',
      location: 'Room 102',
      instructor: 'Dr. Jones',
      color: '#EF4444'
    }
  ]

  describe('quickOverlapCheck', () => {
    it('should detect time overlaps on same day', () => {
      const overlaps = quickOverlapCheck(mockSlots)
      expect(overlaps).toHaveLength(1)
      expect(overlaps[0][0].id).toBe('1')
      expect(overlaps[0][1].id).toBe('2')
    })

    it('should not detect overlaps on different days', () => {
      const slots = [
        { ...mockSlots[0], day_of_week: 'Monday' },
        { ...mockSlots[1], day_of_week: 'Tuesday' }
      ]
      const overlaps = quickOverlapCheck(slots)
      expect(overlaps).toHaveLength(0)
    })
  })

  describe('checkLocationConflicts', () => {
    it('should detect same location conflicts', () => {
      const slots = [
        { ...mockSlots[0], location: 'Room 101' },
        { ...mockSlots[1], location: 'Room 101' }
      ]
      const conflicts = checkLocationConflicts(slots)
      expect(conflicts).toHaveLength(1)
    })
  })

  describe('checkTravelTimeIssues', () => {
    it('should detect insufficient travel time', () => {
      const slots = [
        { ...mockSlots[0], location: 'Building A', end_time: '10:00' },
        { ...mockSlots[1], location: 'Building B', start_time: '10:05' }
      ]
      const issues = checkTravelTimeIssues(slots, 15)
      expect(issues).toHaveLength(1)
    })
  })
})
