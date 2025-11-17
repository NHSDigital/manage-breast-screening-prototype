// app/lib/generators/event-generator.js

const generateId = require('../utils/id-generator')
const { faker } = require('@faker-js/faker')
const weighted = require('weighted')
const dayjs = require('dayjs')
const config = require('../../config')
const { STATUS_GROUPS, isCompleted, isFinal } = require('../utils/status')
const { generateMammogramImages } = require('./mammogram-generator')
const {
  generateMedicalInformation
} = require('./medical-information-generator')
const {
  generateSpecialAppointment
} = require('./special-appointment-generator')
const { generateAppointmentNote } = require('./appointment-note-generator')
const users = require('../../data/users')
const screeningRooms = require('../../data/screening-rooms')

const NOT_SCREENED_REASONS = [
  'Recent mammogram at different facility',
  'Currently undergoing breast cancer treatment',
  'Breast implants requiring special imaging',
  'Acute breast symptoms requiring GP referral',
  'Currently pregnant or breastfeeding',
  'Recent breast surgery'
]

const determineEventStatus = (
  slotDateTime,
  currentDateTime,
  attendanceWeights
) => {
  slotDateTime = dayjs(slotDateTime)

  const simulatedTime = dayjs(currentDateTime)
  const slotDate = slotDateTime.startOf('day')
  const currentDate = simulatedTime.startOf('day')

  // For future dates or future slots today, always return scheduled
  if (slotDateTime.isAfter(simulatedTime)) {
    return weighted.select({
      event_scheduled: 0.95,
      event_cancelled: 0.05
    })
  }

  if (slotDate.isBefore(currentDate)) {
    return weighted.select(STATUS_GROUPS.final, attendanceWeights)
  }

  // For past slots, generate a status based on how long ago the slot was
  const minutesPassed = simulatedTime.diff(slotDateTime, 'minute')

  // Define probability weights for different statuses based on time passed
  if (minutesPassed <= 60) {
    // Within 30 mins of appointment
    return weighted.select({
      event_checked_in: 0.3,
      event_complete: 0.2,
      event_attended_not_screened: 0.1,
      event_scheduled: 0.4
    })
  } else {
    // More than 30 mins after appointment
    return weighted.select({
      event_complete: 0.6,
      event_attended_not_screened: 0.1,
      event_scheduled: 0.2
    })
  }
}

