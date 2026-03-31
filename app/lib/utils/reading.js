// app/lib/utils/.js

const dayjs = require('dayjs')
const { eligibleForReading, getStatusTagColour } = require('./status')
const { isWithinDayRange } = require('./dates')
const { awaitingPriors, userRequestedPriors } = require('./prior-mammograms')

// /**
//  * Get first unread event in a clinic
//  */
// const getFirstUnreadEvent = (data, clinicId) => {
//   return data.events.find(event =>
//     event.clinicId === clinicId &&
//     eligibleForReading(event) &&
//     !event.reads?.length
//   ) || null
// }

// /**
//  * Get first unread event from first available clinic
//  */
// const getFirstUnreadEventOverall = (data) => {
//   const firstClinic = getFirstAvailableClinic(data)
//   if (!firstClinic) return null

//   return getFirstUnreadEvent(data, firstClinic.id)
// }

/************************************************************************
// Single event
//***********************************************************************

/**
 * Get reading metadata for an event
 * @param {Object} event - The event to check
 * @returns {Object} Object with reading metadata
 */
const getReadingMetadata = (event) => {
  // Get all reads from the imageReading structure
  const reads = event.imageReading?.reads
    ? Object.values(event.imageReading.reads)
    : []
  const readerIds = reads.map((read) => read.readerId)
  const uniqueReaderCount = new Set(readerIds).size

  // Get all unique opinions from reads
  const opinions = reads.map((read) => read.opinion)
  const uniqueOpinions = [...new Set(opinions)].filter(Boolean) // Filter out undefined

  // Discordance: richer than just comparing opinion strings — also checks TR views and RFA breast assessments
  const isDiscordant =
    reads.length >= 2 ? areReadsDiscordant(reads[0], reads[1]) : false

  return {
    readCount: reads.length,
    uniqueReaderCount,
    firstReadComplete: reads.length >= 1,
    secondReadComplete: reads.length >= 2,
    isDiscordant,
    opinions: uniqueOpinions
  }
}

/**
 * Get all reads for an event as an ordered array
 * Sorted by readNumber if available, otherwise by timestamp
 * @param {Object} event - The event to get reads for
 * @returns {Array} Array of read objects sorted by read order
 */
const getReadsAsArray = function (event) {
  if (!event?.imageReading?.reads) {
    return []
  }

  return Object.values(event.imageReading.reads).sort((a, b) => {
    // Sort by readNumber if both have it
    if (a.readNumber && b.readNumber) {
      return a.readNumber - b.readNumber
    }
    // Fall back to timestamp
    return new Date(a.timestamp) - new Date(b.timestamp)
  })
}

/**
 * Update the writeReading function to also handle removing from skipped events
 *
 * @param {object} event - The event to update
 * @param {string} userId - User ID
 * @param {object} reading - Reading data to save
 * @param {object | null} [data] - Session data (needed for batch context)
 * @param {string | null} [batchId] - Batch ID (if in batch context)
 */
const writeReading = (event, userId, reading, data = null, batchId = null) => {
  // Ensure imageReading structure exists
  if (!event.imageReading) {
    event.imageReading = { reads: {} }
  } else if (!event.imageReading.reads) {
    event.imageReading.reads = {}
  }

  // Calculate readNumber based on existing reads
  const existingReadCount = Object.keys(event.imageReading.reads).length
  // If this user already has a read, keep their readNumber; otherwise assign next number
  const existingRead = event.imageReading.reads[userId]
  const readNumber = existingRead?.readNumber || existingReadCount + 1

  // Add the reading with timestamp and readNumber
  event.imageReading.reads[userId] = {
    ...reading,
    readerId: userId, // Ensure the reader ID is saved
    readNumber,
    timestamp: new Date().toISOString()
  }

  // If we have batch context, remove this event from skipped events
  if (data && batchId && data.readingSessionBatches?.[batchId]) {
    const batch = data.readingSessionBatches[batchId]

    // Remove event from skipped list if present
    const skippedIndex = batch.skippedEvents.indexOf(event.id)
    if (skippedIndex !== -1) {
      batch.skippedEvents.splice(skippedIndex, 1)
    }
  }
}

/************************************************************************
// Multiple events
//***********************************************************************

/**
 * Enhance events with pre-calculated reading metadata
 * @param {Array} events - Array of events to enhance
 * @param {Array} participants - Array of participants for lookups
 * @param {string} userId - Current user ID
 * @returns {Array} Enhanced events with pre-calculated metadata
 */
const enhanceEventsWithReadingData = (events, participants, userId) => {
  // Create a lookup map for participants
  const participantMap = new Map(participants.map((p) => [p.id, p]))

  // Enhanced events with pre-calculated metadata
  return events.map((event) => {
    // Calculate metadata once
    const metadata = getReadingMetadata(event)

    return {
      ...event,
      participant: participantMap.get(event.participantId),
      readStatus:
        metadata.readCount > 0 ? `Read (${metadata.readCount})` : 'Not read',
      tagColor: getStatusTagColour(
        metadata.readCount > 0 ? 'read' : 'not_read'
      ),
      readingMetadata: metadata,
      canUserRead: canUserReadEvent(event, userId)
    }
  })
}

/**
 * Calculate core reading metrics used for both status and progress tracking
 *
 * @param {Array} events - Array of events to analyze
 * @param {string | null} userId - User ID for user-specific metrics
 * @param {Array} [skippedEvents] - Array of skipped event IDs
 * @returns {object} Core metrics object
 */
