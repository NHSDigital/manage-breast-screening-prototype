// app/lib/generators/previous-mammogram-generator.js

const generateId = require('../utils/id-generator')
const { faker } = require('@faker-js/faker')
const weighted = require('weighted')
const dayjs = require('dayjs')
const config = require('../../config')
const allBSUs = require('../../data/all-breast-screening-units')
const users = require('../../data/users')

// Where the mammogram was taken
const locationWeights = {
  bsu: 0.55, // Another BSU in England - most common, requestable
  otherUk: 0.2, // Other UK facility (private, symptomatic clinic, etc.)
  otherNonUk: 0.15, // Abroad - typically not requestable
  currentBsu: 0.1 // Current BSU but not in screening records
}

// Request statuses for seed data
// Represents state after admin triage
const requestStatusWeights = {
  not_requested: 0.35, // Not yet triaged
  requested: 0.25, // Admin has requested, awaiting arrival
  received: 0.15, // Images have arrived
  not_available: 0.15, // Can't get them (abroad, too old, etc.)
  not_needed: 0.1 // Decided we don't need them
}

// For mammograms from abroad, status is limited
const abroadStatusWeights = {
  not_requested: 0.3,
  not_available: 0.5, // Most abroad mammograms can't be obtained
  not_needed: 0.2
}

// Generate a single previous mammogram entry
// latestAllowedDate controls the upper bound for when the mammogram was taken
const generatePreviousMammogram = ({
  eventDate,
  addedByUserId,
  latestAllowedDate
}) => {
  const location = weighted.select(locationWeights)

  // Date must be at least 6 months before the event, and within 3 years
  const eventDay = dayjs(eventDate)
  const latestDate = latestAllowedDate
    ? dayjs(latestAllowedDate)
    : eventDay.subtract(6, 'month')
  const earliestDate = eventDay.subtract(3, 'year')
  const dateTaken = dayjs(
    faker.date.between({
      from: earliestDate.toDate(),
      to: latestDate.toDate()
    })
  )

  // Build location details
  const locationDetails = {}
  if (location === 'bsu') {
    locationDetails.bsu = faker.helpers.arrayElement(allBSUs)
  } else if (location === 'otherUk') {
    locationDetails.otherUk = faker.helpers.arrayElement([
      'Private clinic',
      'Symptomatic breast clinic',
      'Hospital radiology department',
      'GP referral imaging'
    ])
  } else if (location === 'otherNonUk') {
    locationDetails.otherNonUk = faker.helpers.arrayElement([
      'Spain',
      'France',
      'Germany',
      'USA',
      'Australia',
      'India',
      'Poland',
      'Italy'
    ])
  }

  // Most participants know when their mammogram was
  // All generated mammograms are 6+ months old, so lessThanSixMonths is not used
  const dateType = weighted.select({
    dateKnown: 0.75,
    moreThanSixMonths: 0.25
  })

  const dateFields = {}
  if (dateType === 'dateKnown') {
    dateFields.dateTaken = {
      day: String(dateTaken.date()),
      month: String(dateTaken.month() + 1),
      year: String(dateTaken.year())
    }
  }

  // Determine request status - abroad mammograms have different weights
  const isAbroad = location === 'otherNonUk'
  const requestStatus = weighted.select(
    isAbroad ? abroadStatusWeights : requestStatusWeights
  )

  // Build request tracking fields
  const requestFields = {
    requestStatus
  }

  if (requestStatus === 'requested' || requestStatus === 'received') {
    // Pick an admin user who made the request
    const adminUsers = users.filter((user) =>
      user.role.some((r) => ['administrator', 'service_manager'].includes(r))
    )
    const requestUser =
      adminUsers.length > 0
        ? faker.helpers.arrayElement(adminUsers)
        : { id: addedByUserId }

    // Request was made 1-5 days after the event
    const requestedDate = dayjs(eventDate).add(
      faker.number.int({ min: 1, max: 5 }),
      'day'
    )
    requestFields.requestedDate = requestedDate.toISOString()
    requestFields.requestedBy = requestUser.id
  }

  if (requestStatus === 'received') {
    // Received 3-14 days after request
    const receivedDate = dayjs(requestFields.requestedDate).add(
      faker.number.int({ min: 3, max: 14 }),
      'day'
    )
    requestFields.receivedDate = receivedDate.toISOString()
    requestFields.statusChangedDate = receivedDate.toISOString()
    requestFields.statusChangedBy = requestFields.requestedBy
  }

  if (requestStatus === 'not_available' || requestStatus === 'not_needed') {
    // Status was changed 1-7 days after event
    const changedDate = dayjs(eventDate).add(
      faker.number.int({ min: 1, max: 7 }),
      'day'
    )
    requestFields.statusChangedDate = changedDate.toISOString()

    const adminUsers = users.filter((user) =>
      user.role.some((r) => ['administrator', 'service_manager'].includes(r))
    )
    requestFields.statusChangedBy =
      adminUsers.length > 0
        ? faker.helpers.arrayElement(adminUsers).id
        : addedByUserId
  }

  return {
    id: generateId(),
    location,
    ...locationDetails,
    dateType,
    ...dateFields,
    sameName: weighted.select({ sameName: 0.85, differentName: 0.15 }),
    dateAdded: dayjs(eventDate).toISOString(),
    addedBy: addedByUserId,
    _rawDate: dateTaken.toISOString(), // Internal field for gap calculations
    ...requestFields
  }
}

// Generate previous mammograms for an event
// Returns an array, or null if none generated
const generatePreviousMammograms = ({ eventDate, addedByUserId }) => {
  const rate = config.generation?.previousMammogramRate ?? 0.2

  // Decide whether this event has reported mammograms
  if (Math.random() > rate) {
    return null
  }

  // 1 or 2 mammograms - weighted 75/25
  const count = weighted.select({ 1: 0.75, 2: 0.25 })

  const mammograms = []
  for (let index = 0; index < parseInt(count); index++) {
    // For the second mammogram, ensure at least 6 months gap from the first
    let latestAllowedDate = null
    if (index > 0) {
      const previousDate = dayjs(mammograms[index - 1]._rawDate)
      latestAllowedDate = previousDate.subtract(6, 'month')
    }
    mammograms.push(
      generatePreviousMammogram({ eventDate, addedByUserId, latestAllowedDate })
    )
  }

  // Remove internal _rawDate field before returning
  return mammograms.map(({ _rawDate, ...rest }) => rest)

  return mammograms
}

module.exports = {
  generatePreviousMammograms,
  generatePreviousMammogram
}
