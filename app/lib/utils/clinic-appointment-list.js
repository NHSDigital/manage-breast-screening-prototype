// app/lib/utils/clinic-appointment-list.js
//
// The filters on a clinic's appointment list, declared as filter groups for
// the generic helpers in filter-list.js. Rows are the clinic's appointments.
//
// Mirrors participant-list.js and reading-case-list.js, which do the same job
// for their lists.

const { isSpecialAppointment } = require('./status')
const { isFirstScreening, isLastScreening } = require('./episodes')
const { getAppointmentRunByIds } = require('./roles-and-permissions')

/**
 * The mammographers an appointment counts for when filtering: everyone who ran
 * it and whoever was nominated to take its images
 *
 * @param {object} appointment - Appointment object
 * @returns {Array<string>} User ids
 */
const getAppointmentMammographerIds = (appointment) =>
  [
    ...getAppointmentRunByIds(appointment),
    appointment?.authorisedMammographerId
  ].filter(Boolean)

/**
 * The filters offered on a clinic's appointment list.
 *
 * The mammographer options come from the clinic's own appointments, so they
 * are only the people working that clinic. Sorted by first name.
 *
 * @param {object} data - Session data
 * @param {Array} appointments - The clinic's appointments
 * @returns {Array} Filter groups
 */
const getClinicFilterGroups = (data = {}, appointments = []) => {
  const appointmentTypeMatchers = {
    special: (appointment) => isSpecialAppointment(appointment),
    new: (appointment) => isFirstScreening(appointment, data),
    final: (appointment) => isLastScreening(appointment, data)
  }

  const mammographerIds = [
    ...new Set(appointments.flatMap(getAppointmentMammographerIds))
  ]
  const mammographers = mammographerIds
    .map((userId) => (data.users || []).find((user) => user.id === userId))
    .filter(Boolean)
    .sort((a, b) => a.firstName.localeCompare(b.firstName))

  return [
    {
      name: 'appointmentType',
      legend: 'Appointment type',
      options: [
        { value: 'special', label: 'Special appointments' },
        { value: 'new', label: 'New to screening' },
        { value: 'final', label: 'Final screening invite' }
      ],
      matches: (appointment, values) =>
        values.some((value) => appointmentTypeMatchers[value](appointment))
    },
    {
      name: 'mammographer',
      legend: 'Mammographers',
      options: mammographers.map((user) => ({
        value: user.id,
        label: `${user.firstName} ${user.lastName}`
      })),
      matches: (appointment, values) =>
        getAppointmentMammographerIds(appointment).some((userId) =>
          values.includes(userId)
        )
    }
  ]
}

module.exports = {
  getAppointmentMammographerIds,
  getClinicFilterGroups
}