const calculateReadingMetrics = function (
  events,
  userId = null,
  skippedEvents = []
) {
  // Get user ID and settings from context if not provided and we're in a template context
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id
  const settings = this?.ctx?.data?.settings || {}

  if (!events || events.length === 0) {
    return {
      total: 0,
      firstReadCount: 0,
      firstReadRemaining: 0,
      secondReadCount: 0,
      secondReadRemaining: 0,
      secondReadReady: 0,
      arbitrationCount: 0,
      completedCount: 0,
      // User-specific counts
      userReadCount: 0,
      userFirstReadCount: 0,
      userSecondReadCount: 0,
      userAwaitingPriorsCount: 0,
      userReadableCount: 0,
      userFirstReadableCount: 0,
      userSecondReadableCount: 0,
      userCanRead: false,
      skippedCount: skippedEvents?.length || 0
    }
  }

  // Count first reads (events with at least one read)
  const firstReadCount = events.filter(hasReads).length
  const completedCount = firstReadCount // For compatibility with current usage

  // Count second reads (events with at least two different readers)
  const secondReadCount = events.filter((event) => {
    const metadata = getReadingMetadata(event)
    return metadata.uniqueReaderCount >= 2
  }).length

  // Count events that are ready for second read (have first read but not second)
  const secondReadReady = events.filter((event) => {
    const metadata = getReadingMetadata(event)
    return metadata.readCount === 1 // Exactly one read means ready for second
  }).length

  // Count events needing arbitration (policy-aware via getOutcome)
  const arbitrationCount = events.filter(
    (event) => getOutcome(event, settings) === 'arbitration_pending'
  ).length

  // User-specific counts
  let userReadCount = 0
  let userFirstReadCount = 0
  let userSecondReadCount = 0
  let userAwaitingPriorsCount = 0
  let userReadableCount = 0
  let userFirstReadableCount = 0
  let userSecondReadableCount = 0

  if (currentUserId) {
    // Events this user has read
    userReadCount = events.filter((event) =>
      userHasReadEvent(event, currentUserId)
    ).length

    // Count first/second reads by this user
    events.forEach((event) => {
      const metadata = getReadingMetadata(event)
      const reads = event.imageReading?.reads
        ? Object.values(event.imageReading.reads)
        : []

      // Find reads by this user
      const userReads = reads.filter((read) => read.readerId === currentUserId)

      // Count based on read position (first or second)
      if (userReads.length > 0) {
        // Check if this user did the first read
        if (reads[0]?.readerId === currentUserId) {
          userFirstReadCount++
        }

        // Check if this user did the second read
        if (reads.length > 1 && reads[1]?.readerId === currentUserId) {
          userSecondReadCount++
        }
      }
    })

    // Events where this user has an outstanding priors request
    userAwaitingPriorsCount = events.filter(
      (event) => awaitingPriors(event) && userRequestedPriors(event, currentUserId)
    ).length

    // Events this user can read
    userReadableCount = events.filter((event) =>
      canUserReadEvent(event, currentUserId)
    ).length

    // Events needing first read that this user can read
    userFirstReadableCount = filterEventsByNeedsFirstRead(events).filter(
      (event) => canUserReadEvent(event, currentUserId)
    ).length

    // Events needing second read that this user can read
    userSecondReadableCount = filterEventsByNeedsSecondRead(events).filter(
      (event) => canUserReadEvent(event, currentUserId)
    ).length
  }

  return {
    total: events.length,
    firstReadCount,
    firstReadRemaining: events.length - firstReadCount,
    secondReadCount,
    secondReadRemaining: events.length - secondReadCount,
    secondReadReady,
    arbitrationCount,
    completedCount,
    daysSinceScreening: events[0]
      ? dayjs()
          .startOf('day')
          .diff(dayjs(events[0].timing.startTime).startOf('day'), 'days')
      : 0,
    // User-specific counts
    userReadCount,
    userFirstReadCount,
    userSecondReadCount,
    userAwaitingPriorsCount,
    userReadableCount,
    userFirstReadableCount,
    userSecondReadableCount,
    userCanRead: userReadableCount > 0,
    // Skipped events
    skippedCount: skippedEvents?.length || 0
  }
}

/**
 * Get detailed reading status for a group of events
 *
 * @param {Array} events - Array of events to analyze
 * @param {string | null} [userId] - Optional user ID (defaults to current user if available)
 * @returns {object} Detailed reading status
 */
const getReadingStatusForEvents = function (events, userId = null) {
  // Get metrics from base calculation function
  const metrics = calculateReadingMetrics(events, userId)

  // If no events, return basic metrics with default status
  if (!events || events.length === 0) {
    return {
      ...metrics,
      status: 'no_events',
      statusColor: 'grey'
    }
  }

  // Determine detailed status based on read counts
  let status

  if (metrics.firstReadCount === 0) {
    status = 'not_started'
  } else if (metrics.firstReadCount < events.length) {
    if (metrics.secondReadCount > 0) {
      status = 'mixed_reads'
    } else {
      status = 'partial_first_read'
    }
  } else if (metrics.secondReadCount === 0) {
    status = 'first_read_complete'
  } else if (metrics.secondReadCount < events.length) {
    status = 'partial_second_read'
  } else {
    status = 'complete'
  }

  return {
    ...metrics,
    status,
    statusColor: getStatusTagColour(status)
  }
}

/**
 * Get progress through reading a set of events
 * Enhanced to include user-specific navigation
 *
 * @param {Array} events - Array of events to track progress through
 * @param {string} currentEventId - ID of current event
 * @param {Array} skippedEvents - Array of event IDs that have been skipped
 * @param {string} [userId] - Optional user ID (defaults to current user if available)
 * @returns {object} Progress information
 */
const getReadingProgress = function (
  events,
  currentEventId,
  skippedEvents = [],
  userId = null
) {
  // Get base metrics
  const metrics = calculateReadingMetrics(events, userId, skippedEvents)

  // Get user ID from context if not provided and we're in a template context
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id

  // Find current event index
  const currentIndex = events.findIndex((e) => e.id === currentEventId)

  // Basic sequential navigation
  const nextEvent = getNextEvent(events, currentEventId, false)
  const previousEvent = getPreviousEvent(events, currentEventId, false)

  // Get events needing any reads (first or second)
  const readableEvents = filterEventsByNeedsAnyRead(events)

  // Find next/previous of each type
  const nextReadableEvent =
    currentIndex !== -1
      ? getNextEvent(readableEvents, currentEventId, true)
      : null
  const previousReadableEvent =
    currentIndex !== -1
      ? getPreviousEvent(readableEvents, currentEventId, true)
      : null

  // For user-specific navigation, get events this user can read or has read
  let userNavigableEvents = events
  if (currentUserId) {
    userNavigableEvents = filterEventsByUserCanReadOrHasRead(
      events,
      currentUserId
    )
  }

  // Find next/previous user-readable events if userId provided
  let nextUserReadableEvent = null
  let previousUserReadableEvent = null

  if (currentUserId && currentIndex !== -1) {
    nextUserReadableEvent = getNextEvent(
      userNavigableEvents,
      currentEventId,
      true
    )
    previousUserReadableEvent = getPreviousEvent(
      userNavigableEvents,
      currentEventId,
      true
    )
  }

  return {
    ...metrics,
    current: currentIndex + 1,
    // Event navigation
    hasNext: !!nextEvent,
    hasPrevious: !!previousEvent,
    nextEventId: nextEvent?.id || null,
    previousEventId: previousEvent?.id || null,
    hasNextReadableEvent: !!nextReadableEvent,
    hasPreviousReadableEvent: !!previousReadableEvent,
    nextReadableEventId: nextReadableEvent?.id || null,
    previousReadableEventId: previousReadableEvent?.id || null,
    // User-specific navigation
    hasNextUserReadable: !!nextUserReadableEvent,
    hasPreviousUserReadable: !!previousUserReadableEvent,
    nextUserReadableId: nextUserReadableEvent?.id || null,
    previousUserReadableId: previousUserReadableEvent?.id || null,
    // Whether user has already read the previous/next event (for review page links)
    previousUserHasRead: previousUserReadableEvent
      ? userHasReadEvent(previousUserReadableEvent, currentUserId)
      : false,
    nextUserHasRead: nextUserReadableEvent
      ? userHasReadEvent(nextUserReadableEvent, currentUserId)
      : false,
    // Skipped events
    skippedEvents,
    isCurrentSkipped: skippedEvents.includes(currentEventId),
    nextEventSkipped: nextEvent ? skippedEvents.includes(nextEvent.id) : false,
    previousEventSkipped: previousEvent
      ? skippedEvents.includes(previousEvent.id)
      : false
  }
}

