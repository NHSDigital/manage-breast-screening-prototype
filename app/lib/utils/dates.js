// app/lib/utils/dates.js

const dayjs = require('dayjs')
const relativeTime = require('dayjs/plugin/relativeTime')
const advancedFormat = require('dayjs/plugin/advancedFormat')
const utc = require('dayjs/plugin/utc')
const timezone = require('dayjs/plugin/timezone')
const isToday = require('dayjs/plugin/isToday')
const isTomorrow = require('dayjs/plugin/isTomorrow')
const isYesterday = require('dayjs/plugin/isYesterday')
const customParseFormat = require('dayjs/plugin/customParseFormat')

// Add plugins
dayjs.extend(relativeTime)
dayjs.extend(advancedFormat)
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(isToday)
dayjs.extend(isTomorrow)
dayjs.extend(isYesterday)
dayjs.extend(customParseFormat)

// Set timezone to UK
dayjs.tz.setDefault('Europe/London')

/**
 * Convert array [day, month, year] or object {day, month, year} to dayjs object
 * @param {Array|Object} input - Array [day, month, year] or object {day, month, year}
 * @returns {dayjs} dayjs object or null if invalid
 */
const arrayOrObjectToDateObject = (input) => {
  let day, month, year

  if (Array.isArray(input)) {
    if (input.length !== 3) return (null[(day, month, year)] = input)
  } else if (typeof input === 'object' && input !== null) {
    // Handle object with day, month, year properties
    day = input.day
    month = input.month
    year = input.year
  } else {
    return null
  }

  // Validate that we have all required parts
  if (!day || !month || !year) return null

  // Convert to numbers if they're strings
  day = parseInt(day, 10)
  month = parseInt(month, 10)
  year = parseInt(year, 10)

  // Basic validation
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null

  // dayjs expects month to be 0-based, so subtract 1
  return dayjs()
    .year(year)
    .month(month - 1)
    .date(day)
}

/**
 * Format a date in UK format
 * @param {string|Array|Object} dateString - ISO date string, array [day, month, year], or object {day, month, year}
 * @param {string} format - Optional format string
 */
const formatDate = (dateString, format = 'D MMMM YYYY') => {
  if (!dateString) return ''

  // Handle array or object input
  if (
    Array.isArray(dateString) ||
    (typeof dateString === 'object' &&
      dateString !== null &&
      !(dateString instanceof Date))
  ) {
    const dateObj = arrayOrObjectToDateObject(dateString)
    return dateObj ? dateObj.format(format) : ''
  }

  // Handle string input (existing functionality)
  return dayjs(dateString).format(format)
}

/**
 * Format a date in UK format with special month abbreviations
 * For months with 4 letters (June, July), use the full name
 * For other months, use 3 letter abbreviation
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted date string
 */
const formatDateShort = (dateString) => {
  if (!dateString) return ''

  const date = dayjs(dateString)
  const monthFormat = ['June', 'July'].includes(date.format('MMMM'))
    ? 'MMMM'
    : 'MMM'

  return `${date.format('D')} ${date.format(monthFormat)} ${date.format('YYYY')}`
}

/**
 * Format a month/year to a readable string
 * @param {string|Array|Object|Date} input - ISO date string, [month, year] array, {month, year} object, or Date object
 * @param {string} format - Optional format string (default: 'MMMM YYYY')
 * @returns {string} Formatted month/year string
 */
const formatMonthYear = (input, format = 'MMMM YYYY') => {
  if (!input) return ''

  let month, year

  // Handle different input types
  if (Array.isArray(input)) {
    if (input.length === 2) {
      // [month, year] format
      ;[month, year] = input
    } else if (input.length === 3) {
      // [day, month, year] format - ignore day
      ;[, month, year] = input
    } else {
      return ''
    }
  } else if (
    typeof input === 'object' &&
    input !== null &&
    !(input instanceof Date)
  ) {
    // Handle {month, year} object
    month = input.month
    year = input.year
  } else {
    // Handle ISO date string or Date object
    const date = dayjs(input)
    month = date.month() + 1 // dayjs months are 0-based
    year = date.year()
  }

  // Validate that we have month and year
  if (!month || !year) return ''

  // Convert to numbers if they're strings
  month = parseInt(month, 10)
  year = parseInt(year, 10)

  // Basic validation
  if (isNaN(month) || isNaN(year)) return ''

  // Create a dayjs object with the 1st of the month
  // dayjs expects month to be 0-based, so subtract 1
  return dayjs()
    .year(year)
    .month(month - 1)
    .date(1)
    .format(format)
}

/**
 * Format a time in UK format
 * @param {string} dateString - ISO date string
 * @param {string} format - Optional format string
 */
const formatTime = (dateString, format = 'H:mm') => {
  if (!dateString) return ''
  return dayjs(dateString).format(format)
}

