#!/bin/bash
# scripts/process-mammogram-images.sh
#
# Processes individual mammogram images (not sets):
# - Converts to grayscale
# - Compresses with pngquant (8 colours)
# - Optionally resizes
# - Preserves original filenames
#
# Usage:
#   ./scripts/process-mammogram-images.sh <input-dir-or-files...> [options]
#
# Options:
#   --output <dir>  Output directory (required when processing individual files)
#   --dry-run       Preview changes without modifying files
#   --resize <px>   Resize to specified width (e.g. --resize 825)
#
# Examples:
#   # Process all PNGs in a folder
#   ./scripts/process-mammogram-images.sh reference/image-library-source --output reference/image-library-full
#
#   # Process specific files
#   ./scripts/process-mammogram-images.sh reference/source/normal-lcc.png reference/source/normal-lmlo.png --output reference/image-library-full
#
#   # With resize
#   ./scripts/process-mammogram-images.sh reference/source/normal-lcc.png --output reference/image-library-half --resize 825
#
# Commands used to process image library (January 2026):
#   Full resolution (58MB → 8.7MB):
#     ./scripts/process-mammogram-images.sh reference/mammogram-diagrams-source/image-library --output reference/image-library-full
#
#   Half resolution (58MB → 2.5MB):
#     ./scripts/process-mammogram-images.sh reference/mammogram-diagrams-source/image-library --output reference/image-library-half --resize 825

set -e

# Defaults
DRY_RUN=false
RESIZE_WIDTH=""
OUTPUT_DIR=""
INPUT_PATHS=()

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
    -*)
      echo "Error: Unknown option '$1'"
      exit 1
      ;;
    *)
      INPUT_PATHS+=("$1")
      shift
      ;;
  esac
done

# Validate we have input
if [[ ${#INPUT_PATHS[@]} -eq 0 ]]; then
  echo "Usage: $0 <input-dir-or-files...> [--output <dir>] [--dry-run] [--resize <width>]"
  exit 1
fi

# Determine input mode: folder or files
FIRST_INPUT="${INPUT_PATHS[0]}"
if [[ -d "$FIRST_INPUT" ]]; then
  INPUT_MODE="folder"
  INPUT_DIR="$FIRST_INPUT"
  if [[ ${#INPUT_PATHS[@]} -gt 1 ]]; then
    echo "Error: When using folder mode, only one folder can be specified"
    exit 1
  fi
elif [[ -f "$FIRST_INPUT" ]]; then
  INPUT_MODE="files"
  # Validate all inputs are files
  for path in "${INPUT_PATHS[@]}"; do
    if [[ ! -f "$path" ]]; then
      echo "Error: '$path' is not a file"
      exit 1
    fi
  done
else
  echo "Error: '$FIRST_INPUT' does not exist"
  exit 1
fi

# Set output directory
if [[ -z "$OUTPUT_DIR" ]]; then
  if [[ "$INPUT_MODE" == "folder" ]]; then
    OUTPUT_DIR="$INPUT_DIR"
    IN_PLACE=true
  else
    echo "Error: --output is required when processing individual files"
    exit 1
  fi
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

# Print header
if [[ "$INPUT_MODE" == "folder" ]]; then
  echo "Processing mammogram images in: $INPUT_DIR"
else
  echo "Processing ${#INPUT_PATHS[@]} file(s)"
fi
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

# Create output directory if needed
if [[ "$DRY_RUN" == false && "$IN_PLACE" == false ]]; then
  mkdir -p "$OUTPUT_DIR"
fi

# Build list of files to process
FILES_TO_PROCESS=()
if [[ "$INPUT_MODE" == "folder" ]]; then
  while IFS= read -r file; do
    [[ -n "$file" ]] && FILES_TO_PROCESS+=("$file")
  done < <(find "$INPUT_DIR" -maxdepth 1 -name "*.png" -type f | sort)
else
  FILES_TO_PROCESS=("${INPUT_PATHS[@]}")
fi

# Count for summary
IMAGES_PROCESSED=0
IMAGES_SKIPPED=0

# Process each file
for SRC in "${FILES_TO_PROCESS[@]}"; do
  FILENAME=$(basename "$SRC")
  DEST="$OUTPUT_DIR/$FILENAME"

  # Skip if output already exists and we're not modifying in place
  if [[ "$IN_PLACE" == false && -f "$DEST" ]]; then
    echo "  Skipping $FILENAME (already exists in output)"
    ((IMAGES_SKIPPED++))
    continue
  fi

  if [[ "$DRY_RUN" == true ]]; then
    echo "  $FILENAME"
    ((IMAGES_PROCESSED++))
  else
    # Create temp file for processing
    TEMP_FILE="/tmp/mammogram-process-$$.png"

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
    rm -f "$TEMP_FILE"

    # Remove original only if modifying in place
    if [[ "$IN_PLACE" == true && "$SRC" != "$DEST" ]]; then
      rm "$SRC"
    fi

    # Show result
    FINAL_SIZE=$(ls -lh "$DEST" | awk '{print $5}')
    echo "  $FILENAME ($FINAL_SIZE)"
    ((IMAGES_PROCESSED++))
  fi
done

echo ""
echo "=== Summary ==="
echo "Images processed: $IMAGES_PROCESSED"
echo "Images skipped: $IMAGES_SKIPPED"

if [[ "$DRY_RUN" == true ]]; then
  echo ""
  echo "This was a dry run. Run without --dry-run to apply changes."
fi
