// app/assets/javascript/admin-real-cases.js
//
// The real case annotator (/admin/real-cases). Lists the real image pack's
// cases, shows a case's views to place markers on, with what NBSS recorded
// alongside, and saves each change to the pack's annotations.json. The page
// and its data come from app/routes/admin-real-cases.js.

const VIEW_ROWS = [
  ['rcc', 'lcc'],
  ['rmlo', 'lmlo']
]

const CLASSIFICATIONS = {
  N: 'normal',
  B: 'benign',
  M: 'malignant',
  CI: 'interval cancer'
}

const READER_OPINIONS = {
  N: 'normal',
  A: 'abnormal',
  C: 'clinical',
  T: 'technical recall',
  X: 'not applicable'
}

const ACTIONS = {
  RR: 'routine recall',
  RC: 'recall to assessment',
  TR: 'technical repeat',
  FV: 'further views',
  EC: 'early recall to clinic',
  FP: 'follow-up',
  MT: 'medical treatment'
}

const FINAL_ACTION_SOURCES = {
  A: 'readers agreed',
  D: 'decided at arbitration',
  P: 'entered from paper records, so reader opinions may not be recorded'
}

const RESULTS = {
  'normal': 'Normal',
  'recalled-not-cancer': 'Recalled, not cancer',
  'cancer': 'Cancer',
  'technical-repeat-requested': 'Technical repeat requested'
}

const getResultLabel = (result) =>
  RESULTS[result] || result || 'Outcome not known'

const GROUP_TAG_COLOURS = {
  'cancer': 'red',
  'normal-at-assessment': 'orange',
  'biopsy-not-cancer': 'orange',
  'disagreement': 'purple',
  'interval': 'aqua-green',
  'technical': 'yellow'
}

const STATUS_TAG_COLOURS = {
  'to-do': 'white',
  'in-progress': 'blue',
  'done': 'green',
  'revisit': 'yellow',
  'nothing-visible': 'grey'
}

// Statuses that mean a case needs no more work
const FINISHED_STATUSES = ['done', 'nothing-visible']

const INITIALS_STORAGE_KEY = 'realCasesAnnotatorInitials'
const SAVE_DELAY_MS = 500

const state = {
  data: null,
  casesById: new Map(),
  casesByParticipant: new Map(),
  groupFilter: 'to-annotate',
  statusFilter: 'any',
  currentCaseId: null,
  activeAnnotationIndex: null,
  enlargedImageId: null,
  initials: window.localStorage.getItem(INITIALS_STORAGE_KEY) || '',
  saveTimer: null,
  pendingStudyId: null
}

const elements = {}

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const today = () => new Date().toISOString().slice(0, 10)

const tag = (text, colour) =>
  `<strong class="nhsuk-tag nhsuk-tag--${colour}">${escapeHtml(text)}</strong>`

const getLabel = (list, id) => list.find((item) => item.id === id)?.label || id

const getCurrentCase = () => state.casesById.get(state.currentCaseId)

const getStudyAnnotations = (studyId) => {
  if (!state.data.annotations[studyId]) state.data.annotations[studyId] = []
  return state.data.annotations[studyId]
}

const getStatus = (readingCase) =>
  state.data.reviews[readingCase.studyId]?.status ||
  (state.data.annotations[readingCase.studyId]?.length
    ? 'in-progress'
    : 'to-do')

const getStatusLabel = (status) => {
  if (status === 'to-do') return 'To do'
  if (status === 'in-progress') return 'In progress'
  return getLabel(state.data.reviewStatuses, status)
}

// ─── Case list ─────────────────────────────────────────────────────────────

const getCasesInGroup = (group) => {
  const { cases } = state.data
  if (group === 'all') return cases
  if (group === 'to-annotate') {
    return cases.filter((readingCase) => readingCase.groups.length)
  }
  return cases.filter((readingCase) => readingCase.groups.includes(group))
}

const getListedCases = () =>
  getCasesInGroup(state.groupFilter).filter(
    (readingCase) =>
      state.statusFilter === 'any' ||
      getStatus(readingCase) === state.statusFilter
  )

