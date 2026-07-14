// app/lib/generators/appointment-generator.js

const generateId = require('../utils/id-generator')
const { faker } = require('@faker-js/faker')
const weighted = require('weighted')
const dayjs = require('dayjs')
const config = require('../../config')
const { STATUS_GROUPS, isCompleted } = require('../utils/status')
const { generateMammogramImages } = require('./mammogram-generator')
const {
  generateMedicalInformation
} = require('./medical-information-generator')
const {
  generateSpecialAppointment
} = require('./special-appointment-generator')
const { generateAppointmentNote } = require('./appointment-note-generator')
const { generatePreviousMammograms } = require('./previous-mammogram-generator')
const { getImageSetForAppointment } = require('../utils/mammogram-images')
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

const determineAppointmentStatus = (
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
      appointment_scheduled: 0.95,
      appointment_cancelled: 0.05
    })
  }

  // For past dates, select from final statuses
  // Note: appointment_partially_screened is excluded - determined by mammogram completeness instead
  if (slotDate.isBefore(currentDate)) {
    const weights = attendanceWeights
    return weighted.select({
      appointment_complete: weights.complete,
      appointment_did_not_attend: weights.didNotAttend,
      appointment_attended_not_screened: weights.attendedNotScreened,
      appointment_cancelled: weights.cancelled
    })
  }

  // For past slots, generate a status based on how long ago the slot was
  const minutesPassed = simulatedTime.diff(slotDateTime, 'minute')

  // Define probability weights for different statuses based on time passed
  if (minutesPassed <= 60) {
    // Within 30 mins of appointment
    return weighted.select({
      appointment_checked_in: 0.3,
      appointment_complete: 0.2,
      appointment_attended_not_screened: 0.1,
      appointment_scheduled: 0.4
    })
  } else {
    // More than 30 mins after appointment
    return weighted.select({
      appointment_complete: 0.6,
      appointment_attended_not_screened: 0.1,
      appointment_scheduled: 0.2
    })
  }
}