// /**
//  * Get progress through reading a set of events
//  * Enhanced to include user-specific navigation
//  * @param {Array} events - Array of events to track progress through
//  * @param {string} currentEventId - ID of current event
//  * @param {Array} skippedEvents - Array of event IDs that have been skipped
//  * @param {string} [userId=null] - Optional user ID (defaults to current user if available)
//  * @returns {Object} Progress information
//  */
// const getReadingProgress = function(events, currentEventId, skippedEvents = [], userId = null) {
//   // Get user ID from context if not provided and we're in a template context
//   const currentUserId = userId || (this?.ctx?.data?.currentUser?.id);

//   const currentIndex = events.findIndex(e => e.id === currentEventId);

//   // Get complete events count
//   const completedCount = events.filter(hasReads).length;

//   // Basic sequential navigation
//   const nextEvent = getNextEvent(events, currentEventId, false);
//   const previousEvent = getPreviousEvent(events, currentEventId, false);

//   // Get events needing any reads (first or second)
//   const readableEvents = filterEventsByNeedsAnyRead(events);

//   // Find next/previous of each type
//   const nextReadableEvent = currentIndex !== -1 ?
//     getNextEvent(readableEvents, currentEventId, true) : null;
//   const previousReadableEvent = currentIndex !== -1 ?
//     getPreviousEvent(readableEvents, currentEventId, true) : null;

//   // For user-specific navigation, get events this user can read or has read
//   let userNavigableEvents = events;
//   if (currentUserId) {
//     userNavigableEvents = filterEventsByUserCanReadOrHasRead(events, currentUserId);
//   }

//   // Find next/previous user-readable events if userId provided
//   let nextUserReadableEvent = null;
//   let previousUserReadableEvent = null;

//   if (currentUserId && currentIndex !== -1) {
//     nextUserReadableEvent = getNextEvent(userNavigableEvents, currentEventId, true);
//     previousUserReadableEvent = getPreviousEvent(userNavigableEvents, currentEventId, true);
//   }

//   return {
//     current: currentIndex + 1,
//     total: events.length,
//     completed: completedCount,
//     // Event navigation
//     hasNext: !!nextEvent,
//     hasPrevious: !!previousEvent,
//     nextEventId: nextEvent?.id || null,
//     previousEventId: previousEvent?.id || null,
//     hasNextReadableEvent: !!nextReadableEvent,
//     hasPreviousReadableEvent: !!previousReadableEvent,
//     nextReadableEventId: nextReadableEvent?.id || null,
//     previousReadableEventId: previousReadableEvent?.id || null,
//     // User-specific navigation
//     hasNextUserReadable: !!nextUserReadableEvent,
//     hasPreviousUserReadable: !!previousUserReadableEvent,
//     nextUserReadableId: nextUserReadableEvent?.id || null,
//     previousUserReadableId: previousUserReadableEvent?.id || null,
//     // Skipped events
//     skippedCount: skippedEvents.length,
//     skippedEvents,
//     isCurrentSkipped: skippedEvents.includes(currentEventId),
//     nextEventSkipped: nextEvent ? skippedEvents.includes(nextEvent.id) : false,
//     previousEventSkipped: previousEvent ? skippedEvents.includes(previousEvent.id) : false
//   };
// };

// /**
//  * Get detailed reading status for a group of events
//  * @param {Array} events - Array of events to analyze
//  * @param {string} [userId=null] - Optional user ID (defaults to current user if available)
//  * @returns {Object} Detailed reading status
//  */
// const getReadingStatusForEvents = function(events, userId = null) {
//   // Get user ID from context if not provided and we're in a template context
//   const currentUserId = userId || (this?.ctx?.data?.currentUser?.id);

//   if (!events || events.length === 0) {
//     return {
//       total: 0,
//       firstReadCount: 0,
//       firstReadRemaining: 0,
//       secondReadCount: 0,
//       secondReadRemaining: 0,
//       secondReadReady: 0,
//       arbitrationCount: 0,
//       status: 'no_events',
//       statusColor: 'grey',
//       // User-specific counts
//       userReadCount: 0,
//       userFirstReadCount: 0,
//       userSecondReadCount: 0,
//       userReadableCount: 0,
//       userFirstReadableCount: 0,
//       userSecondReadableCount: 0
//     };
//   }

//   // Count first reads (events with at least one read)
//   const firstReadCount = events.filter(hasReads).length;

//   // Count second reads (events with at least two different readers)
//   const secondReadCount = events.filter(event => {
//     const metadata = getReadingMetadata(event);
//     return metadata.uniqueReaderCount >= 2;
//   }).length;

//   // Count events that are ready for second read (have first read but not second)
//   const secondReadReady = events.filter(event => {
//     const metadata = getReadingMetadata(event);
//     return metadata.readCount === 1; // Exactly one read means ready for second
//   }).length;

//   // Count events needing arbitration (still track this for informational purposes)
//   const arbitrationCount = events.filter(event => {
//     const metadata = getReadingMetadata(event);
//     return metadata.needsArbitration;
//   }).length;

//   // User-specific counts if userId provided
//   let userReadCount = 0;
//   let userFirstReadCount = 0;
//   let userSecondReadCount = 0;
//   let userReadableCount = 0;
//   let userFirstReadableCount = 0;
//   let userSecondReadableCount = 0;

//   if (currentUserId) {
//     // Events this user has read
//     userReadCount = events.filter(event => userHasReadEvent(event, currentUserId)).length;

//     // Count first/second reads by this user
//     events.forEach(event => {
//       const metadata = getReadingMetadata(event);
//       const reads = event.imageReading?.reads ? Object.values(event.imageReading.reads) : [];

//       // Find reads by this user
//       const userReads = reads.filter(read => read.readerId === currentUserId);

//       // Count based on read position (first or second)
//       if (userReads.length > 0) {
//         // Check if this user did the first read
//         if (reads[0]?.readerId === currentUserId) {
//           userFirstReadCount++;
//         }

//         // Check if this user did the second read
//         if (reads.length > 1 && reads[1]?.readerId === currentUserId) {
//           userSecondReadCount++;
//         }
//       }
//     });

//     // Events this user can read
//     userReadableCount = events.filter(event => canUserReadEvent(event, currentUserId)).length;

//     // Events needing first read that this user can read
//     userFirstReadableCount = filterEventsByNeedsFirstRead(events)
//       .filter(event => canUserReadEvent(event, currentUserId)).length;

//     // Events needing second read that this user can read
//     userSecondReadableCount = filterEventsByNeedsSecondRead(events)
//       .filter(event => canUserReadEvent(event, currentUserId)).length;
//   }

//   // Determine detailed status based on read counts
//   let status;

//   if (firstReadCount === 0) {
//     status = 'not_started';
//   } else if (firstReadCount < events.length) {
//     if (secondReadCount > 0) {
//       status = 'mixed_reads';
//     } else {
//       status = 'partial_first_read';
//     }
//   } else if (secondReadCount === 0) {
//     status = 'first_read_complete';
//   } else if (secondReadCount < events.length) {
//     status = 'partial_second_read';
//   } else {
//     status = 'complete';
//   }

