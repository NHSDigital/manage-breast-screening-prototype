// app/lib/utils/clinics.js

const dayjs = require('dayjs')

const config = require('../../config')
const dataStore = require('../data-store')

/**
 * Get a clinic by ID
 *
 * Reads the session's changed records first, then the shared store's id
 * index, so it avoids a linear scan of the merged clinics array. Falls back
 * to scanning data.clinics for records that exist only in the passed data.
 *
 * @param {object} data - Session data
 * @param {string} clinicId - Clinic ID
 * @returns {object | null} Clinic object or null if not found
 */
const getClinic = (data, clinicId) => {
  return (
    data._changes?.clinics?.[clinicId] ??
    dataStore.state.clinicsById.get(clinicId) ??
    data.clinics?.find((c) => c.id === clinicId) ??
    null
  )
}

/**
 * Where a clinic was held, as one line.
 *
 * A mobile unit is named by both the unit and the site it was parked at, since
 * the unit alone doesn't say where anyone went. Templates have long written
 * this inline as `location.name at clinic.siteName`; this is the same rule in
 * one place, for callers that only want the string.
 *
 * @param {object} data - Session data
 * @param {object} clinic - Clinic object
 * @returns {string} Display name, or an empty string if it can't be resolved
 */
const getClinicLocationName = (data, clinic) => {
  if (!clinic) return ''

  const unit = (data.breastScreeningUnits || []).find(
    (candidate) => candidate.id === clinic.breastScreeningUnitId
  )
  const location = (unit?.locations || []).find(
    (candidate) => candidate.id === clinic.locationId
  )

  if (!location) return clinic.siteName || ''

  return location.type === 'mobile_unit' && clinic.siteName
    ? `${location.name} at ${clinic.siteName}`
    : location.name
}

/**
 * Get a breast screening unit's name by id.
 *
 * For places that only have a unit id and no clinic to hang a full location
 * name off - historic episodes, which have no appointment or clinic record.
 *
 * @param {object} data - Session data
 * @param {string} unitId - Breast screening unit id
 * @returns {string} Unit name, or an empty string if it can't be resolved
 */
const getBreastScreeningUnitName = (data, unitId) => {
  const unit = (data.breastScreeningUnits || []).find(
    (candidate) => candidate.id === unitId
  )
  return unit?.name || ''
}

/**
 * Get today's clinics
 *
 * @param {Array} clinics - Array of all clinics
 * @returns {Array} Clinics scheduled for today
 */
const getTodaysClinics = (clinics) => {
  const today = dayjs().startOf('day')
  return clinics.filter((c) => dayjs(c.date).isSame(today, 'day'))
}

/**
 * Get appointments for a specific clinic
 *
 * @param {Array} appointments - Array of all appointments
 * @param {string} clinicId - Clinic ID to filter by
 * @returns {Array} Appointments belonging to the given clinic
 */
const getClinicAppointments = (appointments, clinicId) => {
  if (!appointments || !clinicId) return []
  // console.log(`Looking for appointments with clinicId: ${clinicId}`);
  // console.log(`Found ${appointments.filter(e => e.clinicId === clinicId).length} appointments`);
  return appointments.filter((e) => e.clinicId === clinicId)
}

/**
 * The next order-of-screening number for a clinic: one more than the highest
 * already assigned, or 1 if none. Numbers are never reused, so a removed or
 * changed appointment leaves a gap rather than renumbering the rest.
 *
 * @param {object} data - Session data
 * @param {string} clinicId - Clinic ID
 * @returns {number} The next screening order number
 */
const getNextScreeningOrder = (data, clinicId) => {
  const clinicAppointments = getClinicAppointments(data.appointments, clinicId)
  const highest = clinicAppointments.reduce((max, appointment) => {
    const order = appointment.screeningOrder
    return typeof order === 'number' && order > max ? order : max
  }, 0)
  return highest + 1
}

/**
 * Which broken-out columns the clinic appointments table shows for a tab.
 * Shared by the table header, the row macro and the sort logic so the three
 * never fall out of step.
 *
 * @param {string} filter - The tab id (e.g. 'remaining', 'complete', 'all')
 * @returns {{checkedIn: boolean, screenedBy: boolean, completed: boolean, actions: boolean}}
 */
