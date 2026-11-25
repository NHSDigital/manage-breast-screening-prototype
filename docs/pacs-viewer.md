# PACS Viewer (Mammogram Viewer)

The PACS viewer simulates a Picture Archiving and Communication System on a separate monitor, displaying mammogram images for the current participant during image reading.

For how appointments get their images across the prototype, and the real images being added, see [mammogram-images.md](mammogram-images.md).

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
- **From an issue**: "Open study in PACS" on an issue page opens the viewer for that issue's images (see [issues.md](issues.md#images-on-the-issue-page))

### Screens

Most units read on two portrait monitors side by side. The `pacsScreens` setting chooses:

- **Two** (default): the viewer opens on the left half of the screen as screen 1 (`/reading/mammogram-viewer`), then opens screen 2 (`?screen=2`, window name `mammogram-viewer-2`) on the right half. Browsers allow one pop-up per click, so screen 1 opens screen 2 itself; if that is blocked, an “Open screen 2” button appears in screen 1's header. Screen 2 gets its study and layout from screen 1. Closing either with “Close viewer” closes both.
- **One**: a single landscape window showing screen 1 and screen 2 side by side. Opening it closes any screen 2 left over from two-screen mode.

“Use one screen” or “Use two screens” in the viewer header switches mode. It saves the setting through the URL, then reloads the viewer, resizing the window and opening or closing screen 2. Layout, prior and image choices are kept across the reload (in `sessionStorage`). Screen 2's button asks screen 1 to switch, since screen 1 does the work. The reading page updates its `pacs-viewer-screens` meta, so reopening the viewer uses the new size. Changing the setting elsewhere takes effect when the viewer next loads. The two screens also compare their Priors layout, Current layout and view order settings: if they loaded with different ones, the screen that loaded first reloads, keeping its study and layout.

### Layouts (hanging protocol)

| Layout  | Screen 1                                                               | Screen 2                     | Shown                                 |
| ------- | ---------------------------------------------------------------------- | ---------------------------- | ------------------------------------- |
| Priors  | On the side: current study, right and left side by side, in view order | The prior, the same way      | First, when there are priors          |
| Priors  | On top: first view in view order, prior above current                  | The other view, the same way | First, when there are priors          |
| Current | By breast: right breast, first view in view order on top               | Left breast, the same way    | First, when there are none            |
| Current | By view: first view in view order, right and left side by side         | The other view, the same way | First, when there are none            |
| MLO     | RMLO                                                                   | LMLO                         |                                       |
| CC      | RCC                                                                    | LCC                          |                                       |
| RMLO    | Current RMLO                                                           | Prior RMLO                   | When current and a prior have an RMLO |
| LMLO    | Current LMLO                                                           | Prior LMLO                   | When current and a prior have an LMLO |
| RCC     | Current RCC                                                            | Prior RCC                    | When current and a prior have an RCC  |
| LCC     | Current LCC                                                            | Prior LCC                    | When current and a prior have an LCC  |

Header buttons or ← → switch layout, in both screens at once. Right-breast images sit against the right edge of their panel and left-breast images against the left, so a left and right pair is bookmatched; in the single-view layouts current and prior are the same breast, so they sit against the same edge. Every panel is labelled with its view, and its study date (“Nov 2026”) on a second line, the same for current and prior images. Current panels have a blue outline and prior panels a yellow one. Layouts are in `LAYOUTS` in the viewer script. The “Priors layout” and “Current layout” settings choose between the two arrangements of Priors and Current, read when the viewer loads. Both arrangements of each follow `mammogramViewOrder`: CC first puts CCs on top, or on screen 1.

Pages give the viewer their study with `_includes/images/pacs-viewer-meta.njk`, included in the head after setting `viewerAppointment`, `viewerParticipant` and `viewerAutoOpen`. The reading layout and the issue page use it.

### Communication Flow

1. Reading workflow pages include meta tags with participant and image data
2. `mammogram-channel.js` broadcasts participant data on page load
3. Viewer listens on BroadcastChannel (`mammogram-viewer`) and updates display
4. Same appointmentId messages are ignored (prevents flash when navigating within same case)
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