//   return {
//     total: events.length,
//     firstReadCount,
//     firstReadRemaining: events.length - firstReadCount,
//     secondReadCount,
//     secondReadRemaining: events.length - secondReadCount,
//     secondReadReady, // Events ready for immediate second read
//     arbitrationCount,
//     status,
//     statusColor: getStatusTagColour(status),
//     daysSinceScreening: events[0] ?
//       dayjs().startOf('day').diff(dayjs(events[0].timing.startTime).startOf('day'), 'days') : 0,
//     // User-specific counts
//     userReadCount,
//     userFirstReadCount,
//     userSecondReadCount,
//     userReadableCount,
//     userFirstReadableCount,
//     userSecondReadableCount,
//     userCanRead: userReadableCount > 0
//   };
// };

// Add this to app/lib/utils/reading.js

/**
 * Sort events by screening date (oldest first)
 *
 * @param {Array} events - Array of events to sort
 * @returns {Array} Sorted events array
 */
const sortEventsByScreeningDate = (events) => {
  if (!events || !Array.isArray(events) || events.length === 0) {
    return []
  }

  return [...events].sort(
    (a, b) => new Date(a.timing.startTime) - new Date(b.timing.startTime)
  )
}

/************************************************************************
// Clinic stuff
//***********************************************************************

/**
 * Get the first clinic that still has events needing reads
 *
 * @param {object} data - Session data
 * @returns {object | null} First clinic with remaining reads, or null
 */
const getFirstAvailableClinic = (data) => {
  const clinics = getReadingClinics(data)
  return clinics.find((clinic) => clinic.readingStatus.remaining > 0) || null
}

/**
 * Get all clinics available for reading, enriched with unit, location, and reading status
 *
 * @param {object} data - Session data
 * @param {object} [options] - Options (currently unused, reserved for future filters)
 * @returns {Array} Clinics with added `unit`, `location`, and `readingStatus` properties
 */
const getReadingClinics = (data, options = {}) => {
  const {} = options

  return data.clinics
    .filter((clinic) =>
      data.events.some((e) => e.clinicId === clinic.id && eligibleForReading(e))
    )
    .map((clinic) => {
      const unit = data.breastScreeningUnits.find(
        (u) => u.id === clinic.breastScreeningUnitId
      )
      const location = unit.locations.find((l) => l.id === clinic.locationId)
      const events = getReadableEventsForClinic(data, clinic.id)

      return {
        ...clinic,
        unit,
        location,
        readingStatus: getReadingStatusForEvents(events, data.currentUser.id)
      }
    })
    .sort((a, b) => new Date(a.id) - new Date(b.id)) // Some clinics share the same date so sort first by a unique ID to keep consistent sort
    .sort((a, b) => new Date(a.date) - new Date(b.date))
}

/**
 * Get readable events for a clinic with pre-calculated metadata
 *
 * @param {object} data - Session data containing events, participants, etc.
 * @param {string} clinicId - ID of the clinic to get events for
 * @returns {Array} Events with enhanced metadata
 */
const getReadableEventsForClinic = (data, clinicId) => {
  // Filter eligible events for this clinic
  const eligibleEvents = data.events.filter(
    (event) => event.clinicId === clinicId && eligibleForReading(event)
  )

  // Enhance the events with reading metadata
  const enhancedEvents = enhanceEventsWithReadingData(
    eligibleEvents,
    data.participants,
    data.currentUser?.id
  )

  // Sort by appointment time
  return enhancedEvents.sort(
    (a, b) => new Date(a.timing.startTime) - new Date(b.timing.startTime)
  )
}

/************************************************************************
// Filters
//***********************************************************************


/**
 * Filter events that are eligible for reading
 * @param {Array} events - All events
 * @returns {Array} Events eligible for reading
 */
const filterEventsByEligibleForReading = (events) => {
  return events.filter((event) => eligibleForReading(event))
}

/**
 * Filter events that need any read (first or second)
 *
 * @param {Array} events - Events to filter
 * @param {number} maxReadsPerEvent - Number of reads required to be complete (default: 2)
 * @returns {Array} Events needing any read
 */
const filterEventsByNeedsAnyRead = (events, maxReadsPerEvent = 2) => {
  return events.filter((event) => {
    const metadata = getReadingMetadata(event)
    return metadata.uniqueReaderCount < maxReadsPerEvent
  })
}

/**
 * Filter events that need a first read
 *
 * @param {Array} events - Events to filter
 * @returns {Array} Events needing first read
 */
const filterEventsByNeedsFirstRead = (events) => {
  return events.filter((event) => needsFirstRead(event))
}

/**
 * Filter events that need a second read
 *
 * @param {Array} events - Events to filter
 * @returns {Array} Events needing second read
 */
const filterEventsByNeedsSecondRead = (events) => {
  return events.filter((event) => needsSecondRead(event))
}

/**
 * Filter events that are fully read (have all required reads)
 *
 * @param {Array} events - Events to filter
 * @param {number} requiredReads - Number of required reads (default: 2)
 * @returns {Array} Fully read events
 */
const filterEventsByFullyRead = (events, requiredReads = 2) => {
  return events.filter((event) => {
    const metadata = getReadingMetadata(event)
    return metadata.uniqueReaderCount >= requiredReads
  })
}

/**
 * Filter events that a specific user can read
 *
 * @param {Array} events - Events to filter
 * @param {string} userId - User ID
 * @returns {Array} Events user can read
 */
const filterEventsByUserCanRead = (events, userId) => {
  return events.filter((event) => canUserReadEvent(event, userId))
}

/**
 * Filter events that user can read or has already read
 *
 * @param {Array} events - Array of events to filter
 * @param {string} userId - User ID to check
 * @param {object} [options] - Options for determining eligibility
 * @returns {Array} Events user can read or has read
 *
 *   Priarily to support navigating backwards through events
 */
const filterEventsByUserCanReadOrHasRead = (events, userId, options = {}) => {
  const { maxReadsPerEvent = 2 } = options

  return events.filter((event) => {
    const metadata = getReadingMetadata(event)

    // Include if user has already read this event
    if (userHasReadEvent(event, userId)) {
      return true
    }

    // Include if event isn't fully read and user can read it
    if (metadata.uniqueReaderCount < maxReadsPerEvent) {
      return true
    }

    // Exclude events that are fully read by other users
    return false
  })
}

/**
 * Filter events for a specific clinic
 *
 * @param {Array} events - All events
 * @param {string} clinicId - Clinic ID
 * @returns {Array} Events for the clinic
 */
const filterEventsByClinic = (events, clinicId) => {
  return events.filter((event) => event.clinicId === clinicId)
}

/**
 * Filter events that are within a specific day range
 *
 * @param {Array} events - Events to filter
 * @param {number} minDays - Minimum days old (inclusive)
 * @param {number | null} [maxDays] - Maximum days old (inclusive), if null, no upper bound
 * @returns {Array} Events within the specified day range
 */
const filterEventsByDayRange = (events, minDays, maxDays = null) => {
  if (!events || !Array.isArray(events)) return []

  return events.filter((event) =>
    isWithinDayRange(event.timing.startTime, minDays, maxDays)
  )
}

/************************************************************************
// Selector functions
//***********************************************************************

/**
 * Get the first event from an array
 * @param {Array} events - Array of events
 * @returns {Object|null} First event or null
 */
const getFirstEvent = (events) => {
  return events.length > 0 ? events[0] : null
}

