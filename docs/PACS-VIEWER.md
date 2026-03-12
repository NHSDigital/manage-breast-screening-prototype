# PACS Viewer (Mammogram Viewer)

The PACS viewer simulates a Picture Archiving and Communication System on a separate monitor, displaying mammogram images for the current participant during image reading.

---

## Overview

In the real breast screening service, when a radiologist opens a participant for reading, their mammograms automatically appear in a PACS viewer on a separate monitor. As they advance to the next case, PACS updates to show the next set of mammograms.

This prototype simulates that behaviour using:

- **BroadcastChannel API** for communication between reading pages and viewer window
- **Seeded random image selection** so the same participant always shows the same images
- **Context-aware selection** matching image sets to participant context (symptoms, implants, imperfect images, repeats)
- **Weighted distribution** to control the mix of normal/abnormal/indeterminate/technical cases
- **Composite sets** allowing reuse of views from other sets and individual images from the image library

---

## How It Works

### Opening the Viewer

- **Manual**: Click "Open PACS viewer" link in header navigation (visible during reading workflow)
- **Auto-open**: If `autoOpenPacsViewer` setting is enabled, viewer opens automatically when entering reading workflow

### Communication Flow

1. Reading workflow pages include meta tags with participant and image data
2. `mammogram-channel.js` broadcasts participant data on page load
3. Viewer listens on BroadcastChannel (`mammogram-viewer`) and updates display
4. Same eventId messages are ignored (prevents flash when navigating within same case)
5. When leaving reading workflow, `clear` message shows placeholder in viewer

### Viewer Detection (Ping/Pong)

Before auto-opening, the parent page checks if a viewer is already open:

1. Parent sends "ping" message via BroadcastChannel
2. If viewer responds with "pong" within 100ms → already open, don't auto-open
3. If no response → open new viewer window

This prevents focus stealing and duplicate windows.

### Initial Load (Request/Response)

When the viewer opens (manually or auto), it requests current participant data:

1. Viewer sends "request-current" message
2. Any parent page with participant data responds with current info
3. Viewer immediately shows correct participant (instead of "Waiting for participant")

### Viewer Features

- **Zoom**: Click any image in the main grid to view fullscreen; click or press Escape to close
- **Keyboard navigation**: Arrow keys cycle through zoomed images (ordered by breast: right then left). When not zoomed, left arrow opens first right breast image, right arrow opens first left breast image.
- **Opinion shortcuts**: Press N (normal), T (technical recall), or R (recall for assessment) to trigger the corresponding opinion on the reading page - works even when PACS viewer is focused
- **Additional images**: When a case has repeat/retake images, "View additional images" button appears; modal shows all attempts with labels
- **Debug mode**: Press 'd' to toggle debug bar showing set ID, tag, description, and context flags

---

## Image Sets

### Storage

- **Diagrams**: `app/assets/images/mammogram-diagrams/`
  - Complete sets: `set-XX/` folders with 4 views
  - Image library: `library/` folder with individual images
- **Real images** (future): `app/assets/images/mammogram-sets/`

Each complete set contains four views: `rcc.png`, `lcc.png`, `rmlo.png`, `lmlo.png`

### Manifest

`manifest.json` in each source folder defines both the image library and available sets:

```json
{
  "images": [
    {
      "id": "blur-2-rmlo",
      "path": "library/blur-2-rmlo.png",
      "view": "rmlo",
      "status": "technical",
      "issue": "blur"
    }
  ],
  "sets": [
    {
      "id": "set-17",
      "tag": "normal",
      "description": "Normal mammogram"
    },
    {
      "id": "repeat-normal-blur-rmlo",
      "tag": "normal",
      "hasRepeat": true,
      "description": "Normal mammogram with RMLO retake (first was blurred)",
      "views": {
        "rmlo": [
          { "image": "blur-2-rmlo" },
          { "from": "set-17" }
        ],
        "lmlo": { "from": "set-17" },
        "rcc": { "from": "set-17" },
        "lcc": { "from": "set-17" }
      }
    }
  ]
}
```

