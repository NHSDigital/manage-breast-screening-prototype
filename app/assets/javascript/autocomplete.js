// app/assets/javascript/autocomplete.js
// Enhances select elements and inputs with the accessible-autocomplete component.
// Uses data-module="app-autocomplete" to find elements to enhance.
//
// Sort algorithm adapted from DFE Register Trainee Teachers:
// https://github.com/DFE-Digital/register-trainee-teachers/tree/main/app/javascript/scripts/components/form_components/autocomplete

import accessibleAutocomplete from "accessible-autocomplete"

// ---------------------------------------------------------------------------
// Sort algorithm
// ---------------------------------------------------------------------------

// Strip punctuation and lowercase a string for comparison
const clean = (text) =>
  text
    .trim()
    .replace(/['']/g, "")
    .replace(/[.,"/#!$%^&*;:{}=\-_`~()]/g, " ")
    .toLowerCase()

const stopWords = ["the", "of", "in", "and", "at", "&", "with"]

// Remove stop words from a string, unless the string is entirely stop words
const removeStopWords = (text) => {
  const words = text.trim().split(" ")
  const isAllStopWords = words.every((word) => stopWords.includes(word))
  if (isAllStopWords) return text
  const regex = new RegExp(
    stopWords.map((word) => `(\\s+)?${word}(\\s+)?`).join("|"),
    "gi"
  )
  return text.replace(regex, " ").trim()
}

// Calculate how well a query matches an option (0 = no match, 100 = exact)
const calculateWeight = (
  { name, synonyms, nameWithoutStopWords, synonymsWithoutStopWords },
  query
) => {
  const queryWithoutStopWords = removeStopWords(query)
  const startsWithRegExp = (q) => new RegExp("\\b" + q, "i")

  const exactMatch = (word, q) => word === q
  const startsWith = (word, q) => word.search(startsWithRegExp(q)) === 0
  const wordsStartWith = (word, regExps) =>
    regExps.every((re) => word.search(re) >= 0)
  const anyMatch = (list, q, fn) => list.some((item) => fn(item, q))

  if (exactMatch(name, query)) return 100
  if (exactMatch(nameWithoutStopWords, queryWithoutStopWords)) return 95
  if (anyMatch(synonyms, query, exactMatch)) return 75
  if (anyMatch(synonymsWithoutStopWords, queryWithoutStopWords, exactMatch))
    return 70
  if (startsWith(name, query)) return 60
  if (startsWith(nameWithoutStopWords, queryWithoutStopWords)) return 55
  if (anyMatch(synonyms, query, startsWith)) return 50
  if (anyMatch(synonymsWithoutStopWords, queryWithoutStopWords, startsWith))
    return 40

  const queryRegExps = queryWithoutStopWords.split(/\s+/).map(startsWithRegExp)
  if (wordsStartWith(nameWithoutStopWords, queryRegExps)) return 25
  if (
    synonymsWithoutStopWords.some((syn) => wordsStartWith(syn, queryRegExps))
  )
    return 10

  return 0
}

// Sort options by relevance to query, falling back to alphabetical order
const sort = (query, options) => {
  const cleanQuery = clean(query)

  return options
    .map((option) => {
      const cleanedSynonyms = (option.synonyms || []).map(clean)
      option.cleanData = {
        name: clean(option.name),
        nameWithoutStopWords: removeStopWords(clean(option.name)),
        synonyms: cleanedSynonyms,
        synonymsWithoutStopWords: cleanedSynonyms.map(removeStopWords),
        boost: option.boost || 1
      }
      option.weight =
        calculateWeight(option.cleanData, cleanQuery) * option.cleanData.boost
      return option
    })
    .filter((option) => option.weight > 0)
    .sort((a, b) => {
      if (a.weight > b.weight) return -1
      if (a.weight < b.weight) return 1
      if (a.name < b.name) return -1
      if (a.name > b.name) return 1
      return 0
    })
    .map((option) => option.name)
}

// ---------------------------------------------------------------------------
// Enhancement
// ---------------------------------------------------------------------------

// Map a <select> option element to a structured option object
const enhanceSelectOption = ($option) => ({
  name: $option.label,
  synonyms: $option.dataset.synonyms
    ? $option.dataset.synonyms.split("|")
    : [],
  append: $option.dataset.append || null,
  hint: $option.dataset.hint || null,
  boost: parseFloat($option.dataset.boost) || 1
})

// Render a suggestion item (used for select-based autocompletes)
const renderSuggestion = (value, options) => {
  const option = options.find((o) => o.name === value)
  if (!option) return "No results found"
  const label = option.append ? `${value} – ${option.append}` : value
  return option.hint
    ? `${label}<br><span class="app-autocomplete__option-hint">${option.hint}</span>`
    : label
}

document.addEventListener("DOMContentLoaded", () => {
  // Enhance select elements
  const selectElements = document.querySelectorAll(
    "select[data-module='app-autocomplete']"
  )

  selectElements.forEach(($select) => {
    const defaultValue = $select.options[$select.selectedIndex]?.text || ""
    const selectOptions = Array.from($select.options)
    const options = selectOptions.map(enhanceSelectOption)

    accessibleAutocomplete.enhanceSelectElement({
      selectElement: $select,
      cssNamespace: "app-autocomplete",
      defaultValue: defaultValue,
      inputClasses: "nhsuk-input",
      showNoOptionsFound: true,
      source: (query, populateResults) => {
        if (query.trim()) {
          populateResults(sort(query, options))
        } else {
          populateResults([])
        }
      },
      templates: {
        suggestion: (value) => renderSuggestion(value, options)
      },
      onConfirm: (value) => {
        const matchingOption = selectOptions.find(
          ($option) => $option.text === value
        )
        if (matchingOption) {
          matchingOption.selected = true
        }
      }
    })
  })

  // Enhance input elements with a source provided via data-source attribute
  // The source should be a JSON array of strings set as data-source="[...]"
  const inputElements = document.querySelectorAll(
    "input[data-module='app-autocomplete']"
  )

  inputElements.forEach(($input) => {
    const sourceAttr = $input.getAttribute("data-source")
    if (!sourceAttr) return

    let sourceStrings
    try {
      sourceStrings = JSON.parse(sourceAttr)
    } catch (e) {
      console.warn("app-autocomplete: could not parse data-source", e)
      return
    }

    // Wrap plain strings as option objects for the sort algorithm
    const options = sourceStrings.map((name) => ({ name }))

    const id = $input.id
    const name = $input.name
    const defaultValue = $input.value

    // Create a wrapper div to mount the autocomplete into
    const $wrapper = document.createElement("div")
    $input.replaceWith($wrapper)

    accessibleAutocomplete({
      element: $wrapper,
      id: id,
      name: name,
      cssNamespace: "app-autocomplete",
      defaultValue: defaultValue,
      inputClasses: "nhsuk-input",
      showNoOptionsFound: true,
      source: (query, populateResults) => {
        if (query.trim()) {
          populateResults(sort(query, options))
        } else {
          populateResults([])
        }
      }
    })
  })
})