const getGroupOption = (value, label) => {
  const cases = getCasesInGroup(value)
  const finished = cases.filter((readingCase) =>
    FINISHED_STATUSES.includes(getStatus(readingCase))
  ).length
  return `<option value="${value}" ${state.groupFilter === value ? 'selected' : ''}>${escapeHtml(label)} (${finished} of ${cases.length} done)</option>`
}

const renderList = () => {
  const { groups } = state.data
  const listedCases = getListedCases()
  const statuses = [
    'to-do',
    'in-progress',
    ...state.data.reviewStatuses.map((status) => status.id)
  ]

  elements.list.innerHTML = `
    <div class="nhsuk-form-group nhsuk-u-margin-bottom-3">
      <label class="nhsuk-label" for="realCasesInitials">Annotator’s initials</label>
      <input class="nhsuk-input nhsuk-input--width-5" id="realCasesInitials" type="text" autocomplete="off" value="${escapeHtml(state.initials)}">
    </div>
    <div class="nhsuk-form-group nhsuk-u-margin-bottom-3">
      <label class="nhsuk-label" for="realCasesGroup">Cases</label>
      <select class="nhsuk-select" id="realCasesGroup">
        ${getGroupOption('to-annotate', 'All to annotate')}
        ${groups.map((group) => getGroupOption(group.id, group.label)).join('')}
        ${getGroupOption('all', 'All cases')}
      </select>
    </div>
    <div class="nhsuk-form-group nhsuk-u-margin-bottom-3">
      <label class="nhsuk-label" for="realCasesStatus">Status</label>
      <select class="nhsuk-select" id="realCasesStatus">
        <option value="any">Any</option>
        ${statuses.map((status) => `<option value="${status}" ${state.statusFilter === status ? 'selected' : ''}>${escapeHtml(getStatusLabel(status))}</option>`).join('')}
      </select>
    </div>
    <p class="nhsuk-body-s nhsuk-u-margin-bottom-2">${listedCases.length} cases</p>
    <div>
      ${listedCases.map(renderListItem).join('')}
    </div>
  `
}

const renderListItem = (readingCase) => {
  const status = getStatus(readingCase)
  const isCurrent = readingCase.id === state.currentCaseId
  return `
    <button type="button" class="app-real-cases__case ${isCurrent ? 'app-real-cases__case--current' : ''}" data-case-id="${readingCase.id}" ${isCurrent ? 'aria-current="true"' : ''}>
      <strong>${escapeHtml(readingCase.id)}</strong>
      <span class="app-real-cases__case-meta">Age ${escapeHtml(readingCase.age)} · ${escapeHtml(getResultLabel(readingCase.result))}</span>
      <span class="app-real-cases__tags">
        ${tag(getStatusLabel(status), STATUS_TAG_COLOURS[status])}
        ${readingCase.groups.map((group) => tag(getLabel(state.data.groups, group), GROUP_TAG_COLOURS[group])).join('')}
      </span>
    </button>
  `
}

// ─── Images ────────────────────────────────────────────────────────────────

const getImages = (readingCase) =>
  VIEW_ROWS.flat().flatMap((view) =>
    readingCase.images[view].map((image, index) => ({
      ...image,
      view,
      side: view.startsWith('r') ? 'right' : 'left',
      label:
        view.toUpperCase() +
        (readingCase.images[view].length > 1
          ? ` ${index + 1} of ${readingCase.images[view].length}`
          : '')
    }))
  )

const renderImage = (image, enlarged) => `
  <div class="app-real-cases__view-header">
    <span>${escapeHtml(image.label)}</span>
    <button type="button" class="app-real-cases__enlarge" data-enlarge="${enlarged ? '' : image.id}">
      ${enlarged ? 'Show all views' : 'Enlarge'}
    </button>
  </div>
  <div class="app-real-cases__image" data-image-id="${image.id}" data-side="${image.side}">
    <img src="${escapeHtml(enlarged && image.fullUrl ? image.fullUrl : image.url)}" alt="${escapeHtml(image.label)}" draggable="false">
  </div>
`