Tags: `normal`, `abnormal`, `indeterminate`, `technical`

### Context-Aware Selection

Image sets are selected based on participant/event context:

| Context Flag  | Behaviour                                                                   |
| ------------- | --------------------------------------------------------------------------- |
| `hasSymptoms` | Increases probability of abnormal sets; prefers abnormality on symptom side |
| `hasImplants` | Only selects sets with `hasImplants: true` flag                             |
| `isImperfect` | Increases probability of technical sets                                     |
| `hasRepeat`   | Only selects sets with `hasRepeat: true` flag                               |

Context is extracted from event data by `extractEventContext()` in `mammogram-images.js`.

### Weighted Selection

When no context requires hard filtering, sets are selected using weighted random based on tag:

- Default: 75% normal, 15% abnormal, 5% indeterminate, 5% technical
- With symptoms: 30% normal, 50% abnormal, 10% indeterminate, 10% technical
- With imperfect images: 10% normal, 10% abnormal, 0% indeterminate, 80% technical
- Configured in `config.reading.mammogramTagWeights`
- Selection is deterministic per event ID (seeded random)

### Missing Views

If a mammogram view is missing from `event.mammogramData.views`, the viewer shows "No image" placeholder for that panel. The image selection system filters paths to only include views present in the event's mammogram data.

### Composite Sets

Sets can reference other sets or the image library to create composites:

**View definition options:**

- `{ "from": "set-17" }` - Use view from another set
- `{ "image": "blur-2-rmlo" }` - Use image from library
- `{ "path": "custom/path.png" }` - Use explicit path
- Omitted - Defaults to `{set-id}/{view}.png`

**Array format for repeats:**

```json
{
  "rmlo": [
    { "image": "blur-2-rmlo" },
    { "from": "set-17" }
  ]
}
```

First element is the initial (failed) attempt, last element is the final (used) image.

### Additional Images

When sets have arrays for views (repeat scenarios), the viewer:

1. Shows the latest (last) image in the main grid
2. Displays "View additional images" button
3. Modal shows all attempts labelled "Attempt 1", "Attempt 2", "Latest"
4. Click any image in the modal to zoom

---

## Configuration

### User Settings (`data.settings`)

| Setting              | Default      | Description                                                        |
| -------------------- | ------------ | ------------------------------------------------------------------ |
| `debugMode`          | `'false'`    | Show debug info (tags like Has repeat, Imperfect, etc.)            |
| `mammogramViewOrder` | `'cc-first'` | View order: `'cc-first'` (CC on top) or `'mlo-first'` (MLO on top) |

### User Settings (`data.settings.reading`)

| Setting              | Default   | Description                                     |
| -------------------- | --------- | ----------------------------------------------- |
| `autoOpenPacsViewer` | `'false'` | Auto-open viewer when entering reading workflow |

### Hard Config (`config.reading`)

| Setting                | Default                                                                  | Description                             |
| ---------------------- | ------------------------------------------------------------------------ | --------------------------------------- |
| `mammogramImageSource` | `'diagrams'`                                                             | Image source: `'diagrams'` or `'real'`  |
| `mammogramTagWeights`  | `{ normal: 0.75, abnormal: 0.15, indeterminate: 0.05, technical: 0.05 }` | Distribution weights for image set tags |

---

## Files

### Core Files

| File                                         | Purpose                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `app/lib/utils/mammogram-images.js`          | Image selection utility (weighted seeded random, path generation)        |
| `app/assets/javascript/mammogram-channel.js` | BroadcastChannel communication (broadcast, listen, ping/pong, auto-open) |
| `app/views/reading/mammogram-viewer.html`    | Viewer page (dark theme, 2×2 grid, placeholder states)                   |

### Integration Points

| File                                       | Purpose                                           |
| ------------------------------------------ | ------------------------------------------------- |
| `app/views/_templates/layout-reading.html` | Meta tags for viewer data, missing view detection |
| `app/views/_templates/layout-base.html`    | "Open PACS viewer" link in header nav             |
| `app/views/_includes/scripts.html`         | mammogram-channel.js include                      |

### Data Files