const generateEvent = ({
  slot,
  participant,
  clinic,
  outcomeWeights,
  forceStatus = null,
  id = null,
  specialAppointmentOverride = null,
  forceInProgress = false
}) => {
  // Parse dates once
  const [hours, minutes] = config.clinics.simulatedTime.split(':')
  const simulatedDateTime = dayjs()
    .hour(parseInt(hours))
    .minute(parseInt(minutes))
    .second(0)
    .millisecond(0)
  const slotDateTime = dayjs(slot.dateTime)
  const isPast = slotDateTime.isBefore(simulatedDateTime)

  // Generate special appointment requirements for this event
  const specialAppointment =
    specialAppointmentOverride || generateSpecialAppointment()
  const hasSpecialAppointment = Boolean(
    specialAppointment?.supportTypes?.length
  )

  // Double the duration for special appointments
  const duration = hasSpecialAppointment ? slot.duration * 2 : slot.duration
  const endDateTime = dayjs(slot.dateTime).add(duration, 'minute')

  const attendanceWeights =
    clinic.clinicType === 'assessment'
      ? [0.85, 0.05, 0.05, 0, 0.05]
      : [0.7, 0.1, 0.1, 0.05, 0.05]

  // We'll use forceStatus if provided, otherwise calculate based on timing
  let eventStatus =
    forceStatus ||
    determineEventStatus(slotDateTime, simulatedDateTime, attendanceWeights)

  // Override to in_progress if requested
  if (forceInProgress) {
    eventStatus = 'event_in_progress'
  }

  const eventBase = {
    id: id || generateId(),
    participantId: participant.id,
    clinicId: clinic.id,
    slotId: slot.id,
    type: clinic.clinicType,
    timing: {
      startTime: slot.dateTime,
      endTime: endDateTime.toISOString(),
      duration
    },
    status: eventStatus,
    details: {
      screeningType: 'mammogram',
      machineId: generateId()
    },
    statusHistory: [
      {
        status: 'event_scheduled',
        timestamp: dayjs(slot.dateTime).subtract(1, 'day').toISOString()
      }
    ]
  }

  // Add special appointment data if present
  if (specialAppointment) {
    eventBase.specialAppointment = specialAppointment
  }

  // For in-progress events, add session details with current time
  if (eventStatus === 'event_in_progress') {
    // Pick a random clinical user (not the first one)
    const clinicalUsers = users.filter((user) =>
      user.role.includes('clinician')
    )
    const randomUser = faker.helpers.arrayElement(clinicalUsers.slice(1)) // Skip first user

    eventBase.sessionDetails = {
      startedAt: dayjs()
        .subtract(faker.number.int({ min: 5, max: 45 }), 'minutes')
        .toISOString(),
      startedBy: randomUser.id
    }
  }

  if (!isPast && !forceInProgress) {
    // Generate appointment note for scheduled events (5% probability)
    const appointmentNote = generateAppointmentNote({
      isScheduled: true,
      isCompleted: false
    })
    if (appointmentNote) {
      eventBase.appointmentNote = appointmentNote
    }

    return eventBase
  }

  // For past or forced statuses, add appropriate extra details
  if (isPast || forceStatus || forceInProgress) {
    const event = {
      ...eventBase,
      details: {
        ...eventBase.details,
        notScreenedReason:
          eventStatus === 'event_attended_not_screened'
            ? faker.helpers.arrayElement(NOT_SCREENED_REASONS)
            : null
      }
    }

    // Add special appointment data if present
    if (specialAppointment) {
      event.specialAppointment = specialAppointment
    }

    // Generate appointment note for past/completed events (10% probability)
    const appointmentNote = generateAppointmentNote({
      isScheduled: false,
      isCompleted: isCompleted(eventStatus)
    })
    if (appointmentNote) {
      event.appointmentNote = appointmentNote
    }

    // Add timing details for completed appointments
    if (isCompleted(eventStatus)) {
      const actualStartOffset = faker.number.int({ min: -5, max: 5 })
      const durationOffset = hasSpecialAppointment
        ? faker.number.int({ min: -3, max: 10 })
        : faker.number.int({ min: -3, max: 5 })

      const actualStartTime = slotDateTime.add(actualStartOffset, 'minute')
      const actualEndTime = actualStartTime.add(
        slot.duration + durationOffset,
        'minute'
      )

      event.timing = {
        ...event.timing,
        actualStartTime: actualStartTime.toISOString(),
        actualEndTime: actualEndTime.toISOString(),
        actualDuration: actualEndTime.diff(actualStartTime, 'minute')
      }

      // Add session details for completed events
      const clinicalUsers = users.filter((user) =>
        user.role.includes('clinician')
      )
      const randomUser = faker.helpers.arrayElement(clinicalUsers)

      event.sessionDetails = {
        startedAt: actualStartTime.toISOString(),
        startedBy: randomUser.id,
        endedAt: actualEndTime.toISOString()
      }

      // Add mammogram images for completed events
      event.mammogramData = generateMammogramImages({
        startTime: actualStartTime,
        isSeedData: true,
        config: participant.config
      })
      
      // Add machine room for hospital locations
      if (clinic.location?.id)
      {
        const availableRooms = screeningRooms.filter(room => room.locationId === clinic.location.id)
        if (availableRooms.length > 0)
        {
          const randomRoom = faker.helpers.arrayElement(availableRooms)
          event.mammogramData.machineRoom = randomRoom.displayName
        }
      }

      // Pretend some events have previous images requested
      event.hasRequestedImages = weighted.select({ true: 0.3, false: 0.7 })

      // Generate medical information (symptoms, medical history, etc.)
      // All attributed to the user who ran the appointment
      const medicalInformation = generateMedicalInformation({
        addedByUserId: event.sessionDetails.startedBy,
        config: participant.config,
        // Allow config to override probabilities for test scenarios
        ...(participant.config?.medicalInformation || {})
      })

      // Store medical information if any was generated
      if (Object.keys(medicalInformation).length > 0) {
        event.medicalInformation = medicalInformation
      }
    }

    // Add session details for attended-not-screened events
    if (eventStatus === 'event_attended_not_screened') {
      const clinicalUsers = users.filter((user) =>
        user.role.includes('clinician')
      )
      const randomUser = faker.helpers.arrayElement(clinicalUsers)

      // They would have started the appointment process
      const actualStartTime = slotDateTime.add(
        faker.number.int({ min: -5, max: 5 }),
        'minute'
      )
      // But ended it early when determining screening couldn't proceed
      const actualEndTime = actualStartTime.add(
        faker.number.int({ min: 5, max: 15 }),
        'minute'
      )

      event.sessionDetails = {
        startedAt: actualStartTime.toISOString(),
        startedBy: randomUser.id,
        endedAt: actualEndTime.toISOString()
      }
    }

    return event
  }

  return eventBase
}

const generateStatusHistory = (finalStatus, dateTime) => {
  const history = []
  const baseDate = new Date(dateTime)

  // Always starts with scheduled status
  history.push({
    status: 'event_scheduled',
    timestamp: new Date(baseDate.getTime() - 24 * 60 * 60 * 1000).toISOString() // Day before
  })

  // Add intermediate statuses based on final status
  if (isCompleted(finalStatus)) {
    history.push(
      {
        status: 'checked_in',
        timestamp: new Date(baseDate.getTime() - 10 * 60 * 1000).toISOString() // 10 mins before
      },
      // {
      //   status: 'in_progress',
      //   timestamp: new Date(baseDate).toISOString()
      // },
      {
        status: finalStatus,
        timestamp: new Date(baseDate.getTime() + 15 * 60 * 1000).toISOString() // 15 mins after
      }
    )
  } else {
    // For did_not_attend and attended_not_screened, just add the final status
    history.push({
      status: finalStatus,
      timestamp: new Date(baseDate.getTime() + 15 * 60 * 1000).toISOString()
    })
  }

  return history
}

module.exports = {
  generateEvent
}