const renderImages = () => {
  const readingCase = getCurrentCase()
  if (!readingCase) {
    elements.images.innerHTML = '<p>No case selected.</p>'
    return
  }

  const listedCases = getListedCases()
  const listIndex = listedCases.indexOf(readingCase)
  const images = getImages(readingCase)
  const enlargedImage = images.find(
    (image) => image.id === state.enlargedImageId
  )

  const navigation = `
    <div class="app-real-cases__case-nav">
      <button type="button" class="nhsuk-button nhsuk-button--secondary nhsuk-button--small nhsuk-u-margin-bottom-1" data-move="-1" ${listIndex <= 0 ? 'disabled' : ''}>Previous case</button>
      <button type="button" class="nhsuk-button nhsuk-button--secondary nhsuk-button--small nhsuk-u-margin-bottom-1" data-move="1" ${listIndex === -1 || listIndex >= listedCases.length - 1 ? 'disabled' : ''}>Next case</button>
      <span class="nhsuk-body-s nhsuk-u-margin-bottom-0">${listIndex === -1 ? 'Not in the filtered list' : `${listIndex + 1} of ${listedCases.length}`}. Keys: N next, P previous, Esc deselect</span>
    </div>
  `

  if (enlargedImage) {
    elements.images.innerHTML = `
      ${navigation}
      <div class="app-real-cases__grid app-real-cases__grid--single">
        <div class="app-real-cases__view app-real-cases__view--${enlargedImage.side}">
          ${renderImage(enlargedImage, true)}
        </div>
      </div>
    `
  } else {
    elements.images.innerHTML = `
      ${navigation}
      <div class="app-real-cases__grid">
        ${VIEW_ROWS.flat()
          .map((view) => {
            const viewImages = images.filter((image) => image.view === view)
            const side = view.startsWith('r') ? 'right' : 'left'
            return `
              <div class="app-real-cases__view app-real-cases__view--${side}">
                ${viewImages.length ? viewImages.map((image) => renderImage(image, false)).join('') : `<p class="app-real-cases__no-image">No ${view.toUpperCase()}</p>`}
              </div>
            `
          })
          .join('')}
      </div>
    `
  }

  elements.images.querySelectorAll('img').forEach((img) => {
    img.addEventListener('error', () => {
      img.replaceWith(
        Object.assign(document.createElement('p'), {
          className: 'app-real-cases__no-image',
          textContent:
            'Image not available. Check real images are unlocked on /settings.'
        })
      )
    })
  })

  renderMarkers()
}

const renderMarkers = () => {
  const readingCase = getCurrentCase()
  if (!readingCase) return

  elements.images
    .querySelectorAll('.app-ann-marker')
    .forEach((marker) => marker.remove())

  getStudyAnnotations(readingCase.studyId).forEach((annotation, index) => {
    Object.entries(annotation.positions).forEach(([imageId, position]) => {
      const container = elements.images.querySelector(
        `.app-real-cases__image[data-image-id="${imageId}"]`
      )
      if (!container) return

      const marker = document.createElement('div')
      marker.className =
        'app-ann-marker' +
        (index === state.activeAnnotationIndex ? ' is-active' : '')
      marker.style.left = `${position.x * 100}%`
      marker.style.top = `${position.y * 100}%`
      marker.dataset.annotationIndex = index
      marker.dataset.imageId = imageId
      marker.innerHTML = `<div class="app-ann-marker__badge" aria-hidden="true">${index + 1}</div>`
      container.appendChild(marker)
    })
  })
}

const getFractionInImage = (container, event) => {
  const rect = container.getBoundingClientRect()
  const fraction = (value) =>
    Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000
  return {
    x: fraction((event.clientX - rect.left) / rect.width),
    y: fraction((event.clientY - rect.top) / rect.height)
  }
}

const createAnnotation = (readingCase, side) => {
  const lesionTypes = (readingCase.nbss?.lesions || [])
    .filter((lesion) => lesion.side === side)
    .flatMap((lesion) => lesion.abnormalityTypes)

  return {
    id: `a-${Date.now().toString(36)}`,
    side,
    positions: {},
    abnormalityType: [...new Set(lesionTypes)],
    levelOfConcern: readingCase.suggestedLevelOfConcern,
    finding: readingCase.suggestedFinding,
    notes: '',
    annotatedBy: state.initials,
    annotatedAt: today()
  }
}

