#!/bin/bash
# scripts/process-mammogram-sets.sh
#
# Processes mammogram screenshot sets:
# - Renames screenshots to view names (rmlo, lmlo, rcc, lcc) based on chronological order
# - Converts to grayscale
# - Compresses with pngquant (8 colours)
# - Optionally resizes
#
# Usage:
#   ./scripts/process-mammogram-sets.sh <input-dir> [options]
#
# Options:
#   --output <dir>  Output directory (default: same as input, modifies in place)
#   --dry-run       Preview changes without modifying files
#   --resize <px>   Resize to specified width (e.g. --resize 825)
#
# Examples:
#   ./scripts/process-mammogram-sets.sh reference/test-sets --dry-run
#   ./scripts/process-mammogram-sets.sh reference/test-sets --output processed-sets
#   ./scripts/process-mammogram-sets.sh reference/test-sets --output processed-sets --resize 825
#
# Commands used to process mammogram sets (January 2026):
#   Full resolution (237MB → 30MB):
#     ./scripts/process-mammogram-sets.sh reference/mammogram-sets --output reference/mammogram-sets-full
#
#   Half resolution (237MB → 9MB):
#     ./scripts/process-mammogram-sets.sh reference/mammogram-sets --output reference/mammogram-sets-half --resize 825

set -e

# View names in chronological screenshot order
VIEW_NAMES=("rmlo" "lmlo" "rcc" "lcc")

# Defaults
DRY_RUN=false
RESIZE_WIDTH=""
INPUT_DIR=""
OUTPUT_DIR=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --resize)
      RESIZE_WIDTH="$2"
      shift 2
      ;;
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    *)
      if [[ -z "$INPUT_DIR" ]]; then
        INPUT_DIR="$1"
      else
        echo "Error: Unknown argument '$1'"
        exit 1
      fi
      shift
      ;;
  esac
done

# Validate input directory
if [[ -z "$INPUT_DIR" ]]; then
  echo "Usage: $0 <input-dir> [--output <dir>] [--dry-run] [--resize <width>]"
  exit 1
fi

if [[ ! -d "$INPUT_DIR" ]]; then
  echo "Error: Directory '$INPUT_DIR' does not exist"
  exit 1
fi

# Set output directory (default to input directory for in-place modification)
if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR="$INPUT_DIR"
  IN_PLACE=true
else
  IN_PLACE=false
fi

# Check dependencies
if ! command -v magick &> /dev/null; then
  echo "Error: ImageMagick (magick) is required but not installed"
  exit 1
fi

if ! command -v pngquant &> /dev/null; then
  echo "Error: pngquant is required but not installed"
  exit 1
fi

echo "Processing mammogram sets in: $INPUT_DIR"
if [[ "$IN_PLACE" == false ]]; then
  echo "Output directory: $OUTPUT_DIR"
fi
if [[ "$DRY_RUN" == true ]]; then
  echo "Mode: DRY RUN (no files will be modified)"
else
  echo "Mode: LIVE (files will be modified)"
fi
if [[ -n "$RESIZE_WIDTH" ]]; then
  echo "Resize: ${RESIZE_WIDTH}px wide"
fi
echo ""

# Count sets for summary
SETS_PROCESSED=0
SETS_SKIPPED=0

# Find all set-* directories
for SET_DIR in "$INPUT_DIR"/set-*; do
  if [[ ! -d "$SET_DIR" ]]; then
    continue
  fi

  SET_NAME=$(basename "$SET_DIR")
  echo "=== $SET_NAME ==="

  # Determine output set directory
  OUTPUT_SET_DIR="$OUTPUT_DIR/$SET_NAME"

  # Find PNG files (screenshots or already processed)
  SCREENSHOTS=()
  while IFS= read -r line; do
    SCREENSHOTS+=("$line")
  done < <(find "$SET_DIR" -maxdepth 1 -name "Screenshot*.png" | sort)

  # Check output directory for already processed files
  EXISTING=()
  if [[ -d "$OUTPUT_SET_DIR" ]]; then
    while IFS= read -r line; do
      [[ -n "$line" ]] && EXISTING+=("$line")
    done < <(find "$OUTPUT_SET_DIR" -maxdepth 1 \( -name "rmlo.png" -o -name "lmlo.png" -o -name "rcc.png" -o -name "lcc.png" \) 2>/dev/null | sort)
  fi

  # Check if already processed
  if [[ ${#EXISTING[@]} -eq 4 ]]; then
    echo "  Already processed (4 view files found in output), skipping"
    ((SETS_SKIPPED++))
    echo ""
    continue
  fi

  # Validate we have exactly 4 screenshots
  if [[ ${#SCREENSHOTS[@]} -ne 4 ]]; then
    echo "  Warning: Expected 4 screenshots, found ${#SCREENSHOTS[@]}, skipping"
    ((SETS_SKIPPED++))
    echo ""
    continue
  fi

  # Process each screenshot
  for i in "${!SCREENSHOTS[@]}"; do
    SRC="${SCREENSHOTS[$i]}"
    VIEW="${VIEW_NAMES[$i]}"
    DEST="$OUTPUT_SET_DIR/${VIEW}.png"
    SRC_NAME=$(basename "$SRC")

    if [[ "$DRY_RUN" == true ]]; then
      echo "  $SRC_NAME → $SET_NAME/${VIEW}.png"
    else
      # Create output set directory if needed
      mkdir -p "$OUTPUT_SET_DIR"

      # Create temp file for processing
      TEMP_FILE=$(mktemp /tmp/mammogram-XXXXXX.png)

      # Build magick command
      MAGICK_ARGS=("$SRC" "-colorspace" "Gray")
      if [[ -n "$RESIZE_WIDTH" ]]; then
        MAGICK_ARGS+=("-resize" "${RESIZE_WIDTH}x")
      fi
      MAGICK_ARGS+=("$TEMP_FILE")

      # Convert to grayscale (and optionally resize)
      magick "${MAGICK_ARGS[@]}"

      # Compress with pngquant
      pngquant 8 --speed 1 --force --output "$DEST" "$TEMP_FILE"

      # Clean up temp file
      rm "$TEMP_FILE"

      # Remove original screenshot only if modifying in place
      if [[ "$IN_PLACE" == true ]]; then
        rm "$SRC"
      fi

      # Show result
      FINAL_SIZE=$(ls -lh "$DEST" | awk '{print $5}')
      echo "  $SRC_NAME → ${VIEW}.png ($FINAL_SIZE)"
    fi
  done

  ((SETS_PROCESSED++))
  echo ""
done

echo "=== Summary ==="
echo "Sets processed: $SETS_PROCESSED"
echo "Sets skipped: $SETS_SKIPPED"

if [[ "$DRY_RUN" == true ]]; then
  echo ""
  echo "This was a dry run. Run without --dry-run to apply changes."
fi
