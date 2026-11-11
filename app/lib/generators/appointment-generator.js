// app/lib/generators/appointment-generator.js

const generateId = require('../utils/id-generator')
const { faker } = require('@faker-js/faker')
const weighted = require('weighted')
const dayjs = require('dayjs')
const config = require('../../config')
const { STATUS_GROUPS, isCompleted } = require('../utils/status')
const { getStoppedReasons } = require('../utils/appointment-data')
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
const {
  getExpectedViews,
  hasMissingExpectedViews
} = require('../utils/expected-views')
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

// Some of the reasons the cancel form offers
// (app/views/appointments/cancel-or-reschedule-appointment/details.html)
const CANCELLATION_REASONS = [
  'Unable to attend',
  'Moving outside England',
  'Recent mammogram',
  'Medical reasons',
  'Has a symptomatic appointment'
]

// Session details in the shape the appointment workflow records them (see
// app/routes/appointments/lifecycle.js): the start, also recorded in authors,
// and for an appointment that has ended, when and by whom. The same
// mammographer runs it throughout.
const buildSessionDetails = ({ startedAt, startedBy, endedAt = null }) => ({
  startedAt: startedAt.toISOString(),
  startedBy,
  pausedAt: null,
  pausedBy: null,
  authors: [
    {
      userId: startedBy,
      action: 'started',
      timestamp: startedAt.toISOString()
    }
  ],
  ...(endedAt && {
    endedAt: endedAt.toISOString(),
    endedBy: startedBy
  })
})

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
      scheduled: 0.95,
      cancelled: 0.05
    })
  }

  // For past dates, select from final statuses
  // Note: partially_screened is excluded - determined by mammogram completeness instead
  if (slotDate.isBefore(currentDate)) {
    const weights = attendanceWeights
    return weighted.select({
      complete: weights.complete,
      did_not_attend: weights.didNotAttend,
      attended_not_screened: weights.attendedNotScreened,
      cancelled: weights.cancelled
    })
  }

  // For past slots, generate a status based on how long ago the slot was
  const minutesPassed = simulatedTime.diff(slotDateTime, 'minute')

  // Define probability weights for different statuses based on time passed
  if (minutesPassed <= 60) {
    // Within 30 mins of appointment
    return weighted.select({
      checked_in: 0.3,
      complete: 0.2,
      attended_not_screened: 0.1,
      scheduled: 0.4
    })
  } else {
    // More than 30 mins after appointment
    return weighted.select({
      complete: 0.6,
      attended_not_screened: 0.1,
      scheduled: 0.2
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
  seedDataProfile = null,
  checkInTime = null,
  mammographers = null,
  screenedAt = null
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

  // The mammographer running the appointment is picked from the clinic's small
  // team, so its screened list shows just two or three names; falls back to any
  // clinician if no team was passed.
  const pickMammographerId = () => {
    const pool = mammographers?.length
      ? mammographers
      : users.filter((user) => user.role.includes('clinician'))
    return faker.helpers.arrayElement(pool).id
  }

  // A clock time (e.g. "9:05") as a dayjs on the clinic day
  const onClinicDay = (clockTime) => {
    const [clockHours, clockMinutes] = clockTime.split(':')
    return slotDateTime
      .hour(parseInt(clockHours, 10))
      .minute(parseInt(clockMinutes, 10))
      .second(0)
      .millisecond(0)
  }

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
  // Note: partially_screened is determined by mammogram completeness, not selected here
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
    determineAppointmentStatus(
      slotDateTime,
      simulatedDateTime,
      attendanceWeights
    )

  // Override to in_progress if requested
  if (forceInProgress) {
    appointmentStatus = 'in_progress'
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
        status: 'scheduled',
        timestamp: dayjs(slot.dateTime).subtract(1, 'day').toISOString()
      }
    ]
  }

  // Add special appointment data if present
  if (specialAppointment) {
    appointmentBase.specialAppointment = specialAppointment
  }

  // A cancelled appointment records who cancelled it and why, and when in its
  // status history. Usually done by admin staff, after it was booked (a day
  // before the slot, see statusHistory above) and never after now
  if (appointmentStatus === 'cancelled') {
    let cancelledAt = slotDateTime.subtract(
      faker.number.int({ min: 60, max: 23 * 60 }),
      'minute'
    )
    if (cancelledAt.isAfter(simulatedDateTime)) {
      cancelledAt = simulatedDateTime.subtract(
        faker.number.int({ min: 5, max: 120 }),
        'minute'
      )
    }
    const adminUsers = users.filter((user) =>
      user.role.includes('administrative')
    )

    appointmentBase.statusHistory.push({
      status: 'cancelled',
      timestamp: cancelledAt.toISOString()
    })
    appointmentBase.cancellation = {
      reason: [faker.helpers.arrayElement(CANCELLATION_REASONS)],
      reschedule: weighted.select({ 'no-invite': 0.9, 'no-opt-out': 0.1 }),
      cancelledBy: adminUsers.length
        ? faker.helpers.arrayElement(adminUsers).id
        : pickMammographerId()
    }
  }

  // For in-progress appointments, add session details. Started a few minutes
  // before the simulated "now" so they sit on the clinic's timeline, after the
  // morning's completed appointments - an in-progress participant is the one
  // being screened right now, so they come last in the order of screening.
  if (appointmentStatus === 'in_progress') {
    const startedAt = screenedAt
      ? onClinicDay(screenedAt)
      : simulatedDateTime.subtract(
          faker.number.int({ min: 5, max: 45 }),
          'minutes'
        )

    appointmentBase.sessionDetails = buildSessionDetails({
      startedAt,
      startedBy: pickMammographerId()
    })

    // Add workflow status from participant config if provided
    if (participant.config?.workflowStatus) {
      appointmentBase.workflowStatus = participant.config.workflowStatus
    }
  }

  // For paused appointments, the same person started and paused it, as only
  // whoever is running an appointment can pause it. Started around its slot
  // and paused a few minutes later, both before now.
  if (appointmentStatus === 'paused') {
    const latestStart = simulatedDateTime.subtract(15, 'minute')
    let startedAt = screenedAt
      ? onClinicDay(screenedAt)
      : slotDateTime.add(faker.number.int({ min: 0, max: 5 }), 'minute')
    if (startedAt.isAfter(latestStart)) {
      startedAt = latestStart
    }
    const pausedAt = startedAt.add(
      faker.number.int({
        min: 5,
        max: Math.min(30, simulatedDateTime.diff(startedAt, 'minute') - 1)
      }),
      'minute'
    )
    // Not the default signed-in user, so the clinic list shows "Claim
    // appointment" rather than "Resume appointment"
    const defaultUserId = users[0].id
    const otherMammographers = (mammographers || []).filter(
      (user) => user.id !== defaultUserId
    )
    const runnerId = otherMammographers.length
      ? faker.helpers.arrayElement(otherMammographers).id
      : pickMammographerId()
    const sessionDetails = buildSessionDetails({
      startedAt,
      startedBy: runnerId
    })

    appointmentBase.sessionDetails = {
      ...sessionDetails,
      pausedAt: pausedAt.toISOString(),
      pausedBy: runnerId,
      authors: [
        ...sessionDetails.authors,
        {
          userId: runnerId,
          action: 'paused',
          timestamp: pausedAt.toISOString()
        }
      ]
    }
    appointmentBase.statusHistory.push(
      {
        status: 'checked_in',
        timestamp: startedAt
          .subtract(faker.number.int({ min: 2, max: 10 }), 'minute')
          .toISOString()
      },
      {
        status: 'in_progress',
        timestamp: startedAt.toISOString()
      },
      {
        status: 'paused',
        timestamp: pausedAt.toISOString()
      }
    )
  }

  if (
    !isPast &&
    !forceInProgress &&
    forceStatus !== 'in_progress' &&
    forceStatus !== 'paused' &&
    appointmentStatus !== 'checked_in'
  ) {
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
          appointmentStatus === 'attended_not_screened'
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

      // A scenario can pin when screening started, so the order of screening
      // can be made to differ from the scheduled time and check-in order
      const actualStartTime = screenedAt
        ? onClinicDay(screenedAt)
        : slotDateTime.add(actualStartOffset, 'minute')
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
      appointment.sessionDetails = buildSessionDetails({
        startedAt: actualStartTime,
        startedBy: pickMammographerId(),
        endedAt: actualEndTime
      })

      // Generate medical information (symptoms, medical history, etc.)
      // All attributed to the user who ran the appointment. Done before
      // images, as a mastectomy changes which views are expected
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

      // Add mammogram images for completed appointments
      appointment.mammogramData = generateMammogramImages({
        startTime: actualStartTime,
        accessionNumber: appointmentBase.accessionNumber,
        isSeedData: true,
        config: participant.config,
        expectedViews: getExpectedViews(appointment).views,
        scenarioWeights: seedDataProfile?.mammogram?.scenarioWeights,
        imperfectChanceForTechnicalOrIncomplete:
          seedDataProfile?.mammogram?.imperfectChanceForTechnicalOrIncomplete,
        notesForReaderChanceWithoutImperfect:
          seedDataProfile?.mammogram?.notesForReaderChanceWithoutImperfect
      })

      // Sync appointment status with mammogram completeness
      // If an expected view is missing, status should be partially_screened
      // If mammogram is complete but status was partially_screened, change to complete
      const isIncomplete = hasMissingExpectedViews(appointment)
      if (isIncomplete && appointment.status !== 'partially_screened') {
        appointment.status = 'partially_screened'
      } else if (!isIncomplete && appointment.status === 'partially_screened') {
        appointment.status = 'complete'
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
        appointmentDate:
          appointment.timing.actualEndTime ||
          appointment.timing.actualStartTime,
        addedByUserId: appointment.sessionDetails.startedBy,
        rate: seedDataProfile?.previousMammograms?.rate
      })
      if (previousMammograms) {
        appointment.previousMammograms = previousMammograms
      }
    }

    // Generate medical information for in-progress appointments too
    // (they would have collected this during check-in/pre-screening)
    if (appointmentStatus === 'in_progress' && appointment.sessionDetails) {
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
          expectedViews: getExpectedViews(appointment).views,
          scenarioWeights: seedDataProfile?.mammogram?.scenarioWeights,
          imperfectChanceForTechnicalOrIncomplete:
            seedDataProfile?.mammogram?.imperfectChanceForTechnicalOrIncomplete,
          notesForReaderChanceWithoutImperfect:
            seedDataProfile?.mammogram?.notesForReaderChanceWithoutImperfect
        })
      }
    }

    // Add session details for attended-not-screened appointments
    if (appointmentStatus === 'attended_not_screened') {
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

      appointment.sessionDetails = buildSessionDetails({
        startedAt: actualStartTime,
        startedBy: pickMammographerId(),
        endedAt: actualEndTime
      })

      // Stopping an appointment in the appointment flow requires reasons, so
      // seeded attended-not-screened appointments always have them
      appointment.appointmentStopped = {
        stoppedReason: [faker.helpers.arrayElement(getStoppedReasons()).value],
        needsReschedule: faker.helpers.arrayElement([
          'no-invite',
          'no-invite',
          'yes'
        ])
      }
    }

    // Record the check-in on checked-in appointments so the clinic list can
    // show the check-in time and how long the participant has been waiting.
    // A test scenario can pin the check-in to a clock time; otherwise arrival
    // is a few minutes either side of their slot. Never after now.
    if (appointmentStatus === 'checked_in') {
      let checkInDateTime = checkInTime
        ? onClinicDay(checkInTime)
        : slotDateTime.add(faker.number.int({ min: -5, max: 10 }), 'minute')
      if (checkInDateTime.isAfter(simulatedDateTime)) {
        checkInDateTime = simulatedDateTime.subtract(
          faker.number.int({ min: 1, max: 5 }),
          'minute'
        )
      }
      appointment.statusHistory = [
        ...appointment.statusHistory,
        {
          status: 'checked_in',
          timestamp: checkInDateTime.toISOString()
        }
      ]
    } else if (
      checkInTime &&
      (isCompleted(appointmentStatus) || appointmentStatus === 'in_progress')
    ) {
      // A screened participant was checked in before screening. A scenario can
      // pin that time so the check-in order can be made to differ from the
      // order of screening.
      appointment.statusHistory = [
        ...appointment.statusHistory,
        {
          status: 'checked_in',
          timestamp: onClinicDay(checkInTime).toISOString()
        }
      ]
    }

    // Select image set for appointments with mammogram data
    // Done at the end so full appointment context (symptoms, implants, etc.) is available
    if (appointment.mammogramData) {
      const selectedSet = getImageSetForAppointment(
        appointment.id,
        'diagrams',
        {
          appointment,
          contextualWeights:
            seedDataProfile?.imageSetSelection?.contextualTagWeights
        }
      )
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