const placeMarker = (container, event) => {
  const readingCase = getCurrentCase()
  const annotations = getStudyAnnotations(readingCase.studyId)
  const side = container.dataset.side
  let annotation = annotations[state.activeAnnotationIndex]

  if (!annotation || annotation.side !== side) {
    annotation = createAnnotation(readingCase, side)
    annotations.push(annotation)
    state.activeAnnotationIndex = annotations.length - 1
  }

  annotation.positions[container.dataset.imageId] = getFractionInImage(
    container,
    event
  )
  renderMarkers()
  renderEditor()
  scheduleSave()
}

const dragMarker = (marker, event) => {
  const container = marker.parentElement
  const annotation = getStudyAnnotations(getCurrentCase().studyId)[
    Number(marker.dataset.annotationIndex)
  ]
  marker.setPointerCapture(event.pointerId)

  const onMove = (moveEvent) => {
    const position = getFractionInImage(container, moveEvent)
    marker.style.left = `${position.x * 100}%`
    marker.style.top = `${position.y * 100}%`
  }
  const onUp = (upEvent) => {
    marker.removeEventListener('pointermove', onMove)
    marker.removeEventListener('pointerup', onUp)
    annotation.positions[marker.dataset.imageId] = getFractionInImage(
      container,
      upEvent
    )
    scheduleSave()
  }

  marker.addEventListener('pointermove', onMove)
  marker.addEventListener('pointerup', onUp)
}

// ─── Editor ────────────────────────────────────────────────────────────────

const describeReaders = (side) =>
  (side?.readers || [])
    .map(
      (reader, index) =>
        `Reader ${index + 1}: ${escapeHtml(
          reader.opinion
            ? `opinion ${READER_OPINIONS[reader.opinion] || reader.opinion}`
            : 'opinion not recorded'
        )}; recommended ${escapeHtml(ACTIONS[reader.action] || reader.action || 'nothing recorded')}`
    )
    .join('<br>')

const renderNbss = (readingCase) => {
  const nbss = readingCase.nbss
  if (!nbss) return '<p>No NBSS episode for this study.</p>'

  const sides = ['right', 'left']
    .map(
      (side) => `
        <p class="nhsuk-body-s nhsuk-u-margin-bottom-2">
          <strong>${side === 'right' ? 'Right breast' : 'Left breast'}:</strong> screening opinion ${escapeHtml(nbss[side]?.opinion || 'not recorded')}; final action ${escapeHtml(ACTIONS[nbss[side]?.finalAction] || nbss[side]?.finalAction || 'not recorded')}<br>
          ${describeReaders(nbss[side])}
        </p>
      `
    )
    .join('')

  const assessment = nbss.assessment
    ? `<p class="nhsuk-body-s nhsuk-u-margin-bottom-2"><strong>Assessment:</strong> outcome ${escapeHtml(nbss.assessment.outcome || 'not recorded')}, imaging opinion ${escapeHtml(nbss.assessment.opinion || 'not recorded')}, biopsy ${escapeHtml(nbss.assessment.biopsyOpinion || 'none')}</p>`
    : ''

  const lesions = nbss.lesions.length
    ? `<ul class="nhsuk-list nhsuk-list--bullet nhsuk-body-s">${nbss.lesions
        .map(
          (lesion) =>
            `<li>${lesion.side === 'right' ? 'Right' : 'Left'}: ${escapeHtml(lesion.description || 'lesion')}${lesion.sizeMm ? `, ${escapeHtml(lesion.sizeMm)} mm` : ''}, ${escapeHtml(lesion.positionText)} (${escapeHtml(lesion.position || 'no position')})</li>`
        )
        .join('')}</ul>`
    : '<p class="nhsuk-body-s">No lesions recorded.</p>'

  return `
    <p class="nhsuk-body-s nhsuk-u-margin-bottom-2"><strong>${escapeHtml(getResultLabel(readingCase.result))}</strong>, ${escapeHtml(FINAL_ACTION_SOURCES[nbss.finalActionSource] || 'decision source unknown')}</p>
    ${sides}
    ${assessment}
    <h3 class="nhsuk-heading-xs nhsuk-u-margin-bottom-1">Lesions</h3>
    ${lesions}
  `
}

