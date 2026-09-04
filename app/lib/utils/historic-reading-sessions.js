// app/lib/utils/historic-reading-sessions.js

const dayjs = require('dayjs')

/**
 * Stand-in sessions for the reading history sessions tab.
 *
 * Reading sessions only exist once someone works through one in this browser
 * session, so the tab is empty on a fresh prototype. These fill it with the
 * months of finished work a real reader would have behind them.
 *
 * They are display only: they hold no cases, their "View session" link goes
 * nowhere, and they are built at render time rather than stored in the session
 * data, so they can't be resumed or counted anywhere else.
 */

// Cycled so the list isn't 20 of the same. Only the session types someone can
// still start belong here - reading the oldest cases, and arbitration
const SESSION_PATTERN = [
  { type: 'all_reads', size: 25 },
  { type: 'all_reads', size: 25 },
  { type: 'all_reads', size: 25 },
  { type: 'arbitration', size: 8, mode: 'alone' },
  { type: 'all_reads', size: 25 },
  { type: 'all_reads', size: 25 },
  { type: 'all_reads', size: 25 },
  { type: 'arbitration', size: 5, mode: 'panel' },
  { type: 'all_reads', size: 25 },
  { type: 'all_reads', size: 25 }
]

// Days between one session and the next, cycled - reading isn't daily
const DAY_GAPS = [1, 2, 1, 3, 1, 2, 4, 1, 2, 3]

// Sessions start at the beginning of a working block, not on the hour every time
const START_TIMES = [
  { hour: 9, minute: 15 },
  { hour: 11, minute: 0 },
  { hour: 14, minute: 30 },
  { hour: 16, minute: 5 },
  { hour: 10, minute: 45 }
]

const HISTORIC_SESSION_COUNT = 20

/**
 * Finished sessions to show beneath the real ones on the history tab.
 *
 * Dated backwards from yesterday so the list always looks recent, and derived
 * only from the day it's called on, so it doesn't shuffle between requests.
 *
 * @param {object} data - Session data, for the users on a panel
 * @returns {Array} Sessions shaped as the history template expects
 */
const getHistoricReadingSessions = (data) => {
  // Whoever else was on an arbitration panel - real users so the names resolve
  const otherReaders = (data.users || [])
    .filter((user) => user.id !== data.currentUser?.id)
    .filter((user) => (user.role || []).includes('clinician'))
    .map((user) => user.id)

  let createdAt = dayjs().subtract(1, 'day')

  return Array.from({ length: HISTORIC_SESSION_COUNT }, (item, index) => {
    const shape = SESSION_PATTERN[index % SESSION_PATTERN.length]
    const startTime = START_TIMES[index % START_TIMES.length]

    if (index > 0) {
      createdAt = createdAt.subtract(DAY_GAPS[index % DAY_GAPS.length], 'day')
    }

    const startedAt = createdAt
      .hour(startTime.hour)
      .minute(startTime.minute)
      .second(0)
      .millisecond(0)

    return {
      id: null,
      // The history template points these at "#" - there's nothing to open
      isHistoric: true,
      type: shape.type,
      createdAt: startedAt.toISOString(),
      // Historic sessions are finished ones - worked through and finalised
      progress: { effectiveTargetSize: shape.size },
      userCompletedCount: shape.size,
      unfinalisedReadCount: 0,
      arbitration:
        shape.type === 'arbitration'
          ? {
              mode: shape.mode,
              arbitratorIds:
                shape.mode === 'panel' ? otherReaders.slice(0, 2) : []
            }
          : undefined
    }
  })
}

module.exports = {
  getHistoricReadingSessions
}
