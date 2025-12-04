# Breast diagram export readme

## Background

The breast features component lets users click on a drawing of some breasts to place a marker. They can use this to mark where a feature like a mole or scar is visually on the breast. When a marker is placed, we also derive a named location – such as 'lateral to nipple' – that can be shown in text or in reports.

The component uses a breast features SVG to support two parts of this: drawing the outline of the breasts, and closed shapes representing all the named regions.

It's important that the closed shapes have no gaps and do not overlap – so that for any position on the diagram there is exactly one label. For this reason, the SVG should not be manually edited. The original Adobe Illustrator working document should be edited, then a new SVG exported from this artwork.

The Illustrator file `breast-features-diagram-MASTER.ai` is located in the same folder as this readme.

This file contains several layers – the key ones are:

### Breast diagram

Contains the artwork for the outlines of each breast. If making a change, delete the left breast, then make a change to the right breast and reflect/mirror that work for the left side. Make sure the resulting artwork contains groups for `right` and `left`.

Note the paths for the breast outlines are also used by the regions. If making a change to the breast diagram itself, these changes will need to be copied to the `Regions` layer too.

### Region labels

This contains text labels for each region. The format should be lowercase, human readable (e.g. "lateral to nipple"). At export these are used to automatically label the paths. The text labels need to be wholly contained within a region. Matching label to region is a bit tricky - ideally make them small and near the centre of the region.

### Regions

This contains a Live Paint group defining the regions. Live Paint is used because it lets us draw lines for the dividers – these are easier to work with than separate closed paths where each change would mean editing multiple shapes. To change the regions, use the Direct Selection tool to move dividing lines. If subdividing further you may need to use the Live Paint Bucket to colour new areas.

Overlapping lines don't matter as only 'enclosed' shapes will end up generating closed paths.

### Other layers

Other layers exist mostly as backups and should not need to be edited.

## What the Illustrator script does

The script `prepare-breast-regions.jsx` automates repetitive export work. It runs in two stages:

**Stage 1:**

- Unlocks source layers if needed
- Creates a new layer called "Breast diagram to export"
- Duplicates the Live Paint group to this new layer
- Selects the duplicated group and waits for you to expand it
- Re-locks source layers

**Stage 2 (after you've expanded the Live Paint group):**

- Labels each region path based on overlapping text from the `Region labels` layer
- Removes fill and stroke from region paths (making them invisible in normal view)
- Renames the regions group to `right`
- Mirrors the regions to create a `left` group
- Copies the breast outline artwork into an `outline` group
- Hides and locks source layers

**The export layer will contain three groups:**

- `outline` – the breast diagram artwork (at front)
- `right` – labelled region paths for the right breast
- `left` – mirrored region paths for the left breast

## Preparing artwork

### 1. Make changes

Make changes to the `Regions` layer as necessary. The pie segments around the breast will be trickier to adjust, as these should be symmetrical. If needing to change the angle, it's likely best to delete all the dividing lines and draw from scratch – start by drawing a single line at the correct position, then mirror this, then copy and rotate 90º ×4 times. If you make the `Guides` layer visible it has guides for nipple 90º and 45º.

Make sure there is a text label above each coloured region and it is fully enclosed by the shape.

**Important:** Use horizontal (non-rotated) text labels. Rotated text has a larger bounding box that can overlap adjacent regions, causing mislabelling.

### 2. Save and lock artwork

Lock the `Regions` layer, then save changes.

### 3. Run the script (stage 1)

Choose menu: File > Scripts > Other Script...

Use the file browser to navigate to `prepare-breast-regions.jsx` (in the same folder as this readme).

The script will duplicate the Live Paint group to a new layer and select it.

### 4. Expand the Live Paint group

With the group selected, choose menu: Object > Live Paint > Expand

This converts the Live Paint group into regular closed paths.

### 5. Run script again (stage 2)

Run the script again from File > Scripts > Other Script...

The script will now label the paths, mirror them, and add the breast outline.

### 6. Check output

The script generates a layer called "Breast diagram to export" with the complete artwork. It hides the working layers.

Press Cmd+Y to toggle Outline mode – this lets you see the invisible region paths.

Check for any paths named `unlabelled-X` – these indicate regions that couldn't be matched to a text label. You may need to adjust the label positions and run the script again.

If the script warns about "label conflicts", this means multiple labels appear to match the same region – usually caused by rotated text. Fix by using horizontal labels.

### 7. Export SVG

Choose File > Export > Export As...

Options:

- Name the file `breast-features-diagram-[version number].svg`
- Format: SVG
- **Use Artboards: tick this** (important – ensures correct viewBox dimensions)
- Styling: Inline Style
- Object IDs: Layer Names
- Decimals: 2

## Processing the SVG

The exported SVG needs post-processing to add data attributes used by JavaScript components.

### 1. Run the processing script

In terminal, navigate to the `reference/breast-diagram` folder and run:

```bash
node process-svg.js breast-features-diagram-[version].svg
```

This creates a new file with `-processed` suffix (e.g. `breast-features-diagram-0.1-processed.svg`).

The script adds the following to the SVG:

**On the root `<svg>` element:**

- `class="app-breast-diagram__svg"` – BEM element class for styling
- Removes fixed `width` and `height` attributes (viewBox handles aspect ratio)

**On each region path:**

- `class="app-breast-diagram__region"` – BEM element class for styling
- `data-name` – the region name (e.g. "lateral to nipple")
- `data-key` – a unique key combining side and name (e.g. "left_lateral_to_nipple")
- `data-side` – which breast ("left" or "right")

**Container group:**

- Wraps the region groups in `<g class="app-breast-diagram__regions">`

### 2. Check the output

The script reports how many regions were processed. There should be 19 regions per side (38 total).

If the count is wrong, check the Illustrator file for missing or duplicate labels.

The processed SVG is a production-ready asset that can be used by any application needing the breast diagram.

## Using in the prototype

To use the processed SVG in this prototype, copy it to `app/views/_includes/breast-diagram.svg`. The wrapper template at `app/views/_includes/breast-diagram-wrapper.njk` includes this file and adds the container markup.

If you've added, removed, or renamed regions, also update `app/lib/generators/medical-information/breast-features-generator.js` with the new region names and approximate centre coordinates.

## Troubleshooting

### Paths named "unlabelled-X"

This means a region path couldn't be matched to a text label. Check that:

- Every region has a text label
- Each text label is fully inside its region boundary
- Text labels don't overlap region boundaries

Fix the labels, delete the "Breast diagram to export" layer, and run the script again.

### Script shows "Could not find Live Paint group"

Make sure the `Regions` layer contains a Live Paint group. If you've already expanded it, you'll need to restore from the backup layer or undo.