/**
 * Get the next event after a specific event
 *
 * @param {Array} events - Array of events
 * @param {string} currentEventId - Current event ID
 * @param {boolean} wrap - Whether to wrap around to start if at end
 * @returns {object | null} Next event or null
 */
const getNextEvent = (events, currentEventId, wrap = true) => {
  const currentIndex = events.findIndex((e) => e.id === currentEventId)
  if (currentIndex === -1) return null

  // Next event exists
  if (currentIndex < events.length - 1) {
    return events[currentIndex + 1]
  }

  // Wrap around to first event
  return wrap && events.length > 0 ? events[0] : null
}

/**
 * Get the previous event before a specific event
 *
 * @param {Array} events - Array of events
 * @param {string} currentEventId - Current event ID
 * @param {boolean} wrap - Whether to wrap around to end if at start
 * @returns {object | null} Previous event or null
 */
const getPreviousEvent = (events, currentEventId, wrap = true) => {
  const currentIndex = events.findIndex((e) => e.id === currentEventId)
  if (currentIndex === -1) return null

  // Previous event exists
  if (currentIndex > 0) {
    return events[currentIndex - 1]
  }

  // Wrap around to last event
  return wrap && events.length > 0 ? events[events.length - 1] : null
}

/************************************************************************
/ User functions
/***********************************************************************/

/**
 * Get the read object for a specific user on an event
 *
 * @param {object} event - The event to check
 * @param {string | null} [userId] - User ID (falls back to current user from context)
 * @returns {object | null} The read object, or null if not found
 */
const getReadForUser = function (event, userId = null) {
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id

  if (!currentUserId) {
    return null
  }

  return event.imageReading?.reads?.[currentUserId] || null
}

/**
 * Get first event from an array that a user can read
 *
 * @param {Array} events - Array of events to search
 * @param {string | null} userId - User ID to check for
 * @returns {object | null} First event user can read or null if none
 */
const getFirstUserReadableEvent = function (events, userId = null) {
  // Get user ID from context if not provided and we're in a template context
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id

  const readableEvents = filterEventsByUserCanRead(events, currentUserId)
  return readableEvents.length > 0 ? readableEvents[0] : null
}

/**
 * Get the next event the user can read after the current event, wrapping to start if needed
 *
 * @param {Array} events - Array of all events
 * @param {string} currentEventId - ID of the current event
 * @param {string | null} [userId] - User ID (falls back to current user from context)
 * @returns {object | null} Next readable event, or null if none
 */
const getNextUserReadableEvent = function (
  events,
  currentEventId,
  userId = null,
  options = {}
) {
  const { wrap = true } = options
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id
  const currentIndex = events.findIndex((e) => e.id === currentEventId)
  const eventsFromNext = wrap
    ? [...events.slice(currentIndex + 1), ...events.slice(0, currentIndex)]
    : events.slice(currentIndex + 1)
  return getFirstUserReadableEvent(eventsFromNext, currentUserId)
}

/**
 * Get the event the user should resume reading from.
 *
 * Finds the furthest point the user has reached by looking at the highest-index
 * event they have either read or that has been skipped in the batch. Returns
 * the first readable event after that position, wrapping to the start if needed.
 *
 * Using position (index) rather than timestamps lets us account for skipped
 * events, which have no timestamps. (perhaps they should do)
 *
 * Falls back to getFirstUserReadableEvent if the user has no reads or skips yet.
 *
 * @param {Array} events - Array of all events in the batch, in batch order
 * @param {string | null} [userId] - User ID (falls back to current user from context)
 * @param {Array} [skippedEvents] - Array of skipped event IDs from the batch
 * @returns {object | null} The event to resume from, or null if nothing to read
 */
const getResumeEventForUser = function (
  events,
  userId = null,
  skippedEvents = []
) {
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id

  // Find the highest-index event the user has read or that has been skipped
  let lastActedIndex = -1

  events.forEach((event, index) => {
    const wasReadByUser = !!event.imageReading?.reads?.[currentUserId]
    const wasSkipped = skippedEvents.includes(event.id)
    if (wasReadByUser || wasSkipped) {
      lastActedIndex = index
    }
  })

  // Nothing acted on yet — fall back to first readable
  if (lastActedIndex === -1) {
    return getFirstUserReadableEvent(events, currentUserId)
  }

  // Search for the first readable event after lastActedIndex, wrapping around
  const eventsFromNext = [
    ...events.slice(lastActedIndex + 1),
    ...events.slice(0, lastActedIndex + 1)
  ]
  return getFirstUserReadableEvent(eventsFromNext, currentUserId)
}

/************************************************************************
// Booleans
//***********************************************************************

/**
 * Check if a user has already read an event
 * @param {Object} event - The event to check
 * @param {string} userId - User ID to check
 * @returns {boolean} Whether the user has read this event
 */
const userHasReadEvent = function (event, userId) {
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id

  if (!currentUserId) {
    console.warn(
      'userHasReadEvent: No userId provided and no context available'
    )
    return false
  }

  return !!getReadForUser(event, currentUserId)
}

/**
 * Get reads from other users (not the current user)
 * @param {Object} event - The event to check
 * @param {string} userId - Current user ID to exclude
 * @returns {Array} Array of read objects from other users
 */
const getOtherReads = function (event, userId = null) {
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id

  if (!event?.imageReading?.reads) {
    return []
  }

  return Object.entries(event.imageReading.reads)
    .filter(([readerId]) => readerId !== currentUserId)
    .map(([readerId, read]) => ({
      ...read,
      readerId
    }))
}

/**
 * Determine if two reads are discordant (disagree in a clinically meaningful way).
 *
 * Rules:
 * - Different top-level opinions → always discordant
 * - Both technical recall: discordant if the set of selected views differs
 *   (reasons are ignored — same views = concordant even with different reasons)
 * - Both recall for assessment: discordant if either per-breast assessment differs
 *   (annotations and comments are ignored)
 * - Both normal → concordant
 *
 * Handles partial data gracefully: if TR views or RFA breast assessments are not
 * yet filled in, falls back to comparing only what's available.
 *
 * @param {object} readA - First read (saved read or imageReadingTemp)
 * @param {object} readB - Second read (saved read or imageReadingTemp)
 * @returns {boolean} Whether the reads are discordant
 */
const areReadsDiscordant = (readA, readB) => {
  if (!readA?.opinion || !readB?.opinion) return false

  // Different top-level opinions → always discordant
  if (readA.opinion !== readB.opinion) return true

  const opinion = readA.opinion

  // Both TR: compare the set of selected view keys
  if (opinion === 'technical_recall') {
    const viewsA = readA.technicalRecall?.views
    const viewsB = readB.technicalRecall?.views
    // If either side has no view data yet, can't compare further
    if (!viewsA || !viewsB) return false
    const keysA = new Set(Object.keys(viewsA))
    const keysB = new Set(Object.keys(viewsB))
    if (keysA.size !== keysB.size) return true
    for (const view of keysA) {
      if (!keysB.has(view)) return true
    }
    return false
  }

  // Both RFA: compare per-breast assessments
  if (opinion === 'recall_for_assessment') {
    const leftA = readA.left?.breastAssessment
    const leftB = readB.left?.breastAssessment
    const rightA = readA.right?.breastAssessment
    const rightB = readB.right?.breastAssessment
    // If no breast data on either side yet, can't compare further
    if (!leftA && !leftB && !rightA && !rightB) return false
    if ((leftA || leftB) && leftA !== leftB) return true
    if ((rightA || rightB) && rightA !== rightB) return true
    return false
  }

  return false
}