/**
 * Format a time in 12-hour format with special cases for round hours, midday and midnight
 * @param {string} input - Either a time string (e.g. "17:00") or full date/datetime
 * @returns {string} Formatted time (e.g. "5pm", "5:30pm", "midday", "midnight")
 */
const formatTimeString = (input) => {
  if (!input) return ''

  // If it looks like just a time (contains no date), prefix with dummy date
  const datetime =
    input.includes('T') || input.includes('-') ? input : `2000-01-01T${input}`

  const time = dayjs(datetime)
  const hour = time.hour()
  const minute = time.minute()

  // Handle special cases
  if (minute === 0) {
    if (hour === 0) return 'midnight'
    if (hour === 12) return 'midday'
    return `${time.format('h')}${time.format('a')}`
  }

  // For non-zero minutes, return full format
  return time.format('h:mma')
}

/**
 * Format clinic session times for display
 * @param {Object} sessionTimes - Object containing startTime and endTime
 * @returns {string} Formatted time range (e.g. "9:00am - 5:00pm")
 */
const formatTimeRange = (times) => {
  if (!times?.startTime || !times?.endTime) return ''
  return `${formatTimeString(times.startTime)} to ${formatTimeString(times.endTime)}`
}

/**
 * Format a date and time
 * @param {string} dateString - ISO date string
 * @param {string} format - Optional format string
 */
const formatDateTime = (dateString, format = 'D MMMM YYYY, HH:mm') => {
  if (!dateString) return ''
  return dayjs(dateString).format(format)
}

/**
 * Format a date as a relative time
 * @param {string} dateString - ISO date string
 * @param {boolean} withoutSuffix - If true, removes the 'ago' suffix
 */
const formatRelativeDate = (dateString, withoutSuffix = false) => {
  if (!dateString) return ''

  // Use the same calculation as daysSince for consistency
  const daysDiff = daysSince(dateString)

  // Special cases for today, yesterday, tomorrow
  const date = dayjs(dateString).startOf('day')
  const now = dayjs().startOf('day')

  if (date.isToday()) return 'today'
  if (date.isYesterday()) return 'yesterday'
  if (date.isTomorrow()) return 'tomorrow'

  // Calculate near future/past dates using same logic as daysSince
  if (daysDiff < 0 && daysDiff >= -6) {
    return `in ${Math.abs(daysDiff)} day${Math.abs(daysDiff) > 1 ? 's' : ''}`
  }
  if (daysDiff > 0 && daysDiff <= 6) {
    return `${daysDiff} day${daysDiff > 1 ? 's' : ''} ago`
  }

  // Avoiding date.fromNow() as it seems to use the time of day and not just the date
  return date.from(now, withoutSuffix)
}

/**
 * Calculate the number of days since a given date
 * @param {string} dateString - ISO date string for past date
 * @param {string|dayjs} [compareDate=null] - Optional reference date (defaults to today)
 * @returns {number} Number of days since the date (positive integer for past dates)
 */
const daysSince = (dateString, compareDate = null) => {
  if (!dateString) return 0

  const date = dayjs(dateString).startOf('day')
  const reference = compareDate
    ? dayjs(compareDate).startOf('day')
    : dayjs().startOf('day')

  // Return positive number for days in the past
  return reference.diff(date, 'day')
}

/**
 * Check if date is in the past
 * @param {string} dateString - ISO date string
 */
const isPast = (dateString) => {
  if (!dateString) return false
  return dayjs(dateString).isBefore(dayjs(), 'day')
}

/**
 * Check if date is in the future
 * @param {string} dateString - ISO date string
 */
const isFuture = (dateString) => {
  if (!dateString) return false
  return dayjs(dateString).isAfter(dayjs())
}

/**
 * Check if a date is before another date (at day precision)
 * @param {string} inputDate - ISO date string to check
 * @param {string|dayjs} compareDate - Optional date to compare against (defaults to today)
 * @returns {boolean} True if inputDate is before compareDate
 */
const isBeforeDate = (inputDate, compareDate = dayjs()) => {
  if (!inputDate) return false
  return dayjs(inputDate).isBefore(dayjs(compareDate), 'day')
}

/**
 * Check if a date is after another date (at day precision)
 * @param {string} inputDate - ISO date string to check
 * @param {string|dayjs} compareDate - Optional date to compare against (defaults to today)
 * @returns {boolean} True if inputDate is after compareDate
 */
const isAfterDate = (inputDate, compareDate = dayjs()) => {
  if (!inputDate) return false
  return dayjs(inputDate).isAfter(dayjs(compareDate), 'day')
}

/**
 * Get today's date at midnight
 * @returns {string} Today's date as ISO string
 */
const today = () => {
  return dayjs().startOf('day').toISOString()
}

/**
 * Get current date and time
 * @returns {string} Current date/time as ISO string
 */
const now = () => {
  return dayjs().toISOString()
}

/**
 * Format a date range
 * @param {string} startDate - ISO date string
 * @param {string} endDate - ISO date string
 */
