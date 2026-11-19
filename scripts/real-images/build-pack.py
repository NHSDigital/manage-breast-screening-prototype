#!/usr/bin/env python3
"""
Build a real image pack for the prototype from real mammogram participant folders.

Reads each participant's IMAGEDB_*.json, NBSS_*.json and DICOM files, and writes
a pack: manifest.json, id-map.json and JPEGs (format: docs/mammogram-images.md
and the pack format notes). Never changes the source data. Leaves
annotations.json and curation.json in the pack alone, but applies curation.json
exclusions when choosing cases.

Setup (Python 3.8 or later; survey.py must sit next to this script):
    python3 -m venv pack-env
    pack-env/bin/pip install -r requirements.txt     (Windows: pack-env\\Scripts\\pip)

Run:
    pack-env/bin/python build-pack.py /path/to/participant-folders --out /path/to/pack
    --display-only    only the ~1600 px display JPEGs (a quick, small pack)
    --skip-existing   don't re-render JPEGs that are already there (for re-runs)
    --limit 20        only the first N participants (a trial run)
    --check           only validate an existing pack's manifest.json

Output, in the --out folder:
    manifest.json     participants, studies, images and cases (aliased IDs, no dates)
    id-map.json       our aliases → original IDs. Private: never share or commit.
    images/           <participant>/<study>/<image>-display.jpg and -full.jpg
    build.log         anything skipped, flagged or unreadable

Everything in the pack is derived from real images. Keep it out of git and
anywhere public; share it only through approved storage.
"""
import argparse
import collections
import datetime
import glob
import hashlib
import json
import os
import re
import sys
import time

import survey  # read_participant, classify_study, recalled, cancer_found

try:
    import numpy as np
    import pydicom
    from PIL import Image
    try:
        from pydicom.pixels import apply_modality_lut, apply_voi_lut
    except ImportError:  # pydicom 2.x, the newest available on Python 3.8 and 3.9
        from pydicom.pixel_data_handlers.util import apply_modality_lut, apply_voi_lut
except ImportError:
    sys.exit("Missing dependencies. Run: pip install -r requirements.txt")

SCREENING_KINDS = ("screening", "screening-plus")
SAME_DAY_MERGE_KINDS = ("screening", "screening-plus", "screening-one-side")
KINDS = ("screening", "screening-plus", "screening-one-side", "assessment-or-other", "tomosynthesis", "synthetic-2d-only")
RESULTS = ("normal", "recalled-not-cancer", "cancer", "technical-repeat-requested")
TAGS = ("normal", "abnormal", "technical", "unknown")
DISPLAY_HEIGHT = 1600
MIN_IMAGE_SIDE = 1000  # smaller than this is a specimen or partial view, not a full view
SIDE_OPINION = {"RN": "normal", "RU": "abnormal", "BA": "clinical", "RO": "unreported", "RB": "benign"}
RECALL_ACTIONS = ("RC", "FV", "EC")


def alias(prefix, original):
    return prefix + hashlib.sha1(original.encode()).hexdigest()[:8]


def image_key(image):
    """The file name without .dcm: the image's ID in IMAGEDB."""
    return os.path.splitext(image["file"])[0]


def read_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path) as f:
        return json.load(f)


def write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=1)
    os.replace(tmp, path)


def age_years(text):
    match = re.match(r"(\d+)", text or "")
    return int(match.group(1)) if match else None


