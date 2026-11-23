// scripts/real-images/build-fake-pack.js
//
// Builds a fake real image pack from the diagrams, in the real pack layout
// (docs/mammogram-images.md), for trying and testing real images without real
// data. It holds only diagrams, so it is safe to share.
//
// Run with: node scripts/real-images/build-fake-pack.js /path/to/fake-pack
// Then start the prototype with REAL_IMAGES_PATH=/path/to/fake-pack and
// MAMMOGRAM_IMAGE_SOURCE=real.
//
// What it covers: participants with several cases, priors, a case with a
// repeated view, an implant case, abnormal cases with annotations, a technical
// case, and a case with no known outcome (which the prototype leaves out).

const fs = require('fs')
const path = require('path')

const diagramsPath = path.join(
  __dirname,
  '../../app/assets/images/mammogram-diagrams'
)
const diagramManifest = JSON.parse(
  fs.readFileSync(path.join(diagramsPath, 'manifest.json'), 'utf8')
)

// IDs have the real format, starting 'fa4e' so they read as fake.
// Each study borrows a diagram set's views. A view can list several images, as
// a repeat; the last is the one kept.
const participants = [
  {
    id: 'p-fa4e0001',
    classification: 'N',
    studies: [
      { id: 's-fa4e0101', set: 'set-17', result: 'normal' },
      { id: 's-fa4e0102', set: 'set-18', result: 'normal' }
    ]
  },
  {
    id: 'p-fa4e0002',
    classification: 'M',
    studies: [
      { id: 's-fa4e0201', set: 'set-19', result: 'normal' },
      { id: 's-fa4e0202', set: 'set-04', result: 'cancer' }
    ]
  },
  {
    id: 'p-fa4e0003',
    classification: 'N',
    studies: [
      {
        id: 's-fa4e0301',
        set: 'set-20',
        result: 'normal',
        extraImages: { rmlo: 'image-library/blur-2-rmlo.png' }
      }
    ]
  },
  {
    id: 'p-fa4e0004',
    classification: 'N',
    studies: [
      {
        id: 's-fa4e0401',
        set: 'set-27',
        result: 'technical-repeat-requested'
      },
      { id: 's-fa4e0402', set: 'set-21', result: null }
    ]
  },
  {
    id: 'p-fa4e0005',
    classification: 'B',
    hasImplants: true,
    studies: [
      { id: 's-fa4e0501', set: 'set-02', result: 'normal' },
      { id: 's-fa4e0502', set: 'set-03', result: 'recalled-not-cancer' }
    ]
  }
]

const VIEWS = ['rcc', 'lcc', 'rmlo', 'lmlo']

// Case tag for each NBSS result, as the pack builder sets it
const RESULT_TAGS = {
  'normal': 'normal',
  'recalled-not-cancer': 'abnormal',
  'cancer': 'abnormal',
  'technical-repeat-requested': 'technical'
}

const outPath = process.argv[2]
if (!outPath) {
  console.error(
    'Usage: node scripts/real-images/build-fake-pack.js /path/to/fake-pack'
  )
  process.exit(1)
}

// A real pack has an ID map; never write over one
if (fs.existsSync(path.join(outPath, 'id-map.json'))) {
  console.error(`${outPath} holds a real pack. Choose another folder.`)
  process.exit(1)
}

fs.rmSync(path.join(outPath, 'images'), { recursive: true, force: true })

const diagramSet = (setId) =>
  diagramManifest.sets.find((set) => set.id === setId)

let imageCount = 0
const annotations = { studies: {} }