const formatDateRange = (startDate, endDate) => {
  if (!startDate || !endDate) return ''

  const start = dayjs(startDate)
  const end = dayjs(endDate)

  // If same day
  if (start.isSame(end, 'day')) {
    return `${start.format('D MMMM YYYY')}`
  }

  // If same month
  if (start.isSame(end, 'month')) {
    return `${start.format('D')} - ${end.format('D MMMM YYYY')}`
  }

  // If same year
  if (start.isSame(end, 'year')) {
    return `${start.format('D MMMM')} - ${end.format('D MMMM YYYY')}`
  }

  // Different years
  return `${start.format('D MMMM YYYY')} - ${end.format('D MMMM YYYY')}`
}

/**
 * Get calendar week dates
 * @param {string} dateString - ISO date string to center the week on
 * @returns {Array} Array of day objects for the week
 */
const getWeekDates = (dateString) => {
  const date = dateString ? dayjs(dateString) : dayjs()
  const startOfWeek = date.startOf('week')

  return Array.from({ length: 7 }, (_, i) => {
    const day = startOfWeek.add(i, 'day')
    return {
      date: day.toISOString(),
      dayName: day.format('dddd'),
      dayShort: day.format('ddd'),
      dayNumber: day.format('D'),
      isToday: day.isToday(),
      isPast: day.isBefore(dayjs(), 'day'),
      isFuture: day.isAfter(dayjs(), 'day')
    }
  })
}

/**
 * Check if a date is within specified age range
 * @param {string} dateString - ISO date string to check
 * @param {number} minDays - Minimum days old (inclusive)
 * @param {number} [maxDays=null] - Maximum days old (inclusive), if null, no upper bound
 * @param {string|dayjs} [compareDate=null] - Optional reference date (defaults to today)
 * @returns {boolean} True if date is within specified age range
 */
const isWithinDayRange = (
  dateString,
  minDays,
  maxDays = null,
  compareDate = null
) => {
  if (!dateString) return false

  const date = dayjs(dateString).startOf('day')
  const reference = compareDate
    ? dayjs(compareDate).startOf('day')
    : dayjs().startOf('day')

  // Calculate days difference
  const daysDifference = reference.diff(date, 'day')

  // Check if within range
  const isOlderThanMin = daysDifference >= minDays
  const isYoungerThanMax = maxDays === null || daysDifference <= maxDays

  return isOlderThanMin && isYoungerThanMax
}

/**
 * Add or subtract time from a date
 * @param {string|Array|Object} dateInput - ISO date string, array [day, month, year], or object {day, month, year}
 * @param {number} amount - Amount to add (can be negative to subtract)
 * @param {string} unit - Unit of time ('year', 'years', 'month', 'months', 'week', 'weeks', 'day', 'days', 'hour', 'hours', 'minute', 'minutes', 'second', 'seconds')
 * @returns {string} Modified date as ISO string
 * @example
 * add('2023-01-01', 5, 'weeks') // returns '2023-02-05T00:00:00.000Z'
 * add('2023-01-01', -2, 'days') // returns '2022-12-30T00:00:00.000Z'
 */
const add = (dateInput, amount, unit) => {
  if (!dateInput || amount === undefined || !unit) return ''

  let date

  // Handle array or object input using existing helper
  if (
    Array.isArray(dateInput) ||
    (typeof dateInput === 'object' &&
      dateInput !== null &&
      !(dateInput instanceof Date))
  ) {
    date = arrayOrObjectToDateObject(dateInput)
    if (!date) return ''
  } else {
    // Handle string input
    date = dayjs(dateInput)
  }

  return date.add(amount, unit).toISOString()
}

/**
 * Remove time from a date (convenience wrapper for add with negative amount)
 * @param {string|Array|Object} dateInput - ISO date string, array [day, month, year], or object {day, month, year}
 * @param {number} amount - Amount to remove
 * @param {string} unit - Unit of time ('year', 'years', 'month', 'months', 'week', 'weeks', 'day', 'days', 'hour', 'hours', 'minute', 'minutes', 'second', 'seconds')
 * @returns {string} Modified date as ISO string
 * @example
 * remove('2023-01-01', 2, 'days') // returns '2022-12-30T00:00:00.000Z'
 * remove('2023-01-01', 1, 'week') // returns '2022-12-25T00:00:00.000Z'
 */
const remove = (dateInput, amount, unit) => {
  return add(dateInput, -amount, unit)
}

module.exports = {
  arrayOrObjectToDateObject,
  formatDate,
  formatDateShort,
  formatMonthYear,
  formatTime,
  formatTimeString,
  formatTimeRange,
  formatDateTime,
  formatRelativeDate,
  formatDateRange,
  isPast,
  isFuture,
  isBeforeDate,
  isAfterDate,
  today,
  now,
  getWeekDates,
  // Export dayjs instance for direct use if needed
  dayjs,
  daysSince,
  isWithinDayRange,
  add,
  remove
}
