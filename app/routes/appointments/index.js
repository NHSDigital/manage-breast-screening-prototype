// app/routes/appointments/index.js
//
// Appointment routes, split by concern. The context middleware here runs
// before every appointment route (temp working copies of the appointment and
// participant, plus locals); the dynamic template fallback registers last so
// specific routes always win.

const _ = require('lodash')
const {
  getAppointmentData
} = require('../../lib/utils/appointment-data')
const { createDynamicTemplateRoute } = require('../../lib/utils/dynamic-routing')
const { isAppointmentWorkflow } = require('../../lib/utils/status')

module.exports = (router) => {
  // Set clinics to active in nav for all urls starting with /clinics
  router.use('/clinics/:clinicId/appointments/:appointmentId', (req, res, next) => {
    const appointmentId = req.params.appointmentId
    const clinicId = req.params.clinicId
    const originalAppointmentData = getAppointmentData(req.session.data, clinicId, appointmentId)
    const data = req.session.data

    if (!originalAppointmentData) {
      console.log(`No appointment ${appointmentId} found for clinic ${clinicId}`)
      res.redirect('/clinics/' + clinicId)
      return
    }

    // We store a temporary copy of the appointment to session for use by forms
    // If it doens't exist, create it now
    if (!data.appointment || data.appointment?.id !== appointmentId) {
      if (!data.appointment) {
        console.log('No temp appointment data found, creating new one')
      } else if (data.appointment?.id !== appointmentId) {
        console.log(
          `Temp appointment data found, but appointmentId ${data.appointment.id} does not match ${appointmentId}, creating new one`
        )
      }
      // Copy over the appointment data to the temp appointment.
      // Must be a deep clone: the temp copy gets mutated by forms, and the
      // source record is shared (read-only) data that other sessions see.
      data.appointment = structuredClone(originalAppointmentData.appointment)
    }

    const participantId = originalAppointmentData.participant.id
    if (!data.participant || data.participant?.id !== participantId) {
      if (!data.participant) {
        console.log('No temp participant data found, creating new one')
      } else if (data.participant?.id !== participantId) {
        console.log(
          `Temp participant data found, but participantId ${data.participant.id} does not match ${participantId}, creating new one`
        )
      }
      // Copy over the participant data to the temp participant.
      // Deep clone - a shallow spread would leave nested objects
      // (demographicInformation etc) shared with the read-only source record.
      data.participant = structuredClone(originalAppointmentData.participant)
    }

    // Deep compare temp participant and saved participant in array
    const savedParticipant = data.participants.find(
      (p) => p.id === data.participant.id
    )
    res.locals.participantHasUnsavedChanges = !_.isEqual(
      data.participant,
      savedParticipant
    )

    // Deep compare temp appointment and saved appointment in array, excluding workflowStatus
    const savedAppointment = data.appointments.find((appointment) => appointment.id === data.appointment.id)
    const tempAppointmentForCompare = data.appointment ? { ...data.appointment } : undefined
    const savedAppointmentForCompare = savedAppointment ? { ...savedAppointment } : undefined
    if (tempAppointmentForCompare) delete tempAppointmentForCompare.workflowStatus
    if (savedAppointmentForCompare) delete savedAppointmentForCompare.workflowStatus
    res.locals.appointmentHasUnsavedChanges = !_.isEqual(
      tempAppointmentForCompare,
      savedAppointmentForCompare
    )

    // This will now have any temp appointment data that forms have added too
    // We'll later save this back to the source data
    res.locals.appointment = data.appointment

    res.locals.appointmentData = originalAppointmentData

    // Attach location to clinic for template convenience
    const clinic = { ...originalAppointmentData.clinic }
    if (originalAppointmentData.location) {
      clinic.location = originalAppointmentData.location
    }
    res.locals.clinic = clinic

    res.locals.isAppointmentWorkflow = isAppointmentWorkflow(
      data.appointment,
      data.currentUser
    )

    res.locals.participant = data.participant
    res.locals.participantId = participantId
    res.locals.originalParticipant = savedParticipant
    res.locals.appointmentUrl = `/clinics/${clinicId}/appointments/${appointmentId}`
    res.locals.contextUrl = `/clinics/${clinicId}/appointments/${appointmentId}`
    res.locals.pageContext = 'appointment'
    res.locals.unit = originalAppointmentData.unit
    res.locals.clinicId = clinicId
    res.locals.appointmentId = appointmentId

    // Ensure latest session data is available to views
    res.locals.data = req.session.data

    next()
  })

  require('./lifecycle')(router)
  require('./participant-details')(router)
  require('./previous-mammograms')(router)
  require('./symptoms')(router)
  require('./medical-information')(router)
  require('./medical-history')(router)
  require('./imaging-automatic')(router)
  require('./imaging-manual')(router)
  require('./special-appointments')(router)
  require('./appointment-notes')(router)
  require('./cancel-reschedule')(router)

  // General purpose dynamic template route for appointments
  // This should come after any more specific routes
  router.get(
    '/clinics/:clinicId/appointments/:appointmentId/*subPaths',
    createDynamicTemplateRoute({
      templatePrefix: 'appointments'
    })
  )
}