/**
 * Determine whether two reads will result in arbitration, taking the site's
 * arbitration policy into account.
 *
 * Policies (from settings.reading.arbitrationPolicy):
 * - 'discordant_only' (default): only discordant reads go to arbitration
 * - 'all_non_normal': any concordant non-normal outcome also goes to arbitration
 *
 * @param {object} readA - First read
 * @param {object} readB - Second read
 * @param {object} [settings] - Site settings object (data.settings)
 * @returns {boolean}
 */
const willGoToArbitration = (readA, readB, settings = {}) => {
  if (!readA || !readB) return false

  // Discordant reads always go to arbitration
  if (areReadsDiscordant(readA, readB)) return true

  // Concordant but non-normal: depends on policy
  const policy = settings?.reading?.arbitrationPolicy || 'discordant_only'
  if (policy === 'all_non_normal') {
    return readA.opinion !== 'normal'
  }

  return false
}

/**
 * Compute the overall outcome for an event based on its reads and site policy.
 *
 * Outcomes:
 * - 'not_read'             — no reads yet
 * - 'pending_second_read'  — one read, awaiting second
 * - 'arbitration_pending'  — two reads that are discordant (or policy requires arbitration)
 * - 'normal' / 'technical_recall' / 'recall_for_assessment'
 *                          — concordant outcome (or resolved by an arbitration read)
 *
 * Note: outcome is computed on demand, not persisted. If you need to filter or
 * report by outcome at scale, consider writing it to event.imageReading.outcome at
 * save-opinion time.
 *
 * @param {object} event - The event
 * @param {object} [settings] - Site settings object (data.settings)
 * @returns {string} Outcome key
 */
const getOutcome = function (event, settings = null) {
  const resolvedSettings = settings || this?.ctx?.data?.settings || {}
  const reads = getReadsAsArray(event)

  if (reads.length === 0) return 'not_read'
  if (reads.length === 1) return 'pending_second_read'

  // Third read = arbitration read; its opinion resolves the case
  if (reads.length >= 3) {
    return reads[2].opinion
  }

  const [firstRead, secondRead] = reads

  if (willGoToArbitration(firstRead, secondRead, resolvedSettings)) {
    return 'arbitration_pending'
  }

  // Concordant reads — outcome is the shared opinion
  return firstRead.opinion
}

/**
 * Determine if a comparison page should be shown to the second reader.
 * Returns false if user is first reader, or if both opinions are normal.
 * Otherwise returns comparison info including discordance and arbitration flags.
 *
 * @param {object} event - The event being read
 * @param {object} secondReadData - The second reader's data (imageReadingTemp or a read object)
 * @param {string} [userId] - Current user ID (optional, falls back to context)
 * @param {object} [settings] - Site settings (optional, falls back to context)
 * @returns {false | object} False if no comparison needed, else comparison info
 */
const getComparisonInfo = function (
  event,
  secondReadData,
  userId = null,
  settings = null
) {
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id
  const resolvedSettings = settings || this?.ctx?.data?.settings || {}

  // Support passing just an opinion string for backwards compatibility
  const secondRead =
    typeof secondReadData === 'string'
      ? { opinion: secondReadData }
      : secondReadData

  // Get the first read (from other users)
  const otherReads = getOtherReads.call(this, event, currentUserId)

  // No first read exists - user is first reader
  if (otherReads.length === 0) {
    return false
  }

  // Get the first reader's opinion (sorted by readNumber)
  const firstRead = otherReads.sort((a, b) => {
    if (a.readNumber && b.readNumber) return a.readNumber - b.readNumber
    return new Date(a.timestamp) - new Date(b.timestamp)
  })[0]

  const firstOpinion = firstRead.opinion
  const secondOpinion = secondRead.opinion

  // Both normal - no comparison needed
  if (firstOpinion === 'normal' && secondOpinion === 'normal') {
    return false
  }

  const discordant = areReadsDiscordant(firstRead, secondRead)
  const type = discordant ? 'discordant' : 'agreeing'

  return {
    type,
    discordant,
    goesToArbitration: willGoToArbitration(
      firstRead,
      secondRead,
      resolvedSettings
    ),
    firstRead,
    firstOpinion,
    secondOpinion
  }
}

/**
 * Decide whether the compare page should be shown to the second reader.
 *
 * Combines the timing setting (secondReaderComparison) and the new show-when
 * setting (compareWhen) to give a single boolean answer.
 *
 * compareWhen values (settings.reading.compareWhen):
 * - 'non_normal' (default): show whenever either opinion is non-normal
 *   (i.e. whenever getComparisonInfo returns a result — current behaviour)
 * - 'discordant_only': only show when the two reads are discordant
 *
 * @param {object} event - The event being read
 * @param {object} secondReadData - The second reader's data (imageReadingTemp or read object)
 * @param {string} [userId] - Current user ID (optional, falls back to context)
 * @param {object} [settings] - Site settings (optional, falls back to context)
 * @returns {boolean}
 */
const shouldShowComparePage = function (
  event,
  secondReadData,
  userId = null,
  settings = null
) {
  const resolvedSettings = settings || this?.ctx?.data?.settings || {}
  const currentUserId = userId || this?.ctx?.data?.currentUser?.id

  const comparisonInfo = getComparisonInfo.call(
    this,
    event,
    secondReadData,
    currentUserId,
    resolvedSettings
  )

  // getComparisonInfo returns false when no comparison needed
  // (user is first reader, or both opinions are normal)
  if (!comparisonInfo) return false

  const compareWhen = resolvedSettings?.reading?.compareWhen || 'non_normal'

  // 'non_normal': show for any non-normal combination — current behaviour
  if (compareWhen === 'non_normal') return true

  // 'discordant_only': only show when reads disagree in a clinically meaningful way
  if (compareWhen === 'discordant_only') return comparisonInfo.discordant

  return true
}

/**
 * Check if current user can read an event
 *
 * @param {object} event - The event to check
 * @param {string | null} userId - Current user ID
 * @param {object} [options] - Options for determining eligibility
 * @returns {boolean} Whether the current user can read this event
 */
const canUserReadEvent = function (event, userId = null, options = {}) {
  const { maxReadsPerEvent = 2 } = options

  const currentUserId = userId || this?.ctx?.data?.currentUser?.id

  if (!currentUserId) {
    console.warn(
      'canUserReadEvent: No userId provided and no context available'
    )
    return false
  }

  // Can't read if event is awaiting priors
  if (awaitingPriors(event)) {
    return false
  }

  const metadata = getReadingMetadata(event)

  // If we already have enough unique readers, no more reads needed
  if (metadata.uniqueReaderCount >= maxReadsPerEvent) {
    return false
  }

  // User can't read if they've already read it
  if (userHasReadEvent(event, currentUserId)) {
    return false
  }

  return true
}

/**
 * Check if an event has any reads
 *
 * @param {object} event - The event to check
 * @returns {boolean} Whether the event has any reads
 */