def to_int(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


# ---- NBSS ----------------------------------------------------------------


def nbss_side(screening, side):
    s = screening.get(side) or {}
    if not s:
        return None
    readers = [
        {"opinion": s.get(f"FilmReader{n}Opinion"), "action": s.get(f"FilmReader{n}RecAction")}
        for n in range(1, 6)
        if s.get(f"FilmReader{n}Opinion") or s.get(f"FilmReader{n}RecAction")
    ]
    opinion = s.get("Opinion")
    return {
        "opinion": SIDE_OPINION.get(opinion, opinion),
        "finalAction": s.get("FinalAction"),
        "readers": readers,
    }


def nbss_lesions(episode):
    assessment = episode.get("ASSESSMENT") or {}
    lesions = []
    for side_code, items in (episode.get("LESION") or {}).items():
        for number, item in sorted(items.items()):
            # Assessment findings are numbered like the lesions they describe
            found = (assessment.get(side_code) or {}).get(number) or {}
            lesions.append({
                "side": {"R": "right", "L": "left"}.get(side_code, side_code),
                "description": item.get("LesionDescription"),
                "position": item.get("LesionPosition"),
                "sizeMm": to_int(found.get("MammoSizeMm") or found.get("UssSizeMm")),
            })
    return lesions


def nbss_summary(episode):
    if not episode:
        return None
    screening = episode.get("SCREENING") or {}
    sides = [screening.get(s) or {} for s in ("R", "L")]
    is_recalled = survey.recalled(episode)
    is_cancer = survey.cancer_found(episode)
    technical = survey.any_reader_technical_recall(episode)
    if is_cancer:
        result = "cancer"
    elif is_recalled:
        result = "recalled-not-cancer"
    elif technical:
        result = "technical-repeat-requested"
    else:
        result = "normal"
    sources = {s.get("FinalActionSource") for s in sides} - {None}
    assessment = None
    if any(episode.get(name) for name in ("ASSESSMENT", "CLINICAL", "BIOPSYWIDE", "BIOPSYFINE")):
        biopsy = episode.get("BIOPSYWIDE") or episode.get("BIOPSYFINE") or {}
        assessment = {
            "outcome": (episode.get("ASSESSMENT") or {}).get("diagnosticsetoutcome"),
            "opinion": (episode.get("ASSESSMENT") or {}).get("Opinion"),
            "biopsyOpinion": biopsy.get("Opinion"),
        }
    return {
        "episodeCharacter": episode.get("EpisodeType"),
        "recalled": is_recalled,
        "cancerFound": is_cancer,
        "result": result,
        "technicalRepeatRequested": technical,
        "finalActionSource": "D" if "D" in sources else (sorted(sources)[0] if sources else None),
        "right": nbss_side(screening, "R"),
        "left": nbss_side(screening, "L"),
        "lesions": nbss_lesions(episode),
        "assessment": assessment,
    }


def side_status(nbss, side):
    s = (nbss or {}).get(side)
    if not s:
        return None
    # The opinion is per breast; a recall's final action is often set on both sides
    if s["opinion"] in ("abnormal", "clinical"):
        return "abnormal"
    if s["opinion"] in ("normal", "benign"):
        return "normal"
    if s["finalAction"] in RECALL_ACTIONS:
        return "abnormal"
    if s["finalAction"] == "RR":
        return "normal"
    return None


# ---- Studies and images ---------------------------------------------------


def merge_same_day(studies, client, log):
    """Two screening studies on one day are one visit: fold the later-listed ones into the first."""
    by_day = collections.defaultdict(list)
    for s in studies:
        if s["kind"] in SAME_DAY_MERGE_KINDS:
            by_day[s["studyDate"]].append(s)
    merged_away = set()
    for day_studies in by_day.values():
        if len(day_studies) < 2:
            continue
        # Keep the one linked to an NBSS episode, then the one with most images
        day_studies.sort(key=lambda s: (not s["episodeId"], -len(s["images"]), s["studyUid"]))
        keep = day_studies[0]
        for other in day_studies[1:]:
            keep["images"] += other["images"]
            keep["mergedUids"] = keep.get("mergedUids", [keep["studyUid"]]) + [other["studyUid"]]
            keep["episodeId"] = keep["episodeId"] or other["episodeId"]
            merged_away.add(other["studyUid"])
        keep["kind"] = survey.classify_study(keep["images"])
        log(f"{client}: merged {len(day_studies)} same-day studies into {keep['studyUid']}")
    return [s for s in studies if s["studyUid"] not in merged_away]


def orientation_flip(image):
    """Whether to mirror the image so a right breast's chest wall is on the right, a left's on the left.

    PatientOrientation's first value is the patient direction along each row (left to right):
    P means the chest wall is on the right of the image, A on the left. None if it can't tell.
    """
    first = (image["orientation"] or [""])[0][:1]
    if first not in ("A", "P") or image["laterality"] not in ("R", "L"):
        return None
    return (image["laterality"] == "R") != (first == "P")


def usable_images(study, client, log):
    usable = []
    for image in study["images"]:
        if image["modality"] != "MG" or image["forProcessing"] or image["tomo"]:
            continue
        if min(image["rows"], image["columns"]) < MIN_IMAGE_SIDE:
            log(f"{client}/{image['studyUid']}/{image['file']}: skipped, too small "
                f"({image['columns']}x{image['rows']})")
            continue
        usable.append(image)
    return usable


def render(dicom_path, flip, targets, display_height):
    """Decode, window, normalise orientation and write JPEGs. targets: {"display": path, "full": path}."""
    ds = pydicom.dcmread(dicom_path)
    arr = apply_modality_lut(ds.pixel_array, ds)
    # A VOI LUT table needs whole numbers; the modality LUT returns floats even when it doesn't change anything
    if arr.dtype.kind == "f" and np.array_equal(arr, np.round(arr)):
        arr = arr.astype(np.int32)
    arr = apply_voi_lut(arr, ds, index=0).astype("float32")
    low, high = float(arr.min()), float(arr.max())
    arr = (arr - low) / max(high - low, 1)
    if ds.PhotometricInterpretation == "MONOCHROME1":
        arr = 1 - arr
    im = Image.fromarray((arr * 255).round().astype(np.uint8))
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    if targets.get("full"):
        save_jpeg(im, targets["full"], quality=90)
    if targets.get("display"):
        if im.height > display_height:
            im = im.resize((round(im.width * display_height / im.height), display_height), Image.LANCZOS)
        save_jpeg(im, targets["display"], quality=85)


def save_jpeg(im, path, quality):
    """Write via a temp file, so an interrupted run never leaves a half-written JPEG for --skip-existing to keep."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    im.save(tmp, format="JPEG", quality=quality)
    os.replace(tmp, path)


def has_repeat(images):
    views = collections.Counter(i["view"] for i in images if not i["modifiers"] and not i["synthetic2D"])
    return any(n > 1 and v[1:] in ("cc", "mlo") for v, n in views.items())


# ---- Building ----------------------------------------------------------------


def build_participant(folder, args, curation, id_map, log):
    client = os.path.basename(folder.rstrip("/\\"))
    errors = []
    read = survey.read_participant(folder, errors)
    for e in errors:
        log(e)
    if not read:
        return None, []
    _, nbss, studies = read
    episodes = {k: v for k, v in nbss.items() if isinstance(v, dict)}

    for s in studies:
        for image in s["images"]:
            image["studyUid"] = s["studyUid"]
    studies = merge_same_day(studies, client, log)

    participant_id = alias("p-", client)
    id_map["participants"][participant_id] = client
    kept = []
    for s in studies:
        if s["kind"].startswith("other-") or s["kind"] == "unusable":
            continue
        images = usable_images(s, client, log)
        kind = survey.classify_study([i for i in s["images"] if i in images or i["tomo"]])
        if not images or kind == "unusable":
            log(f"{client}/{s['studyUid']}: skipped, no usable images")
            continue
        s["kind"], s["usable"] = kind, images
        kept.append(s)
    if not kept:
        log(f"{client}: no usable studies")
        return None, []

    first_date = survey.parse_date(kept[0]["studyDate"])
    higher_risk = any(e.get("EpisodeType") == "H" for e in episodes.values())
    out_studies = []
    for s in kept:
        study_id = alias("s-", s["studyUid"])
        id_map["studies"][study_id] = s.get("mergedUids", s["studyUid"])
        study_curation = (curation.get("studies") or {}).get(study_id) or {}
        image_curation = study_curation.get("images") or {}
        out_images = []
        for image in sorted(s["usable"], key=lambda i: (i["instance"], i["file"])):
            image_id = alias("i-", image["file"])
            if (image_curation.get(image_id) or {}).get("role") == "exclude":
                continue
            id_map["images"][image_id] = f"{image['studyUid']}/{image['file']}"
            out_image = write_image(image, folder, participant_id, study_id, image_id, args, log, client)
            if out_image:
                out_images.append(out_image)
        if not out_images:
            continue
        first = s["usable"][0]
        date = survey.parse_date(s["studyDate"])
        out_studies.append({
            "id": study_id,
            "kind": s["kind"],
            "daysFromFirst": (date - first_date).days if date and first_date else None,
            "ageAtStudy": age_years(first["age"]),
            "manufacturer": first["manufacturer"],
            "model": first["model"],
            "hasImplants": any(i["implant"] for i in s["usable"]),
            "nbss": nbss_summary(episodes.get(s["episodeId"])) if s["episodeId"] else None,
            "images": out_images,
            "_excluded": bool(study_curation.get("exclude")),
        })

    participant = {
        "id": participant_id,
        "classification": nbss.get("Classification") or None,
        "higherRisk": higher_risk,
        "studies": out_studies,
    }
    cases = []
    screening = [s for s in out_studies if s["kind"] in SCREENING_KINDS and not s["_excluded"]]
    for n, s in enumerate(screening):
        nbss_s = s["nbss"]
        if not nbss_s:
            tag = "unknown"
        elif nbss_s["recalled"] or nbss_s["cancerFound"]:
            tag = "abnormal"
        elif nbss_s["technicalRepeatRequested"]:
            tag = "technical"
        else:
            tag = "normal"
        cases.append({
            "id": "c-" + s["id"][2:],
            "participantId": participant_id,
            "currentStudyId": s["id"],
            "priorStudyIds": [p["id"] for p in screening[:n]],
            "tag": tag,
            "result": nbss_s["result"] if nbss_s else None,
            "right": {"status": side_status(nbss_s, "right")},
            "left": {"status": side_status(nbss_s, "left")},
            "hasRepeat": has_repeat(s["images"]),
            "hasImplants": s["hasImplants"],
            "higherRisk": higher_risk,
            "ageAtCurrent": s["ageAtStudy"],
        })
    for s in out_studies:
        del s["_excluded"]
    return participant, cases


def write_image(image, folder, participant_id, study_id, image_id, args, log, client):
    flip = orientation_flip(image)
    rel = f"images/{participant_id}/{study_id}/{image_id}"
    files = {"display": rel + "-display.jpg", "full": rel + "-full.jpg"}
    sizes = ["display"] if args.display_only else ["display", "full"]
    targets = {size: os.path.join(args.out, files[size]) for size in sizes}
    if args.skip_existing:
        targets = {size: path for size, path in targets.items() if not os.path.exists(path)}
    # A display-only build still lists full-size files rendered by an earlier build
    if args.display_only and not os.path.exists(os.path.join(args.out, files["full"])):
        files["full"] = None
    if targets:
        try:
            render(os.path.join(folder, image["studyUid"], image["file"]), bool(flip), targets, args.display_height)
        except Exception as e:  # noqa: BLE001
            log(f"{client}/{image['studyUid']}/{image['file']}: render failed: {type(e).__name__}: {e}")
            return None
    if flip is None:
        log(f"{client}/{image['studyUid']}/{image['file']}: orientation unclear "
            f"({image['laterality']} {'/'.join(image['orientation'])}), left as is and flagged")
    out = {
        "id": image_id,
        "view": (image["laterality"] + image["view"]).lower(),
        "modifiers": image["viewModifiers"],
        "synthetic2D": image["synthetic2D"],
        "instance": image["instance"],
        "width": image["columns"],
        "height": image["rows"],
        "pixelSpacingMm": image["pixelSpacingMm"],
        "flipped": bool(flip),
        "files": files,
    }
    if flip is None:
        out["orientationUnclear"] = True
    return out


# ---- Checking ------------------------------------------------------------------

ID_PATTERNS = {"participant": r"p-[0-9a-f]{8}", "study": r"s-[0-9a-f]{8}", "image": r"i-[0-9a-f]{8}", "case": r"c-[0-9a-f]{8}"}
# Original IDs and dates must never reach the manifest
LEAK_PATTERNS = [r"AA-[0-9A-Z]{6,}", r"2\.25\.\d{6,}", r"(?<![\w-])(19|20)\d\d-?[01]\d-?[0-3]\d\b"]


def check_manifest(manifest, pack_root):
    """Return a list of problems with a manifest against the pack format (empty if it's fine)."""
    problems = []

    def need(condition, message):
        if not condition:
            problems.append(message)

    def id_ok(kind, value):
        need(isinstance(value, str) and re.fullmatch(ID_PATTERNS[kind], value), f"bad {kind} ID: {value!r}")

    need(manifest.get("version") == 1, "version must be 1")
    need(isinstance(manifest.get("generatedAt"), str), "generatedAt missing")
    text = json.dumps({k: v for k, v in manifest.items() if k != "generatedAt"})
    for pattern in LEAK_PATTERNS:
        for match in sorted(set(m.group(0) for m in re.finditer(pattern, text)))[:3]:
            problems.append(f"looks like an original ID or date: {match}")

    studies, image_ids = {}, set()
    for p in manifest.get("participants", []):
        id_ok("participant", p.get("id"))
        need(isinstance(p.get("higherRisk"), bool), f"{p.get('id')}: higherRisk not a boolean")
        last_day = -1
        for s in p.get("studies", []):
            id_ok("study", s.get("id"))
            need(s.get("id") not in studies, f"duplicate study {s.get('id')}")
            studies[s.get("id")] = (p.get("id"), s)
            need(s.get("kind") in KINDS, f"{s.get('id')}: bad kind {s.get('kind')!r}")
            day = s.get("daysFromFirst")
            need(isinstance(day, int) and day >= last_day, f"{s.get('id')}: studies not oldest first")
            last_day = day if isinstance(day, int) else last_day
            nbss = s.get("nbss")
            if nbss is not None:
                need(nbss.get("result") in RESULTS, f"{s.get('id')}: bad nbss.result {nbss.get('result')!r}")
                for key in ("recalled", "cancerFound", "technicalRepeatRequested"):
                    need(isinstance(nbss.get(key), bool), f"{s.get('id')}: nbss.{key} not a boolean")
            need(s.get("images"), f"{s.get('id')}: no images")
            for i in s.get("images", []):
                id_ok("image", i.get("id"))
                need(i.get("id") not in image_ids, f"duplicate image {i.get('id')}")
                image_ids.add(i.get("id"))
                need(re.fullmatch(r"[rl][a-z]+", i.get("view") or ""), f"{i.get('id')}: bad view {i.get('view')!r}")
                need(i.get("width", 0) > 0 and i.get("height", 0) > 0, f"{i.get('id')}: no size")
                files = i.get("files") or {}
                need(files.get("display"), f"{i.get('id')}: no display file")
                for path in files.values():
                    if path:
                        need(path.startswith(f"images/{p.get('id')}/{s.get('id')}/{i.get('id')}-"),
                             f"{i.get('id')}: unexpected path {path}")
                        if pack_root:
                            need(os.path.exists(os.path.join(pack_root, path)), f"missing file {path}")

    case_ids = set()
    for c in manifest.get("cases", []):
        id_ok("case", c.get("id"))
        need(c.get("id") not in case_ids, f"duplicate case {c.get('id')}")
        case_ids.add(c.get("id"))
        current = studies.get(c.get("currentStudyId"))
        need(current and current[0] == c.get("participantId"), f"{c.get('id')}: current study not this participant's")
        need(c.get("id", "")[2:] == (c.get("currentStudyId") or "")[2:], f"{c.get('id')}: ID doesn't match its study")
        need(c.get("tag") in TAGS, f"{c.get('id')}: bad tag {c.get('tag')!r}")
        need(c.get("result") in RESULTS + (None,), f"{c.get('id')}: bad result {c.get('result')!r}")
        need((c.get("tag") == "unknown") == (c.get("result") is None), f"{c.get('id')}: tag and result disagree")
        for side in ("right", "left"):
            need((c.get(side) or {}).get("status", "x") in ("normal", "abnormal", None), f"{c.get('id')}: bad {side}")
        if not current:
            continue
        need(current[1]["kind"] in SCREENING_KINDS, f"{c.get('id')}: current study isn't screening")
        last_day = -1
        for prior_id in c.get("priorStudyIds", []):
            prior = studies.get(prior_id)
            need(prior and prior[0] == c.get("participantId"), f"{c.get('id')}: prior {prior_id} not this participant's")
            if prior:
                need(prior[1]["kind"] in SCREENING_KINDS, f"{c.get('id')}: prior {prior_id} isn't screening")
                need(last_day <= prior[1]["daysFromFirst"] <= current[1]["daysFromFirst"],
                     f"{c.get('id')}: priors not oldest first and before the current study")
                last_day = prior[1]["daysFromFirst"]
    return problems


# ---- Main ------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", nargs="?", help="folder containing one folder per participant")
    parser.add_argument("--out", required=True, help="pack folder to write (created if needed)")
    parser.add_argument("--limit", type=int, help="only the first N participants")
    parser.add_argument("--display-only", action="store_true", help="only render display-size JPEGs")
    parser.add_argument("--skip-existing", action="store_true", help="don't re-render JPEGs already in the pack")
    parser.add_argument("--display-height", type=int, default=DISPLAY_HEIGHT, help="display JPEG height (default 1600)")
    parser.add_argument("--check", action="store_true", help="only validate the pack's existing manifest.json")
    args = parser.parse_args()

    manifest_path = os.path.join(args.out, "manifest.json")
    if args.check:
        problems = check_manifest(read_json(manifest_path, {}), args.out)
        print("\n".join(problems) or "manifest.json is valid")
        sys.exit(1 if problems else 0)
    if not args.source:
        parser.error("source is required unless --check")

    folders = sorted(p for p in glob.glob(os.path.join(args.source, "*"))
                     if os.path.isdir(p) and glob.glob(os.path.join(p, "IMAGEDB_*.json")))
    if args.limit:
        folders = folders[: args.limit]
    if not folders:
        sys.exit(f"No participant folders (with an IMAGEDB_*.json) found in {args.source}")
    os.makedirs(args.out, exist_ok=True)

    log_lines = []

    def log(message):
        log_lines.append(message)
        print("  " + message, flush=True)

    curation = read_json(os.path.join(args.out, "curation.json"), {})
    id_map = {"participants": {}, "studies": {}, "images": {}}
    participants, cases = [], []
    started = time.time()
    for n, folder in enumerate(folders, 1):
        try:
            participant, participant_cases = build_participant(folder, args, curation, id_map, log)
            if participant:
                participants.append(participant)
                cases += participant_cases
        except Exception as e:  # noqa: BLE001
            log(f"{os.path.basename(folder)}: failed: {type(e).__name__}: {e}")
        print(f"{n}/{len(folders)} participants, {len(cases)} cases, {time.time() - started:.0f}s", flush=True)

    manifest = {
        "version": 1,
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "participants": participants,
        "cases": cases,
    }
    write_json(manifest_path, manifest)
    write_json(os.path.join(args.out, "id-map.json"), id_map)
    with open(os.path.join(args.out, "build.log"), "w") as f:
        f.write("\n".join(log_lines) + ("\n" if log_lines else ""))

    problems = check_manifest(manifest, args.out)
    results = collections.Counter(c["result"] or "unknown" for c in cases)
    print(f"Done: {len(participants)} participants, {len(cases)} cases "
          f"({', '.join(f'{k} {v}' for k, v in results.most_common())}), "
          f"{sum(len(s['images']) for p in participants for s in p['studies'])} images, "
          f"{len(log_lines)} log lines. Pack in {args.out}/")
    if problems:
        print(f"Manifest check found {len(problems)} problems:\n  " + "\n  ".join(problems[:50]))
        sys.exit(1)
    print("Manifest check passed")


if __name__ == "__main__":
    main()