- **Zoom**: Click an image to open it fullscreen at 4 times the fitted size, centred on the point clicked. Zoomed in, the image can be panned until any point of it, even its edge, is at the centre. Click again (without dragging), press Escape or use the Close button to close
- **Zoom in and pan**: In the fullscreen view, scroll the mouse wheel or pinch on a trackpad to zoom towards the pointer, or press + and - to zoom on the centre, up to 8 times the fitted size; 0 goes back to fit. Drag to pan. A small indicator shows the zoom level (“Fit” or a percentage of the fitted size). Moving to another image opens it fitted. If a set has a full-resolution file for an image (real images do), it's loaded the first time that image is zoomed in
- **Keyboard navigation**: In the grid, ← → change layout. Fullscreen, ← → move through the images on this screen, in layout order; they don't pan.
- **Opinion shortcuts**: Press N (normal), D (normal, but add details), T (technical recall), or R (recall for assessment) to trigger the corresponding opinion on the reading page - works even when PACS viewer is focused. When the participant has symptoms, plain Normal is not offered: “Normal, and add details” replaces it, and both N and D trigger it
- **Additional images**: A panel whose view has more than one image (a repeat, or extra images of a large breast), in the current study or a prior, shows the latest with numbered buttons (“1”, “2 (latest)”) to flick between them in place, so a prior stays alongside. The label says which (“RMLO (1 of 2)”). The choice holds across layouts, fullscreen and both screens, and resets for the next participant. Implant displaced views (RCCID, LCCID) show as extra images of their CC, after its own images, with buttons such as “2 (ID)”; the panel opens on the CC
- **Priors**: When the participant has earlier studies, the Priors layout and the single-view layouts (RMLO, LMLO, RCC, LCC) compare the current study with one of them, the most recent by default. Buttons in the header (“Prior: 3 years ago”, with the date on hover, newest on the left) choose which, up to `config.reading.maxPriorStudiesInViewer` (3) priors; [ and ] step newer or older, matching the buttons. The buttons only show in layouts with priors; [ or ] from another layout switches to Priors. A single-view layout is offered when the current study and at least one prior have that view; if the chosen prior doesn't, its panel shows “No image”. When there are no priors, the header says “No priors” and none of these layouts are offered. Fullscreen, [ and ] show the same view from a newer or older study at the same zoom and position, skipping studies without that view. A new participant always opens on the default layout and most recent prior
- **Debug mode**: Press 'i' to toggle debug bar showing set ID, tag, description, and context flags

#### Keyboard shortcuts

| Key        | Where      | Does                                                                         |
| ---------- | ---------- | ---------------------------------------------------------------------------- |
| ← →        | Grid       | Previous or next layout, on both screens                                     |
| ← →        | Fullscreen | Previous or next image on this screen                                        |
| + -        | Fullscreen | Zoom in or out                                                               |
| 0          | Fullscreen | Back to fit                                                                  |
| [ ]        | Grid       | Newer ([) or older (]) prior, or back to Priors from a layout without priors |
| [ ]        | Fullscreen | Same view from a newer ([) or older (]) study                                |
| Escape     | Fullscreen | Close                                                                        |
| N, D, T, R | Anywhere   | Opinion shortcuts, sent to the reading page                                  |
| i          | Anywhere   | Toggle the debug bar                                                         |

Full-resolution images reach the viewer as `fullPaths`, a map from display path to full path, in the `mammogram-full-paths` meta tag. Only real image sets have them (`fullPaths` in `app/lib/real-images.js`).

Priors reach the viewer as `priors` in the `mammogram-priors` meta tag, from `getPriorImagesForAppointment()` in `app/lib/utils/mammogram-images.js`. Each has a `label` (“3 years ago”), `dateText` (“Dec 2023”), `paths`, `allPaths`, `hasAdditionalImages` and `fullPaths`.

- **Real images**: the case's own earlier studies from the pack, dated back from the appointment by the gap between the studies. They don't follow the participant's generated screening history.
- **Diagrams**: one for each mammogram in the participant's earlier episodes (historic or not), on its date, showing a normal set other than the current one, with matching implants. Seeded by participant and date, so the same each time.

