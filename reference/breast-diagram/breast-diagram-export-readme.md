# Breast diagram export guide

## Overview

The breast diagram SVG contains breast outlines and invisible region shapes used for location detection. The master artwork is in Adobe Illustrator and must be processed before use.

**Source file:** `breast-features-diagram-MASTER.ai`

## Quick start

1. Edit the Illustrator file (if needed)
2. Run `illustrator-processing-script.jsx` in Illustrator
3. Export as SVG (Use Artboards: on, Styling: Presentation Attributes)
4. Run `node process-exported-svg.js [exported-file].svg`
5. Copy the processed SVG to `app/views/_includes/breast-diagram.svg`

---

## Detailed steps

### Editing the artwork

The Illustrator file has these key layers:

| Layer                    | Purpose                                                           |
| ------------------------ | ----------------------------------------------------------------- |
| Breast diagram           | Outline artwork for each breast                                   |
| Region labels            | Text labels for each region (lowercase, e.g. "lateral to nipple") |
| Regions                  | Live Paint group defining the region boundaries                   |
| Breast diagram to export | Output layer created by the script                                |

**Tips:**

- Labels must be fully inside their region and near the centre
- Use horizontal (non-rotated) text labels
- Only work on the right breast – the left breast is mirrored by the script

### Running the Illustrator script

File > Scripts > Other Script > `illustrator-processing-script.jsx`

The script:

1. Duplicates the Live Paint group to the output layer
2. Auto-expands the Live Paint group (via Object > Live Paint > Expand)
3. Labels each path using the text labels
4. Mirrors the right side to create the left side
5. Adds breast and nipple outlines

If the auto-expand fails, follow the on-screen instructions to expand manually and run again.

### Exporting the SVG

File > Export > Export As...

| Option        | Value                   |
| ------------- | ----------------------- |
| Format        | SVG                     |
| Use Artboards | ✓ (important)           |
| Styling       | Presentation Attributes |
| Object IDs    | Layer Names             |
| Decimals      | 2                       |

### Processing the SVG

```bash
cd reference/breast-diagram
node process-exported-svg.js breast-features-diagram-[version].svg
```

Creates a `-processed.svg` file with:

- BEM classes for styling
- Data attributes for JavaScript interaction
- Accessibility attributes (aria-labels)
- Non-scaling strokes on outlines
- Flattened diagram structure
- Cleaned XML (no declaration, no xmlns)

The script validates the output and will error if expected elements are missing.

### Using in the prototype

Copy the processed SVG to `app/views/_includes/breast-diagram.svg`

If regions changed, also update `app/lib/generators/medical-information/breast-features-generator.js`

---

## Reference

### Region count

The diagram should have 19 regions per side (38 total).

### IDs added by processing script

| Element            | ID                                  |
| ------------------ | ----------------------------------- |
| SVG root           | `app-breast-diagram__svg`           |
| Regions container  | `app-breast-diagram__regions`       |
| Left region group  | `app-breast-diagram__regions-left`  |
| Right region group | `app-breast-diagram__regions-right` |
| Diagram group      | `app-breast-diagram__diagram`       |

The SVG root also has a matching class for CSS targeting. Child elements (region paths, outline paths/circles) don't have classes – target them via their parent group.

### Attributes on regions

| Attribute    | Example                  | Notes                            |
| ------------ | ------------------------ | -------------------------------- |
| `id`         | "left_lateral_to_nipple" | Unique identifier for the region |
| `aria-label` | "left lateral to nipple" | Human-readable label             |

The side can be derived from the parent group (`#app-breast-diagram__regions-left` or `#app-breast-diagram__regions-right`).

### Attributes on outlines

| Attribute    | Example               | Notes                      |
| ------------ | --------------------- | -------------------------- |
| `data-side`  | "left" or "right"     | Which breast               |
| `aria-label` | "left breast outline" | Human-readable label       |

Target breast outlines with `.app-breast-diagram__diagram path` and nipple outlines with `.app-breast-diagram__diagram circle`.

### Accessibility attributes

All regions and outline elements have `aria-label` attributes for screen readers.

### SVG attributes

Outline paths and circles include `vector-effect="non-scaling-stroke"` so stroke width remains constant when the diagram is scaled.

### Troubleshooting

**Paths named "unlabelled-X"**
A region couldn't be matched to a label. Check labels are inside their regions and near the centre.

**"Could not find Live Paint group"**
The Regions layer needs a Live Paint group. Restore from backup if already expanded.

**Label conflicts warning**
Multiple labels matched one region. Usually caused by rotated text – use horizontal labels.

**Validation errors**
The processing script checks for 38 regions, breast/nipple outlines, and viewBox. Fix the source artwork if validation fails.
