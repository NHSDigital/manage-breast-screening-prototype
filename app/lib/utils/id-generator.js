// app/lib/utils/id-generator.js

// Create an alphabet of lowercase letters and numbers
const alphabetArray = '0123456789abcdefghijklmnopqrstuvwxyz'.split('')

const generateId = (length = 8) => {
  return Array.from(
    { length },
    () => alphabetArray[Math.floor(Math.random() * alphabetArray.length)]
  ).join('')
}

module.exports = generateId