const getClinicTableColumns = (filter) => {
  return {
    // Remaining and Checked in show the check-in time as its own column
    checkedIn: filter === 'remaining' || filter === 'checked-in',
    // In progress, Complete and All show the mammographer and screening order
    screenedBy:
      filter === 'in-progress' || filter === 'complete' || filter === 'all',
    // Complete and All show when each appointment finished
    completed: filter === 'complete' || filter === 'all',
    // Completed appointments are all final, so there is nothing to action
    actions: filter !== 'complete'
  }
}

/**
 * Format clinic time slot
 *
 * @param {string} dateTime - ISO date string
 * @returns {string} Time formatted as HH:MM
 */
const formatTimeSlot = (dateTime) => {
  const date = new Date(dateTime)
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * Calculate the end time of a slot
 *
 * @param {string} slotDateTime - ISO date string
 * @returns {Date} End time of slot
 */
const getSlotEndTime = (slotDateTime) => {
  const date = new Date(slotDateTime)
  date.setMinutes(date.getMinutes() + config.clinics.slotDurationMinutes)
  return date
}

/**
 * Get clinic opening hours
 *
 * @param {object} clinic - Clinic object
 * @returns {object} Start and end times as Date objects
 */
const getClinicHours = (clinic) => {
  if (!clinic?.slots?.length) return null

  const firstSlot = clinic.slots[0]
  const lastSlot = clinic.slots[clinic.slots.length - 1]

  return {
    start: new Date(firstSlot.dateTime),
    end: getSlotEndTime(lastSlot.dateTime)
  }
}

/**
 * Get clinics filtered by time period
 *
 * @param {Array} clinics - Array of all clinics
 * @param {string} [filter='all'] - Filter to apply: 'today', 'upcoming', 'completed', or 'all'; excludes clinics older than 2 weeks
 * @returns {Array} Filtered and sorted clinics
 */
const getFilteredClinics = (clinics, filter = 'all') => {
  const today = dayjs().startOf('day')

  const twoWeeksAgo = today.subtract(2, 'weeks')

  // First filter out clinics older than 2 weeks
  const recentClinics = clinics.filter((clinic) =>
    dayjs(clinic.date).isAfter(twoWeeksAgo, 'day')
  )

  switch (filter) {
    case 'today':
      return recentClinics.filter(
        (clinic) =>
          dayjs(clinic.date).isSame(today, 'day') && clinic.status !== 'closed'
      )

    case 'upcoming':
      return recentClinics
        .filter((clinic) => dayjs(clinic.date).isAfter(today, 'day'))
        .sort((a, b) => new Date(a.date) - new Date(b.date))

    case 'completed':
      return recentClinics
        .filter(
          (clinic) =>
            dayjs(clinic.date).isBefore(today, 'day') ||
            (dayjs(clinic.date).isSame(today, 'day') &&
              clinic.status === 'closed')
        )
        .sort((a, b) => new Date(b.date) - new Date(a.date)) // Most recent first

    case 'all':
    default:
      return [...recentClinics].sort(
        (a, b) => new Date(a.date) - new Date(b.date)
      )
  }
}

/**
 * Find and update a clinic in session data
 *
 * @param {object} data - Session data
 * @param {string} clinicId - Clinic ID
 * @param {object} updates - Fields to merge into the clinic
 * @returns {object | null} Updated clinic or null if not found
 */
const updateClinic = (data, clinicId, updates) => {
  const clinicIndex = data.clinics.findIndex((c) => c.id === clinicId)
  if (clinicIndex === -1) return null

  // Update in the attached array (same-request reads) and record the change
  // in data._changes (persistence - the attached array is rebuilt from the
  // shared data store on every request; see middleware in app/routes.js)
  const updatedClinic = { ...data.clinics[clinicIndex], ...updates }
  data.clinics[clinicIndex] = updatedClinic
  if (data._changes?.clinics) {
    data._changes.clinics[clinicId] = updatedClinic
  }
  return updatedClinic
}

module.exports = {
  getClinic,
  getClinicLocationName,
  getBreastScreeningUnitName,
  getTodaysClinics,
  getFilteredClinics,
  getClinicAppointments,
  getNextScreeningOrder,
  getClinicTableColumns,
  formatTimeSlot,
  getClinicHours,
  updateClinic
}