const hasReads = (event) => {
  return (
    event.imageReading?.reads &&
    Object.keys(event.imageReading.reads).length > 0
  )
}

/**
 * Check if an event needs a first read
 *
 * @param {object} event - The event to check
 * @returns {boolean} Whether a first read is needed
 */
const needsFirstRead = (event) => {
  return !hasReads(event)
}

/**
 * Check if an event needs a second read
 */
const needsSecondRead = (event) => {
  const metadata = getReadingMetadata(event)
  return metadata.firstReadComplete && !metadata.secondReadComplete
}

/**
 * Check if an event needs arbitration.
 * Policy-aware: reads arbitrationPolicy from Nunjucks context if available.
 */
const needsArbitration = function (event) {
  const settings = this?.ctx?.data?.settings || {}
  return getOutcome(event, settings) === 'arbitration_pending'
}

/************************************************************************
// Batches
//***********************************************************************

/**
 * Check if an event is a complex case
 *
 * @param {object} event - The event to check
 * @returns {boolean} Whether the event is a complex case
 */
const isComplexCase = (event) => {
  const hasSymptoms = event?.medicalInformation?.symptoms?.length > 0
  const hasAdditionalImages =
    event?.mammogramData?.metadata?.hasAdditionalImages
  const isImperfect =
    event?.mammogramData?.isImperfectButBestPossible?.includes?.('yes')
  const isIncomplete =
    event?.mammogramData?.isIncompleteMammography?.includes?.('yes')
  const hasImplants =
    event?.medicalInformation?.medicalHistory?.breastImplantsAugmentation
      ?.length > 0

  return (
    hasSymptoms ||
    hasAdditionalImages ||
    isImperfect ||
    isIncomplete ||
    hasImplants
  )
}

/**
 * Get eligible event candidates for a batch based on its type and filters
 * Shared between createReadingBatch and topUpBatch to ensure consistent selection
 *
 * @param {object} data - Session data
 * @param {object} batchOptions - Batch options ({ type, clinicId, filters })
 * @returns {Array} Eligible events sorted oldest-first
 */
const getEligibleCandidatesForBatch = (data, batchOptions) => {
  const { type = 'custom', clinicId, filters = {} } = batchOptions
  const currentUserId = data.currentUser.id

  let events = data.events.filter((event) => eligibleForReading(event))

  if (type === 'clinic') {
    if (!clinicId)
      throw new Error('Clinic ID is required for clinic-type batches')
    events = filterEventsByClinic(events, clinicId)
  } else {
    // 1. Filter to events the user can read (unless overridden)
    if (filters.userCanRead !== false) {
      events = filterEventsByUserCanRead(events, currentUserId)
    }

    // 2. Apply awaiting priors filter
    if (type === 'awaiting_priors') {
      events = events.filter((event) => awaitingPriors(event))
    } else if (!filters.includeAwaitingPriors) {
      events = events.filter((event) => !awaitingPriors(event))
    }

    // 3. Symptoms filter
    if (filters.hasSymptoms) {
      events = events.filter(
        (event) => event?.medicalInformation?.symptoms?.length > 0
      )
    }

    // 4. Complex case filter
    if (filters.complexOnly) {
      events = events.filter(isComplexCase)
    }
  }

  // Apply read type filters
  switch (type) {
    case 'first_reads':
      events = filterEventsByNeedsFirstRead(events)
      break
    case 'second_reads':
      events = filterEventsByNeedsSecondRead(events)
      break
    case 'all_reads':
    case 'awaiting_priors':
      events = filterEventsByNeedsAnyRead(events)
      break
  }

  // Sort oldest first
  return [...events].sort(
    (a, b) => new Date(a.timing.startTime) - new Date(b.timing.startTime)
  )
}

/**
 * Create a batch of events for reading based on specified criteria
 *
 * When lazy batches are enabled (settings.reading.lazyBatches), non-clinic batches
 * start with only the first eligible event. The batch is topped up one event at a
 * time via topUpBatch() as reads and skips happen, until targetSize is reached.
 *
 * @param {object} data - Session data
 * @param {object} options - Batch creation options
 * @param {string} options.type - Type of batch ('all_reads', 'first_reads', 'second_reads', 'awaiting_priors', 'clinic', 'custom')
 * @param {string} [options.name] - Display name for the batch
 * @param {string} [options.clinicId] - Clinic ID (for clinic-specific batches)
 * @param {string} [options.batchId] - Custom batch ID (auto-generated if omitted)
 * @param {number} [options.limit] - Target size (defaults to settings value)
 * @param {object} [options.filters] - Additional filters to apply
 * @returns {object} Created batch
 */
const createReadingBatch = (data, options) => {
  const {
    type = 'custom',
    name,
    clinicId,
    batchId = null,
    limit = null,
    lazy = null, // explicit override; null means use settings
    filters = {}
  } = options

  const finalBatchId = batchId || generateBatchId()

  // Determine target size: explicit limit > settings default > 25
  const settingsTargetSize =
    parseInt(data.settings?.reading?.defaultBatchTargetSize) || 25
  const targetSize = limit !== null ? parseInt(limit) : settingsTargetSize

  // Lazy loading: start with only the first event and top up as reads happen
  // Clinic batches are always fully populated upfront
  // Explicit lazy param overrides the setting
  const lazyEnabled =
    lazy !== null ? lazy : data.settings?.reading?.lazyBatches === 'true'
  const isLazy = lazyEnabled && type !== 'clinic'

  // Get all eligible candidates using the shared helper
  const allCandidates = getEligibleCandidatesForBatch(data, {
    type,
    clinicId,
    filters
  })

  // Cap to target size
  const cappedEvents =
    targetSize > 0 && allCandidates.length > targetSize
      ? allCandidates.slice(0, targetSize)
      : allCandidates

  // Lazy batches start with only the first event
  const initialEvents =
    isLazy && cappedEvents.length > 0 ? [cappedEvents[0]] : cappedEvents

  // Clinic batches have no fixed target — their size is however many eligible events exist
  const batchTargetSize = type === 'clinic' ? cappedEvents.length : targetSize

  // Create and store the batch
  const batch = {
    id: finalBatchId,
    name: name || getDefaultBatchName(type, clinicId, data),
    type,
    events: initialEvents,
    eventIds: initialEvents.map((e) => e.id),
    targetSize: batchTargetSize,
    clinicId,
    createdAt: new Date().toISOString(),
    skippedEvents: [],
    filters: {
      ...filters
    }
  }

  // Initialize the reading session batches object if it doesn't exist
  if (!data.readingSessionBatches) {
    data.readingSessionBatches = {}
  }

  // Store the batch
  data.readingSessionBatches[finalBatchId] = batch

  return batch
}

/**
 * Generate a default name for a batch based on its type
 *
 * @param {string} type - Batch type
 * @param {string} clinicId - Clinic ID (for clinic batches)
 * @param {object} data - Session data
 * @returns {string} Default batch name
 */
