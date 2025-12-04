# Breast diagram export guide

## Overview

The breast diagram SVG contains the breast outlines and invisible region shapes used for location detection. The master artwork is in Adobe Illustrator, and must be processed before use.

**Source file:** `breast-features-diagram-MASTER.ai`

## Quick start

1. Edit the Illustrator file (if needed)
2. Run `prepare-breast-regions.jsx` in Illustrator (stage 1)
3. Expand the Live Paint group: Object > Live Paint > Expand
4. Run the script again (stage 2)
5. Export as SVG (Use Artboards: on)
6. Run `node process-svg.js [exported-file].svg`
7. Copy the processed SVG to your project

---

## Detailed steps

### Editing the artwork

The Illustrator file has these key layers:

| Layer          | Purpose                                                           |
| -------------- | ----------------------------------------------------------------- |
| Breast diagram | Outline artwork for each breast                                   |
| Region labels  | Text labels for each region (lowercase, e.g. "lateral to nipple") |
| Regions        | Live Paint group defining the region boundaries                   |

**Tips:**

- Labels must be fully inside their region and near the centre
- Use horizontal (non-rotated) text labels
- Work on the right breast first, then mirror for left

### Running the Illustrator script

The script runs in two stages:

**Stage 1:** File > Scripts > Other Script > `prepare-breast-regions.jsx`

- Duplicates the Live Paint group to a new layer

**Between stages:** Object > Live Paint > Expand (with the group selected)

**Stage 2:** Run the script again

- Labels paths from the text labels
- Mirrors to create left side
- Adds breast outline

### Exporting the SVG

File > Export > Export As...

| Option        | Value         |
| ------------- | ------------- |
| Format        | SVG           |
| Use Artboards | ✓ (important) |
| Styling       | Inline Style  |
| Object IDs    | Layer Names   |
| Decimals      | 2             |

### Processing the SVG

```bash
cd reference/breast-diagram
node process-svg.js breast-features-diagram-[version].svg
```

Creates a `-processed.svg` file with BEM classes and data attributes.

### Using in the prototype

Copy the processed SVG to `app/views/_includes/breast-diagram.svg`

If regions changed, also update `app/lib/generators/medical-information/breast-features-generator.js`

---

## Reference

### Region count

The diagram should have 19 regions per side (38 total).

### BEM classes added by processing script

| Element           | Class                         |
| ----------------- | ----------------------------- |
| SVG root          | `app-breast-diagram__svg`     |
| Regions container | `app-breast-diagram__regions` |
| Individual region | `app-breast-diagram__region`  |

### Data attributes on regions

| Attribute   | Example                  |
| ----------- | ------------------------ |
| `data-name` | "lateral to nipple"      |
| `data-key`  | "left_lateral_to_nipple" |
| `data-side` | "left" or "right"        |

### Troubleshooting

**Paths named "unlabelled-X"**
A region couldn't be matched to a label. Check labels are inside their regions and near the centre.

**"Could not find Live Paint group"**
The Regions layer needs a Live Paint group. Restore from backup if already expanded.

**Label conflicts warning**
Multiple labels matched one region. Usually caused by rotated text – use horizontal labels.