const renderOtherStudies = (readingCase) => {
  const otherCases = state.casesByParticipant.get(readingCase.participantId)
  if (otherCases.length < 2) return ''

  return `
    <div class="app-real-cases__section">
      <h2 class="nhsuk-heading-s nhsuk-u-margin-bottom-2">All studies for this participant</h2>
      <ul class="nhsuk-list nhsuk-body-s">
        ${otherCases
          .map((otherCase) => {
            const result = getResultLabel(otherCase.result)
            return otherCase === readingCase
              ? `<li><strong>${escapeHtml(`Year ${otherCase.yearsFromFirst}: ${result}`)}</strong> - this study</li>`
              : `<li><a href="#${otherCase.id}" data-case-id="${otherCase.id}">${escapeHtml(`Year ${otherCase.yearsFromFirst}: ${result}${otherCase.groups.length ? ` (${getStatusLabel(getStatus(otherCase))})` : ''}`)}</a></li>`
          })
          .join('')}
      </ul>
    </div>
  `
}

const renderAnnotation = (annotation, index, readingCase) => {
  const isActive = index === state.activeAnnotationIndex
  const imageLabels = getImages(readingCase)
    .filter((image) => annotation.positions[image.id])
    .map((image) => image.label)
  const idBase = `realCasesAnnotation${index}`

  return `
    <div class="app-real-cases__annotation ${isActive ? 'app-real-cases__annotation--active' : ''}" data-annotation-index="${index}">
      <div class="app-real-cases__annotation-header">
        <h3 class="nhsuk-heading-xs nhsuk-u-margin-bottom-1">${index + 1}: ${annotation.side} breast</h3>
        <div>
          <button type="button" class="nhsuk-button nhsuk-button--secondary nhsuk-button--small" data-select-annotation="${index}">${isActive ? 'Deselect' : 'Select'}</button>
          <button type="button" class="nhsuk-button nhsuk-button--warning nhsuk-button--small" data-delete-annotation="${index}">Delete</button>
        </div>
      </div>
      <p class="nhsuk-body-s nhsuk-u-margin-bottom-2">Marked on: ${imageLabels.length ? escapeHtml(imageLabels.join(', ')) : 'no views yet'}</p>

      <fieldset class="nhsuk-fieldset nhsuk-u-margin-bottom-2">
        <legend class="nhsuk-fieldset__legend nhsuk-fieldset__legend--s">Abnormality type</legend>
        <div class="nhsuk-checkboxes nhsuk-checkboxes--small">
          ${state.data.abnormalityTypes
            .map(
              (type, typeIndex) => `
                <div class="nhsuk-checkboxes__item">
                  <input class="nhsuk-checkboxes__input" id="${idBase}Type${typeIndex}" type="checkbox" value="${escapeHtml(type)}" data-field="abnormalityType" ${annotation.abnormalityType.includes(type) ? 'checked' : ''}>
                  <label class="nhsuk-label nhsuk-checkboxes__label" for="${idBase}Type${typeIndex}">${escapeHtml(type)}</label>
                </div>
              `
            )
            .join('')}
        </div>
      </fieldset>

      <div class="nhsuk-form-group nhsuk-u-margin-bottom-2">
        <label class="nhsuk-label" for="${idBase}Concern">Level of concern</label>
        <select class="nhsuk-select" id="${idBase}Concern" data-field="levelOfConcern">
          <option value="">Not set</option>
          ${['1', '2', '3', '4', '5'].map((level) => `<option value="${level}" ${annotation.levelOfConcern === level ? 'selected' : ''}>${level}</option>`).join('')}
        </select>
      </div>

      <div class="nhsuk-form-group nhsuk-u-margin-bottom-2">
        <label class="nhsuk-label" for="${idBase}Finding">What it turned out to be</label>
        <select class="nhsuk-select" id="${idBase}Finding" data-field="finding">
          ${state.data.findings.map((finding) => `<option value="${finding.id}" ${annotation.finding === finding.id ? 'selected' : ''}>${escapeHtml(finding.label)}</option>`).join('')}
        </select>
      </div>

      <div class="nhsuk-form-group nhsuk-u-margin-bottom-0">
        <label class="nhsuk-label" for="${idBase}Notes">Notes</label>
        <input class="nhsuk-input" id="${idBase}Notes" type="text" autocomplete="off" data-field="notes" value="${escapeHtml(annotation.notes)}">
      </div>
    </div>
  `
}