const getDefaultBatchName = (type, clinicId, data) => {
  switch (type) {
    case 'all_reads':
      return 'All cases needing reads'
    case 'first_reads':
      return '1st reads batch'
    case 'second_reads':
      return '2nd reads batch'
    case 'awaiting_priors':
      return 'Awaiting priors batch'
    case 'clinic': {
      const clinic = data.clinics.find((c) => c.id === clinicId)
      if (!clinic) return 'Clinic batch'

      const location = clinic.locationId
        ? data.breastScreeningUnits
            .find((bsu) => bsu.id === clinic.breastScreeningUnitId)
            ?.locations.find((l) => l.id === clinic.locationId)?.name
        : ''

      return `${location || 'Clinic'} - ${dayjs(clinic.date).format('D MMM YYYY')}`
    }
    default:
      return 'Custom batch'
  }
}

/**
 * Generate a unique ID for a batch
 *
 * @returns {string} Unique batch ID
 */
const generateBatchId = () => {
  return Math.random().toString(36).substring(2, 10)
}

/**
 * Get a reading batch by ID
 *
 * @param {object} data - Session data
 * @param {string} batchId - Batch ID to retrieve
 * @returns {object | null} Batch object or null if not found
 */
const getReadingBatch = (data, batchId) => {
  if (!data.readingSessionBatches || !data.readingSessionBatches[batchId]) {
    return null
  }

  return data.readingSessionBatches[batchId]
}

// Add a helper function to create batches from clinics
const getOrCreateClinicBatch = (data, clinicId) => {
  // Check if a batch already exists for this clinic
  const existingBatch = (data.readingSessionBatches || {})[clinicId]

  if (
    existingBatch &&
    existingBatch.type === 'clinic' &&
    existingBatch.clinicId === clinicId
  ) {
    return existingBatch
  }

  // Create a new batch for this clinic
  return createReadingBatch(data, {
    type: 'clinic',
    clinicId,
    batchId: clinicId, // Use clinic ID as batch ID
    name: null // Will use default clinic name
  })
}

/**
 * Get the first event in a batch that a user can read
 *
 * @param {object} data - Session data
 * @param {string} batchId - Batch ID
 * @param {string | null} [userId] - User ID (defaults to current user)
 * @returns {object | null} First readable event or null if none found
 */
const getFirstReadableEventInBatch = (data, batchId, userId = null) => {
  const batch = getReadingBatch(data, batchId)
  if (!batch) return null

  const currentUserId = userId || data.currentUser.id

  // Get all events for the batch
  const batchEvents = batch.eventIds
    .map((eventId) => data.events.find((e) => e.id === eventId))
    .filter(Boolean)

  // Find the first one the user can read
  return (
    batchEvents.find((event) => canUserReadEvent(event, currentUserId)) || null
  )
}

/**
 * Mark an event as skipped in a batch
 *
 * @param {object} data - Session data
 * @param {string} batchId - Batch ID
 * @param {string} eventId - Event ID to mark as skipped
 * @returns {boolean} Whether the operation was successful
 */
const skipEventInBatch = (data, batchId, eventId) => {
  const batch = getReadingBatch(data, batchId)
  if (!batch) return false

  // Check if event exists in this batch
  if (!batch.eventIds.includes(eventId)) return false

  // Check if already skipped
  if (batch.skippedEvents.includes(eventId)) return true

  // Add to skipped events
  batch.skippedEvents.push(eventId)
  return true
}

/**
 * Add the next eligible event to a batch if it is under its target size
 * Called after each read or skip to grow the batch one case at a time
 *
 * @param {object} data - Session data
 * @param {string} batchId - Batch ID
 * @returns {boolean} Whether an event was added
 */
const topUpBatch = (data, batchId) => {
  const batch = getReadingBatch(data, batchId)
  if (!batch) return false

  // Clinic batches are fully populated at creation
  if (batch.type === 'clinic') return false

  // Already at or above target size
  if (!batch.targetSize || batch.eventIds.length >= batch.targetSize)
    return false

  // Collect all event IDs currently in any batch to avoid overlap
  const claimedEventIds = new Set(
    Object.values(data.readingSessionBatches || {}).flatMap(
      (b) => b.eventIds || []
    )
  )

  // Get candidates using the same filters as at batch creation, excluding already-claimed events
  const candidates = getEligibleCandidatesForBatch(data, batch).filter(
    (event) => !claimedEventIds.has(event.id)
  )

  if (candidates.length === 0) return false

  // Add the next eligible event
  batch.eventIds.push(candidates[0].id)
  return true
}

/**
 * Get reading progress for a batch
 *
 * @param {object} data - Session data
 * @param {string} batchId - Batch ID
 * @param {string} currentEventId - Current event ID
 * @param {string} [userId] - User ID (defaults to current user)
 * @returns {object} Reading progress information
 */
const getBatchReadingProgress = (
  data,
  batchId,
  currentEventId,
  userId = null
) => {
  const batch = getReadingBatch(data, batchId)
  if (!batch) return null

  // Get all events for the batch
  const batchEvents = batch.eventIds
    .map((eventId) => data.events.find((e) => e.id === eventId))
    .filter(Boolean)

  // Use existing function for progress tracking, then add batch-level size info
  const progress = getReadingProgress(
    batchEvents,
    currentEventId,
    batch.skippedEvents,
    userId || data.currentUser.id
  )

  const resolvedTargetSize = batch.targetSize || batchEvents.length

  return {
    ...progress,
    // How many events are currently loaded vs the overall target
    populatedCount: batchEvents.length,
    targetSize: resolvedTargetSize,
    // Remaining reads against the target (not just currently loaded events)
    targetRemaining: Math.max(0, resolvedTargetSize - progress.userReadCount - progress.userAwaitingPriorsCount)
  }
}

module.exports = {
  // getFirstUnreadEvent,
  // getFirstUnreadEventOverall,

  // Single event
  getReadingMetadata,
  areReadsDiscordant,
  willGoToArbitration,
  getOutcome,
  writeReading,

  // Multiple events
  enhanceEventsWithReadingData,
  getReadingProgress,
  getReadingStatusForEvents,
  sortEventsByScreeningDate,

  // Clinic stuff
  getFirstAvailableClinic,
  getReadingClinics,
  getReadableEventsForClinic,

  // Filters
  filterEventsByEligibleForReading,
  filterEventsByNeedsAnyRead,
  filterEventsByNeedsFirstRead,
  filterEventsByNeedsSecondRead,
  filterEventsByFullyRead,
  filterEventsByUserCanRead,
  filterEventsByUserCanReadOrHasRead,
  filterEventsByClinic,
  filterEventsByDayRange,
  // Selector functions
  getFirstEvent,
  getNextEvent,
  getPreviousEvent,
  // User functions
  getReadForUser,
  getOtherReads,
  getComparisonInfo,
  shouldShowComparePage,
  getReadsAsArray,
  getFirstUserReadableEvent,
  getNextUserReadableEvent,
  getResumeEventForUser,
  // Booleans
  userHasReadEvent,
  canUserReadEvent,
  hasReads,
  needsArbitration,
  needsFirstRead,
  needsSecondRead,

  // Batches
  createReadingBatch,
  getDefaultBatchName,
  generateBatchId,
  getReadingBatch,
  getOrCreateClinicBatch,
  getFirstReadableEventInBatch,
  skipEventInBatch,
  topUpBatch,
  getBatchReadingProgress
}
