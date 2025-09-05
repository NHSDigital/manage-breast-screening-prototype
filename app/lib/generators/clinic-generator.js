// app/lib/generators/clinic-generator.js

const { faker } = require('@faker-js/faker')
const dayjs = require('dayjs')
const weighted = require('weighted')

const config = require('../../config')
const generateId = require('../utils/id-generator')

const determineClinicType = (location, breastScreeningUnit) => {
  // First check location-specific service types
  const clinicTypes = location.clinicTypes || breastScreeningUnit.clinicTypes

  // If still no service types, default to screening
  if (!clinicTypes) {
    return 'screening'
  }

  // If location/BSU only supports one service type, use that
  if (clinicTypes.length === 1) {
    return clinicTypes[0]
  }

  // For locations that can do both, equal weighting
  // In practice we'll have more screening because mobile units
  // don't doo assessment
  return weighted.select({
    screening: 0.5,
    assessment: 0.5
  })
}

const generateClinicCode = () => {
  // Example format: AB123 where AB is one of an array.
  const prefixOptions = ['CH', 'MU', 'WS']
  const suffix = faker.number.int({ min: 100, max: 999 })
  return `${faker.helpers.arrayElement(prefixOptions)}${suffix}`
}

const generateTimeSlots = (date, sessionTimes, clinicType) => {
  const { slotDurationMinutes } = config.clinics
  const today = dayjs().startOf('day')
  const clinicDate = dayjs(date).startOf('day')
  const isToday = clinicDate.isSame(today)

  const slots = []
  const dateStr = dayjs(date).format('YYYY-MM-DD')
  const startTime = dayjs(`${dateStr}T${sessionTimes.startTime}`).toDate()
  const endTime = dayjs(`${dateStr}T${sessionTimes.endTime}`).toDate()
  const currentTime = new Date(startTime)

  // Calculate how many slots should be double-booked
  const totalSlots = Math.floor(
    (endTime - startTime) / (slotDurationMinutes * 60000)
  )
  let doubleBookedSlotsNeeded = 0

  // Screening clinics can be 'smart' - allows for some overbooking
  // Scope to 'today' only to limit the number for prototype performance
  if (isToday && clinicType === 'screening') {
    const targetBookingPercent = config.clinics.targetBookingPercent
    const extraBookingsNeeded = Math.ceil(
      ((targetBookingPercent - 100) * totalSlots) / 100
    )
    doubleBookedSlotsNeeded = extraBookingsNeeded
  }

  // Create array of indices that will be double-booked
  const doubleBookedSlotIndices = new Set()
  while (doubleBookedSlotIndices.size < doubleBookedSlotsNeeded) {
    const randomIndex = Math.floor(Math.random() * totalSlots)
    doubleBookedSlotIndices.add(randomIndex)
  }

  // eslint-disable-next-line no-unmodified-loop-condition
  let slotIndex = 0
  while (currentTime < endTime) {
    const slotId = generateId()
    const slotStartTime = new Date(currentTime)
    const slotEndTime = new Date(currentTime)
    slotEndTime.setMinutes(slotEndTime.getMinutes() + slotDurationMinutes)

    // Determine if this slot should be double-booked
    const capacity = doubleBookedSlotIndices.has(slotIndex) ? 2 : 1

    slots.push({
      id: slotId,
      dateTime: slotStartTime.toISOString(),
      endDateTime: slotEndTime.toISOString(),
      duration: slotDurationMinutes,
      type: clinicType,
      capacity,
      bookedCount: 0,
      period: `${sessionTimes.startTime}-${sessionTimes.endTime}`
    })
    currentTime.setMinutes(currentTime.getMinutes() + slotDurationMinutes)
    slotIndex++
  }
  return slots
}

const determineClinicStatus = (date) => {
  const now = dayjs()
  const clinicDate = dayjs(date).startOf('day')
  const today = now.startOf('day')

  if (clinicDate.isBefore(today)) {
    return 'closed'
  }
  if (clinicDate.isSame(today, 'day')) {
    return 'in_progress'
  }

  return 'scheduled'
}

const generateMobileSiteName = () => {
  const sites = [
    'Tesco Extra Banbury',
    'Witney Community Hospital',
    'Thame Community Hospital',
    'Bicester Community Hospital',
    "Sainsbury's Kidlington",
    'Carterton Health Centre',
    'Wantage Community Hospital',
    'Tesco Faringdon',
    'Didcot Civic Hall',
    'Chipping Norton Health Centre'
  ]

  return faker.helpers.arrayElement(sites)
}