const buildStudy = (participant, study, index) => {
  const set = diagramSet(study.set)
  const studyFolder = path.join('images', participant.id, study.id)
  fs.mkdirSync(path.join(outPath, studyFolder), { recursive: true })

  const images = []
  const imageIdsByView = {}
  const addImage = (view, sourceFile) => {
    imageCount++
    const id = `i-fa4e${imageCount.toString(16).padStart(4, '0')}`
    const file = `${studyFolder}/${id}-display.png`
    fs.copyFileSync(
      path.join(diagramsPath, sourceFile),
      path.join(outPath, file)
    )
    images.push({
      id,
      view,
      modifiers: [],
      synthetic2D: false,
      instance: images.length + 1,
      width: 825,
      height: 1000,
      pixelSpacingMm: 0.1,
      flipped: false,
      files: { display: file, full: null }
    })
    imageIdsByView[view] = id
  }

  for (const view of VIEWS) {
    if (study.extraImages?.[view]) addImage(view, study.extraImages[view])
    addImage(view, `${study.set}/${view}.png`)
  }

  if (set.annotations?.length) {
    annotations.studies[study.id] = set.annotations.map(
      (annotation, annotationIndex) => ({
        id: `a-${annotationIndex + 1}`,
        side: annotation.side,
        positions: Object.fromEntries(
          Object.entries(annotation.positions).map(([view, position]) => [
            imageIdsByView[view],
            position
          ])
        ),
        abnormalityType: annotation.abnormalityType,
        levelOfConcern: annotation.levelOfConcern,
        notes: annotation.notes || '',
        scale: annotation.scale || 2,
        annotatedBy: 'fake',
        annotatedAt: '2026-11-13'
      })
    )
  }

  const side = (sideName) => {
    const status = set[sideName]?.status
    return {
      opinion: status === 'abnormal' ? 'abnormal' : 'normal',
      finalAction: study.result === 'normal' ? 'RR' : 'RC',
      readers: []
    }
  }

  return {
    id: study.id,
    kind: 'screening',
    daysFromFirst: index * 1095,
    ageAtStudy: 53 + index * 3,
    manufacturer: 'Fake',
    model: 'Diagrams',
    hasImplants: Boolean(participant.hasImplants),
    nbss: study.result
      ? {
          episodeCharacter: index === 0 ? 'F' : 'R',
          recalled: RESULT_TAGS[study.result] === 'abnormal',
          cancerFound: study.result === 'cancer',
          result: study.result,
          technicalRepeatRequested:
            study.result === 'technical-repeat-requested',
          finalActionSource: 'A',
          right: side('right'),
          left: side('left'),
          lesions: [],
          assessment: null
        }
      : null,
    images
  }
}

const manifestParticipants = participants.map((participant) => ({
  id: participant.id,
  classification: participant.classification,
  higherRisk: false,
  studies: participant.studies.map((study, index) =>
    buildStudy(participant, study, index)
  )
}))

const cases = participants.flatMap((participant) =>
  participant.studies.map((study, index) => {
    const set = diagramSet(study.set)
    const sideStatus = (sideName) => ({
      status: set[sideName]?.status === 'abnormal' ? 'abnormal' : 'normal'
    })
    return {
      id: study.id.replace(/^s-/, 'c-'),
      participantId: participant.id,
      currentStudyId: study.id,
      priorStudyIds: participant.studies
        .slice(0, index)
        .map((priorStudy) => priorStudy.id),
      tag: study.result ? RESULT_TAGS[study.result] : 'unknown',
      result: study.result,
      right: sideStatus('right'),
      left: sideStatus('left'),
      hasRepeat: Boolean(study.extraImages),
      hasImplants: Boolean(participant.hasImplants),
      higherRisk: false,
      ageAtCurrent: 53 + index * 3
    }
  })
)

const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  participants: manifestParticipants,
  cases
}

fs.writeFileSync(
  path.join(outPath, 'manifest.json'),
  JSON.stringify(manifest, null, 2)
)
fs.writeFileSync(
  path.join(outPath, 'annotations.json'),
  JSON.stringify(annotations, null, 2)
)

console.log(
  `Fake pack written to ${outPath}: ${participants.length} participants, ${cases.length} cases, ${imageCount} images`
)