const renderReview = (readingCase) => {
  const review = state.data.reviews[readingCase.studyId] || {}
  const options = [
    { id: '', label: 'Not finished' },
    ...state.data.reviewStatuses
  ]

  return `
    <div class="app-real-cases__section">
      <fieldset class="nhsuk-fieldset">
        <legend class="nhsuk-fieldset__legend nhsuk-fieldset__legend--s">
          <h2 class="nhsuk-fieldset__heading">Status</h2>
        </legend>
        <div class="nhsuk-radios nhsuk-radios--small">
          ${options
            .map(
              (option, index) => `
                <div class="nhsuk-radios__item">
                  <input class="nhsuk-radios__input" id="realCasesStatus${index}" name="realCasesReviewStatus" type="radio" value="${option.id}" data-review-field="status" ${(review.status || '') === option.id ? 'checked' : ''}>
                  <label class="nhsuk-label nhsuk-radios__label" for="realCasesStatus${index}">${escapeHtml(option.label)}</label>
                </div>
              `
            )
            .join('')}
        </div>
      </fieldset>
      <div class="nhsuk-form-group nhsuk-u-margin-top-3 nhsuk-u-margin-bottom-0">
        <label class="nhsuk-label" for="realCasesReviewNotes">Notes on this study</label>
        <textarea class="nhsuk-textarea" id="realCasesReviewNotes" rows="2" data-review-field="notes">${escapeHtml(review.notes)}</textarea>
      </div>
    </div>
  `
}

const renderEditor = () => {
  const readingCase = getCurrentCase()
  if (!readingCase) {
    elements.editor.innerHTML = ''
    return
  }

  const annotations = getStudyAnnotations(readingCase.studyId)

  elements.editor.innerHTML = `
    <div class="app-real-cases__section">
      <h2 class="nhsuk-heading-s nhsuk-u-margin-bottom-1">${escapeHtml(readingCase.id)}</h2>
      <p class="nhsuk-body-s nhsuk-u-margin-bottom-1">Age ${escapeHtml(readingCase.age)}. Year ${escapeHtml(readingCase.yearsFromFirst)} of this participant’s studies. Participant classed ${escapeHtml(CLASSIFICATIONS[readingCase.classification] || readingCase.classification || 'unknown')}${readingCase.higherRisk ? ', higher risk' : ''}. ${escapeHtml(readingCase.manufacturer || '')}</p>
      <p class="app-real-cases__save-status js-real-cases-save-status nhsuk-u-margin-bottom-0" role="status"></p>
    </div>

    <div class="app-real-cases__section">
      <h2 class="nhsuk-heading-s nhsuk-u-margin-bottom-2">NBSS</h2>
      ${renderNbss(readingCase)}
    </div>

    ${renderOtherStudies(readingCase)}

    <div class="app-real-cases__section">
      <h2 class="nhsuk-heading-s nhsuk-u-margin-bottom-2">Markers</h2>
      <p class="nhsuk-body-s">Click an image to mark what a screen reader would mark. Clicks on the same breast add to the selected marker; drag a selected marker to move it.</p>
      ${annotations.map((annotation, index) => renderAnnotation(annotation, index, readingCase)).join('')}
      <button type="button" class="nhsuk-button nhsuk-button--secondary nhsuk-button--small nhsuk-u-margin-bottom-1" data-new-annotation ${state.activeAnnotationIndex === null ? 'disabled' : ''}>New marker</button>
    </div>

    ${renderReview(readingCase)}
  `
}