const determineSessionType = (sessionTimes) => {
  const startHour = parseInt(sessionTimes.startTime.split(':')[0], 10)
  const endHour = parseInt(sessionTimes.endTime.split(':')[0], 10)

  // If clinic spans 6 or more hours, consider it all day
  const duration = endHour - startHour
  if (duration >= 6) {
    return 'all day'
  }

  // For shorter sessions, determine morning or afternoon based on start time
  return startHour < 12 ? 'morning' : 'afternoon'
}

const generateClinic = (
  date,
  location,
  breastScreeningUnit,
  sessionTimes,
  overrides = null,
  id = null
) => {
  const clinicType =
    overrides?.clinicType || determineClinicType(location, breastScreeningUnit)
  const slots = generateTimeSlots(date, sessionTimes, clinicType)

  // Get supported risk levels - intersect BSU and location capabilities
  const riskLevels = location.riskLevelHandling
    ? location.riskLevelHandling.filter((risk) =>
        breastScreeningUnit.riskLevelHandling.includes(risk)
      )
    : breastScreeningUnit.riskLevelHandling

  // Check if clinic is for today
  const today = dayjs().startOf('day')
  const clinicDate = dayjs(date).startOf('day')
  const isToday = clinicDate.isSame(today, 'day')

  if (isToday) {
    console.log(
      `Generating clinic for today: ${clinicDate.format('YYYY-MM-DD')}, date: ${date}`
    )
  }

  // Calculate total slots based on capacity
  const totalSlots =
    slots.length * (isToday && clinicType !== 'assessment' ? 2 : 1)

  return {
    id: id || generateId(),
    clinicCode: generateClinicCode(),
    date: clinicDate.format('YYYY-MM-DD'),
    breastScreeningUnitId: breastScreeningUnit.id,
    locationType: location.type,
    clinicType,
    riskLevels,
    locationId: location.id,
    siteName: location.type === 'mobile_unit' ? generateMobileSiteName() : null,
    slots,
    status: determineClinicStatus(date),
    staffing: {
      mammographers: [],
      radiologists: [],
      support: []
    },
    targetCapacity: {
      bookingPercent:
        clinicType === 'assessment' ? 100 : config.clinics.targetBookingPercent,
      attendancePercent:
        clinicType === 'assessment'
          ? 95
          : config.clinics.targetAttendancePercent,
      totalSlots
    },
    notes: null,
    sessionTimes,
    sessionType: determineSessionType(sessionTimes)
  }
}

const generateClinicsForBSU = ({ date, breastScreeningUnit }) => {
  // Each location has an 95% chance of running clinics on any given day
  const selectedLocations = breastScreeningUnit.locations.filter(
    () => Math.random() < 0.95
  )

  // Check if this is today's generation
  const isToday = dayjs(date).startOf('day').isSame(dayjs().startOf('day'))

  // Check if this is the first clinic of today - used to assign a specific ID
  let isFirstClinicOfToday = isToday // Only track this for today
  const firstClinicHardcodedId = 'wtrl7jud' // Hardcoded ID for the first clinic of today

  // Generate clinics for each selected location
  return selectedLocations.flatMap((location, locationIndex) => {
    // Use location-specific patterns if available, otherwise use BSU patterns
    const sessionPatterns =
      location.sessionPatterns || breastScreeningUnit.sessionPatterns

    // Randomly select a pattern
    const selectedPattern = faker.helpers.arrayElement(sessionPatterns)

    if (selectedPattern.type === 'single') {
      // For single sessions, create one clinic
      const clinic = generateClinic(
        date,
        location,
        breastScreeningUnit,
        selectedPattern.sessions[0],
        isToday && locationIndex === 0 ? { clinicType: 'screening' } : null,
        isFirstClinicOfToday ? firstClinicHardcodedId : null
      )
      isFirstClinicOfToday = false
      return [clinic]
    } else {
      // For paired sessions, create two clinics
      return selectedPattern.sessions.map(() => {
        const clinic = generateClinic(
          date,
          location,
          breastScreeningUnit,
          selectedPattern.sessions[0],
          isToday && locationIndex === 0 ? { clinicType: 'screening' } : null,
          isFirstClinicOfToday ? firstClinicHardcodedId : null
        )
        isFirstClinicOfToday = false
        return clinic
      })
    }
  })
}

module.exports = {
  generateClinicsForBSU
}