| File                                                 | Purpose                                          |
| ---------------------------------------------------- | ------------------------------------------------ |
| `app/assets/images/mammogram-diagrams/manifest.json` | Image set metadata (25 sets)                     |
| `app/data/session-data-defaults.js`                  | `autoOpenPacsViewer` setting default             |
| `app/config.js`                                      | `mammogramImageSource` and `mammogramTagWeights` |

### Scripts

| File                                  | Purpose                                                              |
| ------------------------------------- | -------------------------------------------------------------------- |
| `scripts/process-mammogram-sets.sh`   | Process raw mammogram set screenshots (rename, grayscale, compress)  |
| `scripts/process-mammogram-images.sh` | Process individual mammogram images (grayscale, compress, no rename) |

---

## Processing New Image Sets

The `scripts/process-mammogram-sets.sh` script processes raw mammogram screenshots:

- Renames screenshots to view names (`rmlo.png`, `lmlo.png`, `rcc.png`, `lcc.png`) based on chronological order
- Converts to grayscale
- Compresses with pngquant (8 colours)
- Optionally resizes

### Requirements

- ImageMagick (`magick`)
- pngquant

### Usage

```bash
# Preview changes (dry run)
./scripts/process-mammogram-sets.sh reference/test-sets --dry-run

# Process to output directory
./scripts/process-mammogram-sets.sh reference/test-sets --output processed-sets

# Process with resize (825px width)
./scripts/process-mammogram-sets.sh reference/test-sets --output processed-sets --resize 825
```

### Expected Input Structure

```
input-dir/
  set-02/
    Screenshot 2026-01-23 at 10.15.01.png  → rmlo.png
    Screenshot 2026-01-23 at 10.15.02.png  → lmlo.png
    Screenshot 2026-01-23 at 10.15.03.png  → rcc.png
    Screenshot 2026-01-23 at 10.15.04.png  → lcc.png
  set-03/
    ...
```

## Processing Individual Images

The `scripts/process-mammogram-images.sh` script processes individual mammogram images (not sets):

- Converts to grayscale
- Compresses with pngquant (8 colours)
- Optionally resizes
- Preserves original filenames
- Accepts a folder or individual file paths

### Usage

```bash
# Process all PNGs in a folder
./scripts/process-mammogram-images.sh reference/image-library-source --output reference/image-library-full

# Process specific files
./scripts/process-mammogram-images.sh reference/source/normal-lcc.png reference/source/normal-lmlo.png --output reference/image-library-full

# With resize
./scripts/process-mammogram-images.sh reference/source/file.png --output reference/image-library-half --resize 825
```

---

## Future Enhancements

- [ ] Test/verify probability distribution (debug route to sample many events)
- [ ] Real mammogram images integration (local gitignored folder)
- [ ] Annotation inheritance for composite sets (abnormality markers)
- [ ] Breast features alignment (moles, scars visible in mammograms)

---

## Planning

### Completed Features

The following planned features have been implemented:

- [x] **Image library**: Individual images stored in `library/` folder with metadata
- [x] **Composite sets**: Sets can reference other sets (`from`) or image library (`image`)
- [x] **Per-breast metadata**: `left` and `right` status on sets
- [x] **Context-aware selection**: Symptoms, implants, imperfect images, repeats
- [x] **Side preference**: Abnormalities matched to symptom side (70% probability)
- [x] **View filtering**: Only show views present in mammogram data
- [x] **Additional images**: Support for repeat/retake scenarios with modal viewer
- [x] **Debug display**: Press 'd' in viewer to see set info and context flags
- [x] **Repeat sets**: 7 composite sets with `hasRepeat: true` flag

### Real Mammogram Images

Real mammogram images cannot be committed to the public repo. Strategy:

- Store in a gitignored local folder (e.g., `app/assets/images/mammogram-sets/`)
- Create a manifest file (`manifest.json`) in that folder, same structure as diagrams
- Existing config `mammogramImageSource: 'diagrams' | 'real'` already supports switching
- Code already looks for manifest in appropriate folder based on source
- Document the expected folder structure so images can be added locally