const setSaveStatus = (text, isError = false) => {
  const status = elements.editor.querySelector('.js-real-cases-save-status')
  if (!status) return
  status.textContent = text
  status.classList.toggle('app-real-cases__save-status--error', isError)
}

// ─── Saving ────────────────────────────────────────────────────────────────

const save = async (studyId) => {
  const review = state.data.reviews[studyId]
  try {
    const response = await fetch('/admin/real-cases/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studyId,
        annotations: state.data.annotations[studyId] || [],
        review: review?.status ? review : null
      })
    })
    if (!response.ok) {
      throw new Error((await response.json()).error || response.statusText)
    }
    if (getCurrentCase()?.studyId === studyId) {
      setSaveStatus(`Saved at ${new Date().toLocaleTimeString()}`)
    }
  } catch (error) {
    setSaveStatus(`Not saved: ${error.message}`, true)
  }
}

const flushSave = () => {
  if (!state.pendingStudyId) return
  window.clearTimeout(state.saveTimer)
  const studyId = state.pendingStudyId
  state.pendingStudyId = null
  return save(studyId)
}

const scheduleSave = () => {
  const studyId = getCurrentCase().studyId
  if (state.pendingStudyId && state.pendingStudyId !== studyId) flushSave()
  state.pendingStudyId = studyId
  setSaveStatus('Saving…')
  window.clearTimeout(state.saveTimer)
  state.saveTimer = window.setTimeout(flushSave, SAVE_DELAY_MS)
}

// ─── Navigation ────────────────────────────────────────────────────────────

const showCase = (caseId) => {
  if (!state.casesById.has(caseId)) return
  flushSave()
  state.currentCaseId = caseId
  state.activeAnnotationIndex = null
  state.enlargedImageId = null
  if (window.location.hash !== `#${caseId}`) {
    window.history.replaceState(null, '', `#${caseId}`)
  }
  renderList()
  renderImages()
  renderEditor()
  elements.list
    .querySelector('.app-real-cases__case--current')
    ?.scrollIntoView({ block: 'nearest' })
}

const moveCase = (step) => {
  const listedCases = getListedCases()
  const index = listedCases.indexOf(getCurrentCase())
  const next = listedCases[index + step]
  if (index !== -1 && next) showCase(next.id)
}

// ─── Events ────────────────────────────────────────────────────────────────

const updateAnnotationField = (input) => {
  const index = Number(
    input.closest('[data-annotation-index]').dataset.annotationIndex
  )
  const annotation = getStudyAnnotations(getCurrentCase().studyId)[index]
  const field = input.dataset.field

  if (field === 'abnormalityType') {
    annotation.abnormalityType = [
      ...input.closest('.nhsuk-checkboxes').querySelectorAll('input:checked')
    ].map((checkbox) => checkbox.value)
  } else {
    annotation[field] = input.value
  }
  scheduleSave()
}

const updateReviewField = (input) => {
  const studyId = getCurrentCase().studyId
  const review = state.data.reviews[studyId] || {}
  review[input.dataset.reviewField] = input.value
  review.reviewedBy = state.initials
  state.data.reviews[studyId] = review
  scheduleSave()
  if (input.dataset.reviewField === 'status') renderList()
}