const generateAppointment = ({
  slot,
  participant,
  clinic,
  episodeId,
  outcomeWeights,
  forceStatus = null,
  id = null,
  specialAppointmentOverride = null,
  forceInProgress = false,
  seedDataProfile = null
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

  // Generate special appointment requirements for this appointment
  const specialAppointment =
    specialAppointmentOverride ||
    generateSpecialAppointment({
      probability: seedDataProfile?.specialAppointment?.probability
    })
  const hasSpecialAppointment = Boolean(
    specialAppointment?.supportTypes?.length
  )

  // Double the duration for special appointments
  const duration = hasSpecialAppointment ? slot.duration * 2 : slot.duration
  const endDateTime = dayjs(slot.dateTime).add(duration, 'minute')

  // Attendance weights for seed data generation
  // Note: appointment_partially_screened is determined by mammogram completeness, not selected here
  const attendanceWeights =
    clinic.clinicType === 'assessment'
      ? {
          complete: 0.9,
          didNotAttend: 0.05,
          attendedNotScreened: 0,
          cancelled: 0.05
        }
      : {
          complete: 0.8,
          didNotAttend: 0.1,
          attendedNotScreened: 0.05,
          cancelled: 0.05
        }

  // We'll use forceStatus if provided, otherwise calculate based on timing
  let appointmentStatus =
    forceStatus ||
    determineAppointmentStatus(slotDateTime, simulatedDateTime, attendanceWeights)

  // Override to in_progress if requested
  if (forceInProgress) {
    appointmentStatus = 'appointment_in_progress'
  }

  // Generate accession number for this appointment - format: ABCYYYYMMDD#####
  // ABC = BSU abbreviation, YYYYMMDD = clinic date, ##### = random 5-digit sequence
  const accessionNumber = [
    clinic.bsuAbbreviation || 'BSU',
    dayjs(clinic.date).format('YYYYMMDD'),
    faker.number.int({ min: 10000, max: 99999 })
  ].join('')

  const appointmentBase = {
    id: id || generateId(),
    episodeId,
    participantId: participant.id,
    clinicId: clinic.id,
    accessionNumber,
    slotId: slot.id,
    type: clinic.clinicType,
    timing: {
      startTime: slot.dateTime,
      endTime: endDateTime.toISOString(),
      duration
    },
    status: appointmentStatus,
    details: {
      screeningType: 'mammogram',
      machineId: generateId()
    },
    statusHistory: [
      {
        status: 'appointment_scheduled',
        timestamp: dayjs(slot.dateTime).subtract(1, 'day').toISOString()
      }
    ]
  }

  // Add special appointment data if present
  if (specialAppointment) {
    appointmentBase.specialAppointment = specialAppointment
  }

  // For in-progress appointments, add session details with current time
  if (appointmentStatus === 'appointment_in_progress') {
    const clinicalUsers = users.filter((user) =>
      user.role.includes('clinician')
    )
    // For forced in-progress (test scenarios), use first user; otherwise random
    const randomUser =
      forceStatus === 'appointment_in_progress'
        ? clinicalUsers[0]
        : faker.helpers.arrayElement(clinicalUsers.slice(1))

    appointmentBase.sessionDetails = {
      startedAt: dayjs()
        .subtract(faker.number.int({ min: 5, max: 45 }), 'minutes')
        .toISOString(),
      startedBy: randomUser.id
    }

    // Add workflow status from participant config if provided
    if (participant.config?.workflowStatus) {
      appointmentBase.workflowStatus = participant.config.workflowStatus
    }
  }

  if (!isPast && !forceInProgress && forceStatus !== 'appointment_in_progress') {
    // Generate appointment note for scheduled appointments (5% probability)
    const appointmentNote = generateAppointmentNote({
      isScheduled: true,
      isCompleted: false
    })
    if (appointmentNote) {
      appointmentBase.appointmentNote = appointmentNote
    }

    return appointmentBase
  }

  // For past or forced statuses, add appropriate extra details
  if (isPast || forceStatus || forceInProgress) {
    const appointment = {
      ...appointmentBase,
      details: {
        ...appointmentBase.details,
        notScreenedReason:
          appointmentStatus === 'appointment_attended_not_screened'
            ? faker.helpers.arrayElement(NOT_SCREENED_REASONS)
            : null
      }
    }

    // Add special appointment data if present
    if (specialAppointment) {
      appointment.specialAppointment = specialAppointment
    }

    // Generate appointment note for past/completed appointments (10% probability)
    const appointmentNote = generateAppointmentNote({
      isScheduled: false,
      isCompleted: isCompleted(appointmentStatus)
    })
    if (appointmentNote) {
      appointment.appointmentNote = appointmentNote
    }

    // Add timing details for completed appointments
    if (isCompleted(appointmentStatus)) {
      const actualStartOffset = faker.number.int({ min: -5, max: 5 })
      const durationOffset = hasSpecialAppointment
        ? faker.number.int({ min: -3, max: 10 })
        : faker.number.int({ min: -3, max: 5 })

      const actualStartTime = slotDateTime.add(actualStartOffset, 'minute')
      const actualEndTime = actualStartTime.add(
        slot.duration + durationOffset,
        'minute'
      )

      appointment.timing = {
        ...appointment.timing,
        actualStartTime: actualStartTime.toISOString(),
        actualEndTime: actualEndTime.toISOString(),
        actualDuration: actualEndTime.diff(actualStartTime, 'minute')
      }

      // Add session details for completed appointments
      const clinicalUsers = users.filter((user) =>
        user.role.includes('clinician')
      )
      const randomUser = faker.helpers.arrayElement(clinicalUsers)

      appointment.sessionDetails = {
        startedAt: actualStartTime.toISOString(),
        startedBy: randomUser.id,
        endedAt: actualEndTime.toISOString()
      }

      // Add mammogram images for completed appointments
      appointment.mammogramData = generateMammogramImages({
        startTime: actualStartTime,
        accessionNumber: appointmentBase.accessionNumber,
        isSeedData: true,
        config: participant.config,
        scenarioWeights: seedDataProfile?.mammogram?.scenarioWeights,
        imperfectChanceForTechnicalOrIncomplete:
          seedDataProfile?.mammogram?.imperfectChanceForTechnicalOrIncomplete,
        notesForReaderChanceWithoutImperfect:
          seedDataProfile?.mammogram?.notesForReaderChanceWithoutImperfect
      })

      // Sync appointment status with mammogram completeness
      // If mammogram is incomplete, status should be partially_screened
      // If mammogram is complete but status was partially_screened, change to complete
      const isIncomplete = !appointment.mammogramData.metadata.standardViewsCompleted
      if (isIncomplete && appointment.status !== 'appointment_partially_screened') {
        appointment.status = 'appointment_partially_screened'
      } else if (!isIncomplete && appointment.status === 'appointment_partially_screened') {
        appointment.status = 'appointment_complete'
      }

      // Add machine room for hospital locations
      if (clinic.location?.id) {
        const availableRooms = screeningRooms.filter(
          (room) => room.locationId === clinic.location.id
        )
        if (availableRooms.length > 0) {
          const randomRoom = faker.helpers.arrayElement(availableRooms)
          appointment.mammogramData.machineRoom = randomRoom.displayName
        }
      }

      // Generate previous mammograms (recorded mammograms from other facilities)
      const previousMammograms = generatePreviousMammograms({
        appointmentDate: appointment.timing.actualEndTime || appointment.timing.actualStartTime,
        addedByUserId: appointment.sessionDetails.startedBy,
        rate: seedDataProfile?.previousMammograms?.rate
      })
      if (previousMammograms) {
        appointment.previousMammograms = previousMammograms
      }

      // Generate medical information (symptoms, medical history, etc.)
      // All attributed to the user who ran the appointment
      const medicalInformation = generateMedicalInformation({
        addedByUserId: appointment.sessionDetails.startedBy,
        config: participant.config,
        ...(seedDataProfile?.medicalInformation || {}),
        // Allow config to override probabilities for test scenarios
        ...(participant.config?.medicalInformation || {})
      })

      // Store medical information if any was generated
      if (Object.keys(medicalInformation).length > 0) {
        appointment.medicalInformation = medicalInformation
      }
    }

    // Generate medical information for in-progress appointments too
    // (they would have collected this during check-in/pre-screening)
    if (appointmentStatus === 'appointment_in_progress' && appointment.sessionDetails) {
      const medicalInformation = generateMedicalInformation({
        addedByUserId: appointment.sessionDetails.startedBy,
        config: participant.config,
        ...(seedDataProfile?.medicalInformation || {}),
        // Allow config to override probabilities for test scenarios
        ...(participant.config?.medicalInformation || {})
      })

      // Store medical information if any was generated
      if (Object.keys(medicalInformation).length > 0) {
        appointment.medicalInformation = medicalInformation
      }

      // Generate mammogram images if workflow indicates images have been taken
      if (appointment.workflowStatus?.['take-images'] === 'completed') {
        appointment.mammogramData = generateMammogramImages({
          startTime: dayjs(appointment.sessionDetails.startedAt),
          accessionNumber: appointment.accessionNumber,
          isSeedData: true,
          config: participant.config,
          scenarioWeights: seedDataProfile?.mammogram?.scenarioWeights,
          imperfectChanceForTechnicalOrIncomplete:
            seedDataProfile?.mammogram?.imperfectChanceForTechnicalOrIncomplete,
          notesForReaderChanceWithoutImperfect:
            seedDataProfile?.mammogram?.notesForReaderChanceWithoutImperfect
        })
      }
    }

    // Add session details for attended-not-screened appointments
    if (appointmentStatus === 'appointment_attended_not_screened') {
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

      appointment.sessionDetails = {
        startedAt: actualStartTime.toISOString(),
        startedBy: randomUser.id,
        endedAt: actualEndTime.toISOString()
      }
    }

    // Select image set for appointments with mammogram data
    // Done at the end so full appointment context (symptoms, implants, etc.) is available
    if (appointment.mammogramData) {
      const selectedSet = getImageSetForAppointment(appointment.id, 'diagrams', {
        appointment,
        contextualWeights:
          seedDataProfile?.imageSetSelection?.contextualTagWeights
      })
      if (selectedSet) {
        appointment.mammogramData.selectedSetId = selectedSet.id
      }
    }

    return appointment
  }

  return appointmentBase
}

module.exports = {
  generateAppointment
}