### Richer Manifest Metadata

Current manifest only has overall `tag` (normal/abnormal/indeterminate). Enhancements:

**Per-breast detail:**

```json
{
  "id": "set-03",
  "tag": "abnormal",
  "description": "Implants + cancer RUOQ M5",
  "left": { "status": "normal" },
  "right": { "status": "abnormal", "location": "UOQ", "finding": "mass" }
}
```

**Participant matching criteria:**

```json
{
  "hasImplants": true,
  "technicalIssue": null,
  "findings": ["mass", "calcification"]
}
```

This enables smarter selection:

- Participant has symptoms in left breast → prefer sets with left breast abnormality
- Participant has implants → select implant sets
- Technical recall case → select sets with technical issues
- Event has repeat images → select repeat sets

### Composite Sets Architecture

The manifest supports composing sets from other sets and the image library:

1. **Image library**: Individual images stored with metadata in `library/` folder.

   ```json
   {
     "images": [
       {
         "id": "normal-rmlo-01",
         "path": "library/normal-rmlo-01.png",
         "view": "rmlo",
         "status": "normal"
       },
       {
         "id": "blurry-lcc-01",
         "path": "library/blurry-lcc-01.png",
         "view": "lcc",
         "status": "technical",
         "issue": "blurry"
       }
     ]
   }
   ```

2. **Set definitions**: Sets can use default paths, reference other sets, or reference image library.

   ```json
   {
     "sets": [
       {
         "id": "set-17",
         "tag": "normal",
         "description": "Normal mammogram"
       },
       {
         "id": "tech-blurry-lcc",
         "tag": "technical",
         "description": "Blurry LCC view",
         "views": {
           "rmlo": { "from": "set-17" },
           "lmlo": { "from": "set-17" },
           "rcc": { "from": "set-17" },
           "lcc": { "image": "blurry-lcc-01" }
         }
       }
     ]
   }
   ```

   **View object properties:**
   - `from`: Reference another set (inherits that set's image for this view)
   - `image`: Reference an image from the image library by ID
   - `path`: Override the image path (defaults to `{set-id}/{view}.png`)

   **Resolution order:**
   1. If `image` specified, load from image library
   2. If `from` specified, inherit from that set's view
   3. Apply any explicit path override
   4. If view omitted entirely, defaults to `{set-id}/{view}.png`

3. **Array format for repeats**: Views can be arrays to represent multiple attempts.

   ```json
   {
     "id": "repeat-normal-blur-rmlo",
     "tag": "normal",
     "hasRepeat": true,
     "views": {
       "rmlo": [
         { "image": "blur-2-rmlo" },
         { "from": "set-17" }
       ],
       "lmlo": { "from": "set-17" },
       "rcc": { "from": "set-17" },
       "lcc": { "from": "set-17" }
     }
   }
   ```

4. **Per-breast metadata**: Specified at set level for selection logic.

   ```json
   {
     "id": "set-03",
     "tag": "abnormal",
     "left": { "status": "normal" },
     "right": { "status": "abnormal" }
   }
   ```

5. **Special flags**:
   - `hasImplants: true` - Set shows implants, only selected for participants with implants
   - `hasRepeat: true` - Set has repeat images, only selected for events with repeats
   - `disabled: true` - Set excluded from selection

**Current technical issue images in library:**

- Blur (various views)
- Positioning short
- Overexposed
- Underexposed
- Skin fold

### Annotation Inheritance (Future)

Annotations are tied to a breast (pair of views), not individual images. Future implementation:

- When both views for a side come from the same source set, inherit that set's annotations
- Composite sets can optionally override with explicit `annotations` array
- Image library items can have annotations for abnormality images

### Breast Features Alignment (Future)

Long-term: Align mammographer-marked breast features (moles, scars) with mammogram sets.

Options:

- Hardcode breast features for specific sets
- Hardcode mammogram sets with visible marks
- Dynamically overlay marks on "clean" sets (complex)

## To do

Don't show implant images where implants have been removed
bird's eye viewer doens't update when moving between participant - reset to normal view