const setUpEvents = () => {
  elements.list.addEventListener('click', (event) => {
    const caseButton = event.target.closest('[data-case-id]')
    if (caseButton) showCase(caseButton.dataset.caseId)
  })

  elements.list.addEventListener('change', (event) => {
    if (event.target.id === 'realCasesGroup') {
      state.groupFilter = event.target.value
      renderList()
      renderImages()
    } else if (event.target.id === 'realCasesStatus') {
      state.statusFilter = event.target.value
      renderList()
      renderImages()
    }
  })

  elements.list.addEventListener('input', (event) => {
    if (event.target.id === 'realCasesInitials') {
      state.initials = event.target.value.trim()
      window.localStorage.setItem(INITIALS_STORAGE_KEY, state.initials)
    }
  })

  elements.images.addEventListener('click', (event) => {
    const moveButton = event.target.closest('[data-move]')
    if (moveButton) return moveCase(Number(moveButton.dataset.move))

    const enlargeButton = event.target.closest('[data-enlarge]')
    if (enlargeButton) {
      state.enlargedImageId = enlargeButton.dataset.enlarge || null
      return renderImages()
    }

    const marker = event.target.closest('.app-ann-marker')
    if (marker) {
      state.activeAnnotationIndex = Number(marker.dataset.annotationIndex)
      renderMarkers()
      return renderEditor()
    }

    const container = event.target.closest('.app-real-cases__image')
    if (container && container.querySelector('img')) {
      placeMarker(container, event)
    }
  })

  elements.images.addEventListener('pointerdown', (event) => {
    const marker = event.target.closest('.app-ann-marker.is-active')
    if (marker) {
      event.preventDefault()
      dragMarker(marker, event)
    }
  })

  elements.editor.addEventListener('click', (event) => {
    const caseLink = event.target.closest('[data-case-id]')
    if (caseLink) {
      event.preventDefault()
      return showCase(caseLink.dataset.caseId)
    }

    const selectButton = event.target.closest('[data-select-annotation]')
    if (selectButton) {
      const index = Number(selectButton.dataset.selectAnnotation)
      state.activeAnnotationIndex =
        state.activeAnnotationIndex === index ? null : index
      renderMarkers()
      return renderEditor()
    }

    const deleteButton = event.target.closest('[data-delete-annotation]')
    if (deleteButton) {
      const annotations = getStudyAnnotations(getCurrentCase().studyId)
      annotations.splice(Number(deleteButton.dataset.deleteAnnotation), 1)
      state.activeAnnotationIndex = null
      renderMarkers()
      renderEditor()
      renderList()
      return scheduleSave()
    }

    if (event.target.closest('[data-new-annotation]')) {
      state.activeAnnotationIndex = null
      renderMarkers()
      renderEditor()
    }
  })

  elements.editor.addEventListener('change', (event) => {
    if (event.target.dataset.field) updateAnnotationField(event.target)
    if (event.target.dataset.reviewField) updateReviewField(event.target)
  })

  elements.editor.addEventListener('input', (event) => {
    if (event.target.dataset.field === 'notes') {
      updateAnnotationField(event.target)
    }
    if (event.target.dataset.reviewField === 'notes') {
      updateReviewField(event.target)
    }
  })

  document.addEventListener('keydown', (event) => {
    if (event.target.closest('input, textarea, select')) return
    if (event.metaKey || event.ctrlKey || event.altKey) return

    if (event.key === 'n') moveCase(1)
    if (event.key === 'p') moveCase(-1)
    if (event.key === 'Escape') {
      if (state.activeAnnotationIndex !== null) {
        state.activeAnnotationIndex = null
        renderMarkers()
        renderEditor()
      } else if (state.enlargedImageId) {
        state.enlargedImageId = null
        renderImages()
      }
    }
  })

  window.addEventListener('beforeunload', flushSave)
}

const start = async () => {
  elements.list = document.querySelector('.js-real-cases-list')
  elements.images = document.querySelector('.js-real-cases-images')
  elements.editor = document.querySelector('.js-real-cases-editor')
  if (!elements.list) return

  const response = await fetch('/admin/real-cases/data')
  if (!response.ok) {
    elements.list.innerHTML = '<p>Could not load the pack’s cases.</p>'
    return
  }
  state.data = await response.json()

  for (const readingCase of state.data.cases) {
    state.casesById.set(readingCase.id, readingCase)
    const participantCases =
      state.casesByParticipant.get(readingCase.participantId) || []
    participantCases.push(readingCase)
    state.casesByParticipant.set(readingCase.participantId, participantCases)
  }

  setUpEvents()

  const hashCaseId = window.location.hash.slice(1)
  const firstCase = state.casesById.has(hashCaseId)
    ? hashCaseId
    : (getListedCases()[0] || state.data.cases[0])?.id
  if (firstCase) {
    showCase(firstCase)
  } else {
    renderList()
  }
}

start()