Priors show even when the case is waiting for priors to be requested (`appointment.previousMammograms`); the two aren't linked yet.

---

## Image Sets

### Storage

- **Diagrams**: `app/assets/images/mammogram-diagrams/`
  - Complete sets: `set-XX/` folders with 4 views
  - Image library: `image-library/` folder with individual images
- **Real images**: a pack outside the app, served by the `/real-images/` route, image reading only. See [mammogram-images.md](mammogram-images.md#showing-a-pack-in-the-prototype)

Each complete set contains four views: `rcc.png`, `lcc.png`, `rmlo.png`, `lmlo.png`. Sets with implants can also have implant displaced views, `rccid.png` and `lccid.png`, which are only used when present. Composite sets can define `rccid` and `lccid` in `views` the same way. Implant displaced views aren't annotated.

### Manifest

`manifest.json` in each source folder defines both the image library and available sets:

```json
{
  "imageLibrary": [
    {
      "id": "blur-2-rmlo",
      "path": "image-library/blur-2-rmlo.png",
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

Image sets are selected based on participant/appointment context:

| Context Flag  | Behaviour                                                                   |
| ------------- | --------------------------------------------------------------------------- |
| `hasSymptoms` | Increases probability of abnormal sets; prefers abnormality on symptom side |
| `hasImplants` | Only selects sets with `hasImplants: true` flag                             |
| `isImperfect` | Increases probability of technical sets                                     |
| `hasRepeat`   | Only selects sets with `hasRepeat: true` flag                               |

Context is extracted from appointment data by `extractAppointmentContext()` in `mammogram-images.js`.

### Weighted Selection

When no context requires hard filtering, sets are selected using weighted random based on tag:

- Default (from `app/config.js`): 70% normal, 15% abnormal, 10% indeterminate, 5% technical
- With symptoms: 30% normal, 50% abnormal, 10% indeterminate, 10% technical
- With imperfect images: 10% normal, 10% abnormal, 0% indeterminate, 80% technical
- Configured in `config.reading.mammogramTagWeights`
- Selection is deterministic per appointment ID (seeded random)

### Missing Views

If a mammogram view is missing from `appointment.mammogramData.views`, the viewer shows a no-entry symbol in that panel, labelled “No image” for screen readers. The image selection system filters paths to only include views present in the appointment's mammogram data.

A view that wasn't expected (for example after a mastectomy, see `getExpectedViews` in [data-conventions.md](data-conventions.md#expected-views)) looks the same: a real PACS knows nothing of medical history, so it wouldn't explain why. Set selection also avoids sets with an abnormal or technical finding on a breast with no images (`notImagedSides` in the context).

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

1. Shows the latest (last) image in the panel
2. Adds numbered buttons to the panel, one per image, to show an earlier one in its place
3. Adds “(1 of 2)” after the view in the panel and fullscreen labels

---

## Configuration

### User Settings (`data.settings`)

| Setting              | Default      | Description                                                                                                                                       |
| -------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `debugMode`          | `'false'`    | Show debug info (tags like Has repeat, Imperfect, etc.)                                                                                           |
| `mammogramViewOrder` | `'cc-first'` | View order on reading pages: `'cc-first'` (CC on top) or `'mlo-first'` (MLO on top). In the viewer, sets the order of views in Priors and Current |

### User Settings (`data.settings.reading`)

| Setting              | Default       | Description                                                                                               |
| -------------------- | ------------- | --------------------------------------------------------------------------------------------------------- |
| `autoOpenPacsViewer` | `'false'`     | Auto-open viewer when entering reading workflow                                                           |
| `pacsScreens`        | `'two'`       | `'two'` windows, one per monitor, or `'one'` landscape window                                             |
| `pacsPriorsLayout`   | `'side'`      | Priors layout: `'side'` (current on screen 1, prior on screen 2) or `'top'` (prior above current)         |
| `pacsCurrentLayout`  | `'by-breast'` | Current layout: `'by-breast'` (a breast per screen) or `'by-view'` (CCs on one screen, MLOs on the other) |

### Hard Config (`config.reading`)

| Setting                   | Default                                                                | Description                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mammogramImageSource`    | `'diagrams'`                                                           | Default image source: `'diagrams'` or `'real'` (`MAMMOGRAM_IMAGE_SOURCE`). The "Mammogram images" setting overrides it per session. Use `getMammogramImageSource()` rather than reading it |
| `mammogramTagWeights`     | `{ normal: 0.7, abnormal: 0.15, indeterminate: 0.1, technical: 0.05 }` | Distribution weights for image set tags                                                                                                                                                    |
| `maxPriorStudiesInViewer` | `3`                                                                    | How many priors the viewer offers, the most recent                                                                                                                                         |

---

## Files

### Core Files

| File                                         | Purpose                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `app/lib/utils/mammogram-images.js`          | Image selection utility (weighted seeded random, path generation)        |
| `app/lib/real-images.js`                     | Reads a real image pack and finds its image files for `/real-images/`    |
| `app/assets/javascript/mammogram-channel.js` | BroadcastChannel communication (broadcast, listen, ping/pong, auto-open) |
| `app/views/reading/mammogram-viewer.html`    | Viewer page (dark theme, layouts, screens, zoom, placeholder states)     |

### Integration Points

| File                                       | Purpose                                           |
| ------------------------------------------ | ------------------------------------------------- |
| `app/views/_templates/layout-reading.html` | Meta tags for viewer data, missing view detection |
| `app/views/_templates/layout-base.html`    | "Open PACS viewer" link in header nav             |
| `app/views/_includes/scripts.html`         | mammogram-channel.js include                      |

### Data Files

| File                                                 | Purpose                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| `app/assets/images/mammogram-diagrams/manifest.json` | Image set metadata (90 sets)                                                |
| `app/data/session-data-defaults.js`                  | PACS viewer setting defaults                                                |
| `app/config.js`                                      | `mammogramImageSource`, `mammogramTagWeights` and `maxPriorStudiesInViewer` |

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

- [ ] Test/verify probability distribution (debug route to sample many appointments)
- [ ] Hiding priors while a case is waiting for them
- [ ] Layouts for more than one prior
- [ ] Settings for screen order
- [ ] Annotation inheritance for composite sets (abnormality markers)
- [ ] Breast features alignment (moles, scars visible in mammograms)

---

## Planning

### Completed Features

The following planned features have been implemented:

- [x] **Image library**: Individual images stored in `image-library/` folder with metadata
- [x] **Composite sets**: Sets can reference other sets (`from`) or image library (`image`)
- [x] **Per-breast metadata**: `left` and `right` status on sets
- [x] **Context-aware selection**: Symptoms, implants, imperfect images, repeats
- [x] **Side preference**: Abnormalities matched to symptom side (70% probability)
- [x] **View filtering**: Only show views present in mammogram data
- [x] **Additional images**: Support for repeat/retake scenarios, chosen per panel
- [x] **Debug display**: Press 'i' in viewer to see set info and context flags
- [x] **Repeat sets**: 7 composite sets with `hasRepeat: true` flag

### Real Mammogram Images

The viewer shows a real image pack in image reading when one is configured, loading full-resolution images when zoomed in, with each case's earlier studies as priors. See [mammogram-images.md](mammogram-images.md#showing-a-pack-in-the-prototype). Packs can't go in `app/assets`, which is served without the password check.

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
- Appointment has repeat images → select repeat sets

### Composite Sets Architecture

The manifest supports composing sets from other sets and the image library:

1. **Image library**: Individual images stored with metadata in `image-library/` folder.

   ```json
   {
     "imageLibrary": [
       {
         "id": "normal-rmlo-01",
         "path": "image-library/normal-rmlo-01.png",
         "view": "rmlo",
         "status": "normal"
       },
       {
         "id": "blurry-lcc-01",
         "path": "image-library/blurry-lcc-01.png",
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
   - `hasRepeat: true` - Set has repeat images, only selected for appointments with repeats
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
