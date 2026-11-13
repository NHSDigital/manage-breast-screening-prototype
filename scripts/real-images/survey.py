#!/usr/bin/env python3
"""
Survey a set of real mammogram images before we decide how to use it in the prototype.

Reads each participant's IMAGEDB_*.json and NBSS_*.json, and the DICOM headers
only (never the pixel data), so it's quick even on ~100 GB. Writes nothing
outside the output folder and never changes the source data.

Setup (Python 3.8 or later):
    python3 -m venv survey-env
    survey-env/bin/pip install pydicom          (Windows: survey-env\\Scripts\\pip)

Run:
    survey-env/bin/python survey.py /path/to/participant-folders --out survey-output
    (add --limit 20 for a quick trial run)

Output, in the --out folder:
    summary.md            Counts only: no participant IDs or dates.
    cases.csv             One row per participant.
    studies.csv           One row per imaging study.
    manifest.headers.json Everything gathered.
    errors.log            Anything that couldn't be read.

The CSVs and JSON hold the (already pseudonymised) participant IDs and
screening outcomes. Share them internally, ideally via the team SharePoint, and
never commit any of it to git or put it anywhere public.
"""
import argparse
import collections
import csv
import glob
import json
import os
import statistics
import sys
import time
from datetime import date

try:
    import pydicom
except ImportError:
    sys.exit("pydicom is not installed. Run: pip install pydicom")

STANDARD_VIEWS = {("R", "CC"), ("L", "CC"), ("R", "MLO"), ("L", "MLO")}

# NBSS fields whose values we tally across all episodes, to help decode them
NBSS_EPISODE_FIELDS = ["EpisodeType", "EpisodeAction", "EpisodeIsClosed", "IntervalCancerType"]
NBSS_SCREENING_SIDE_FIELDS = [
    "Opinion", "FinalAction", "FinalActionSource", "FilmReaderOpinions", "FilmRecommendedActions",
    "FilmReader1Opinion", "FilmReader1RecAction", "FilmReader2Opinion", "FilmReader2RecAction",
    "FilmReader3Opinion", "FilmReader3RecAction", "RepeatReason", "NumberOfRepeats", "Mass",
    "Microcalcification", "MicrocalcWithMass", "EquipmentUsed", "EquipmentMakeModel",
]


def parse_date(s):
    try:
        return date(int(s[:4]), int(s[4:6]), int(s[6:8]))
    except (TypeError, ValueError):
        return None


def read_header(path):
    ds = pydicom.dcmread(path, stop_before_pixels=True)
    if "Modality" not in ds:
        raise ValueError("no Modality - not an image file?")
    sop = getattr(ds.get("SOPClassUID"), "name", str(ds.get("SOPClassUID", "")))
    image_type = [str(x) for x in ds.get("ImageType", [])]
    modifiers = []
    try:
        modifiers = [str(m.CodeMeaning) for m in ds.ViewCodeSequence[0].get("ViewModifierCodeSequence", [])]
    except (AttributeError, IndexError, KeyError):
        pass
    protocol = ""
    try:
        protocol = str(ds.PerformedProtocolCodeSequence[0].CodeMeaning)
    except (AttributeError, IndexError, KeyError):
        pass
    return {
        "file": os.path.basename(path),
        "bytes": os.path.getsize(path),
        "modality": str(ds.get("Modality", "")),
        "sopClass": sop,
        "laterality": str(ds.get("ImageLaterality", "") or ds.get("Laterality", "")),
        "view": str(ds.get("ViewPosition", "")),
        "viewModifiers": modifiers,
        "imageType": image_type,
        "instance": int(ds.get("InstanceNumber", 0) or 0),
        "frames": int(ds.get("NumberOfFrames", 1) or 1),
        "rows": int(ds.get("Rows", 0) or 0),
        "columns": int(ds.get("Columns", 0) or 0),
        "photometric": str(ds.get("PhotometricInterpretation", "")),
        "forProcessing": "Processing" in sop,
        "synthetic2D": "GENERATED_2D" in image_type,
        "tomo": "Tomosynthesis" in sop or int(ds.get("NumberOfFrames", 1) or 1) > 1,
        "implant": str(ds.get("BreastImplantPresent", "")) == "YES",
        "burnedInAnnotation": str(ds.get("BurnedInAnnotation", "")),
        "orientation": [str(x) for x in ds.get("PatientOrientation", [])],
        "manufacturer": str(ds.get("Manufacturer", "")),
        "model": str(ds.get("ManufacturerModelName", "")),
        "protocol": protocol,
        "age": str(ds.get("PatientAge", "")),
    }


def classify_study(images):
    modalities = {i["modality"] for i in images}
    if modalities - {"MG"}:
        return "other-" + "-".join(sorted(modalities))
    if any(i["tomo"] for i in images):
        return "tomosynthesis"
    usable = [i for i in images if not i["forProcessing"] and not i["synthetic2D"]]
    if not usable:
        return "synthetic-2d-only" if any(i["synthetic2D"] for i in images) else "unusable"
    plain = {(i["laterality"], i["view"]) for i in usable if not i["viewModifiers"]}
    all_views = {(i["laterality"], i["view"], tuple(i["viewModifiers"])) for i in usable}
    extra = [v for v in all_views if (v[0], v[1]) not in STANDARD_VIEWS or v[2]]
    if STANDARD_VIEWS <= plain:
        return "screening" if not extra else "screening-plus"
    sides = {lat for lat, _ in plain}
    if plain and not extra and len(sides) == 1:
        return "screening-one-side"
    return "assessment-or-other"


def duplicate_views(images):
    groups = collections.Counter(
        (i["laterality"], i["view"], tuple(i["viewModifiers"]))
        for i in images
        if i["modality"] == "MG" and not i["forProcessing"] and not i["synthetic2D"] and not i["tomo"]
    )
    return sorted(f"{lat}{view}{'+' + '/'.join(m) if m else ''}x{n}" for (lat, view, m), n in groups.items() if n > 1)


# Code meanings: DS0026 NBSS Crystal Reports Tables. Final/reader actions: RR routine
# recall, RC review in clinic (recall to assessment), TR repeat film (technical).


def recalled(episode):
    """Recalled to assessment at screening: either side's final action is RC, or the outcome is S+."""
    scr = (episode or {}).get("SCREENING") or {}
    sides = [scr.get("R") or {}, scr.get("L") or {}]
    return scr.get("diagnosticsetoutcome") == "S+" or any(s.get("FinalAction") == "RC" for s in sides)


def reader_actions(episode):
    scr = (episode or {}).get("SCREENING") or {}
    return [
        (scr.get(side) or {}).get(f"FilmReader{n}RecAction")
        for side in ("R", "L")
        for n in range(1, 6)
    ]


def any_reader_technical_recall(episode):
    return "TR" in reader_actions(episode)


def arbitrated(episode):
    """A person arbitrated (FinalActionSource D), or a third reader is recorded."""
    scr = (episode or {}).get("SCREENING") or {}
    sides = [scr.get("R") or {}, scr.get("L") or {}]
    return any(s.get("FinalActionSource") == "D" or s.get("FilmReader3RecAction") for s in sides)


def study_outcome(episode):
    """Rough outcome of a screening round, for counting possible cases."""
    if not episode:
        return "unknown (no NBSS episode)"
    if recalled(episode):
        return "recalled"
    if any_reader_technical_recall(episode):
        return "routine, but a reader asked for a technical repeat"
    return "routine recall"


def survey_case(folder, errors):
    client = os.path.basename(folder.rstrip("/\\"))
    imagedb_files = glob.glob(os.path.join(folder, "IMAGEDB_*.json"))
    nbss_files = glob.glob(os.path.join(folder, "NBSS_*.json"))
    if not imagedb_files:
        errors.append(f"{client}: no IMAGEDB json")
        return None
    with open(imagedb_files[0]) as f:
        imagedb = json.load(f)
    nbss = {}
    if nbss_files:
        with open(nbss_files[0]) as f:
            nbss = json.load(f)
    else:
        errors.append(f"{client}: no NBSS json")
    episodes = {k: v for k, v in nbss.items() if isinstance(v, dict)}

    studies = []
    for study_uid, meta in (imagedb.get("STUDIES") or {}).items():
        study_dir = os.path.join(folder, study_uid)
        files = sorted(glob.glob(os.path.join(study_dir, "*.dcm")))
        if not files:
            errors.append(f"{client}/{study_uid}: in IMAGEDB but no .dcm files on disk")
            continue
        images = []
        first = None
        try:
            first = read_header(files[0])
        except Exception as e:  # noqa: BLE001
            errors.append(f"{client}/{study_uid}/{os.path.basename(files[0])}: {e}")
        if first and first["modality"] not in ("MG", ""):
            # MRI and similar: thousands of slices we won't use. Read one, count the rest.
            images = [first]
            other_bytes = sum(os.path.getsize(p) for p in files[1:])
        else:
            other_bytes = 0
            if first:
                images.append(first)
            for p in files[1:]:
                try:
                    images.append(read_header(p))
                except Exception as e:  # noqa: BLE001
                    errors.append(f"{client}/{study_uid}/{os.path.basename(p)}: {e}")
        if not images:
            continue
        episode_id = meta.get("EpisodeID")
        studies.append({
            "studyUid": study_uid,
            "studyDate": meta.get("StudyDate"),
            "episodeId": episode_id,
            "episodeInNbss": bool(episode_id and episode_id in episodes),
            "kind": classify_study(images),
            "fileCount": len(files),
            "bytes": sum(i["bytes"] for i in images) + other_bytes,
            "duplicateViews": duplicate_views(images),
            "hasForProcessing": any(i["forProcessing"] for i in images),
            "hasSynthetic2D": any(i["synthetic2D"] for i in images),
            "hasImplants": any(i["implant"] for i in images),
            "manufacturers": sorted({i["manufacturer"] for i in images}),
            "age": images[0]["age"],
            "images": images,
        })

    on_disk = {os.path.basename(p) for p in glob.glob(os.path.join(folder, "2.25.*")) if os.path.isdir(p)}
    for missing in sorted(on_disk - set(imagedb.get("STUDIES", {}))):
        errors.append(f"{client}/{missing}: folder on disk but not in IMAGEDB")

    studies.sort(key=lambda s: s["studyDate"] or "")
    screening = [s for s in studies if s["kind"] in ("screening", "screening-plus")]
    latest = screening[-1] if screening else None
    latest_ep = episodes.get(latest["episodeId"]) if latest and latest["episodeId"] else None
    recalled_screening = [s for s in screening if s["episodeId"] and recalled(episodes.get(s["episodeId"]))]
    latest_recalled = recalled_screening[-1] if recalled_screening else None

    screening_dates = [parse_date(s["studyDate"]) for s in screening]
    gaps = [(b - a).days for a, b in zip(screening_dates, screening_dates[1:]) if a and b]

    def side_opinion(ep, side):
        return (((ep or {}).get("SCREENING") or {}).get(side) or {}).get("Opinion")

    return {
        "id": client,
        "site": imagedb.get("Site"),
        "classification": nbss.get("Classification"),
        "nbssEpisodes": len(episodes),
        "nbssEpisodesRecalled": sum(1 for e in episodes.values() if recalled(e)),
        "nbssIntervalCancer": any((e.get("IntervalCancerType") or "") for e in episodes.values()),
        "studies": studies,
        "studyKinds": dict(collections.Counter(s["kind"] for s in studies)),
        "screeningStudies": len(screening),
        "latestScreeningHasNbss": bool(latest_ep),
        "latestScreeningRecalled": bool(latest_ep and recalled(latest_ep)),
        "latestScreeningOpinion": f"{side_opinion(latest_ep, 'R') or '-'}/{side_opinion(latest_ep, 'L') or '-'}",
        "latestScreeningAge": latest["age"] if latest else "",
        "recalledScreeningStudies": len(recalled_screening),
        "priorsBeforeLatestRecalled": screening.index(latest_recalled) if latest_recalled else None,
        "technicalRecallByAReaderStudies": sum(
            1 for s in screening if s["episodeId"] and any_reader_technical_recall(episodes.get(s["episodeId"]))
        ),
        "arbitratedScreeningStudies": sum(
            1 for s in screening if s["episodeId"] and arbitrated(episodes.get(s["episodeId"]))
        ),
        "screeningGapDays": gaps,
        "studiesAsCurrent": [
            {"outcome": study_outcome(episodes.get(s["episodeId"]) if s["episodeId"] else None), "priors": n}
            for n, s in enumerate(screening)
        ],
        "hasDuplicateViews": any(s["duplicateViews"] for s in screening),
        "hasImplants": any(s["hasImplants"] for s in studies),
        "manufacturers": sorted({m for s in studies for m in s["manufacturers"]}),
        "nbss": nbss,
    }


def table(counter, heading, limit=40):
    lines = [f"\n### {heading}\n", "| Value | Count |", "|---|---|"]
    for value, n in counter.most_common(limit):
        lines.append(f"| {value if value not in (None, '') else '(blank)'} | {n} |")
    if len(counter) > limit:
        lines.append(f"| … {len(counter) - limit} more | |")
    return "\n".join(lines)


def write_summary(cases, errors, path, seconds):
    c = collections.Counter
    studies = [s for case in cases for s in case["studies"]]
    images = [i for s in studies for i in s["images"]]
    screening = [s for s in studies if s["kind"] in ("screening", "screening-plus")]
    mg_2d = [i for s in screening for i in s["images"] if not i["forProcessing"] and not i["synthetic2D"]]

    bytes_by_kind = c()
    for s in studies:
        bytes_by_kind[s["kind"]] += s["bytes"]

    out = [
        "# Real image set: survey summary",
        "",
        "Counts only - no IDs or dates.",
        "",
        f"- Participants: {len(cases)}",
        f"- Studies: {len(studies)}",
        f"- Files: {sum(s['fileCount'] for s in studies)}, {sum(s['bytes'] for s in studies) / 1e9:.1f} GB",
        f"- Screening studies (4 standard views): {len(screening)}, {len(mg_2d)} usable 2D images",
        f"- Read errors: {len(errors)} (see errors.log)",
        f"- Took {seconds / 60:.1f} minutes",
        "",
        "## Participants",
        table(c(x["classification"] for x in cases), "NBSS Classification"),
        table(c(x["screeningStudies"] for x in cases), "Screening studies per participant (current + priors)"),
        table(c(x["latestScreeningHasNbss"] for x in cases), "Latest screening study has an NBSS episode (known outcome)"),
        table(c(x["latestScreeningRecalled"] for x in cases), "Latest screening study was recalled"),
        table(c(x["latestScreeningOpinion"] for x in cases), "Latest screening opinion, right/left"),
        table(c(x["recalledScreeningStudies"] for x in cases), "Recalled screening studies (with images) per participant"),
        table(c(x["priorsBeforeLatestRecalled"] for x in cases if x["priorsBeforeLatestRecalled"] is not None),
              "Priors available before the latest recalled study"),
        table(c(x["technicalRecallByAReaderStudies"] for x in cases),
              "Screening studies (with images) where a reader asked for a technical repeat (TR)"),
        table(c(x["arbitratedScreeningStudies"] for x in cases), "Screening studies (with images) that went to arbitration"),
        table(c(a for x in cases for e in x["nbss"].values() if isinstance(e, dict) for a in reader_actions(e) if a),
              "Every reader's recommended action, all episodes"),
        table(c(x["nbssIntervalCancer"] for x in cases), "Any interval cancer recorded"),
        table(c(x["hasDuplicateViews"] for x in cases), "Any screening study with a view taken more than once"),
        table(c(x["hasImplants"] for x in cases), "Any implant images"),
        table(c(x["latestScreeningAge"] for x in cases), "Age at latest screening study"),
        table(c(len(x["manufacturers"]) for x in cases), "Number of different manufacturers per participant"),
        "\n## Possible cases, using any screening study as 'current'",
        "\nEach screening study could be a case, with only the studies before it as priors.",
        table(c(
            f"{s['outcome']}, {s['priors'] if s['priors'] < 3 else '3+'} priors"
            for x in cases for s in x["studiesAsCurrent"]
        ), "Outcome and priors available", limit=60),
        "\n## Studies",
        table(c(s["kind"] for s in studies), "Study kind"),
        "\n### Size by study kind\n\n| Kind | GB |\n|---|---|",
        "\n".join(f"| {k} | {v / 1e9:.2f} |" for k, v in bytes_by_kind.most_common()),
        table(c(s["episodeInNbss"] for s in studies), "Study linked to an NBSS episode"),
        table(c(len(s["images"]) for s in screening), "Images per screening study"),
        table(c(d for s in screening for d in s["duplicateViews"]), "Duplicate views in screening studies"),
        table(c(s["hasForProcessing"] for s in screening), "Screening study includes 'for processing' images"),
        table(c((g // 365) for x in cases for g in x["screeningGapDays"]), "Years between consecutive screening studies"),
        "\n## Images",
        table(c(i["modality"] for i in images), "Modality (MRI etc. counted once per study)"),
        table(c(i["sopClass"] for i in images), "SOP class"),
        table(c(f"{i['manufacturer']} {i['model']}" for i in images), "Manufacturer and model"),
        table(c(f"{i['columns']}x{i['rows']}" for i in mg_2d), "Size of usable screening images (w x h)"),
        table(c(f"{i['laterality']}{i['view']}" for i in images if i["modality"] == "MG"), "Laterality and view"),
        table(c("/".join(i["viewModifiers"]) for i in images if i["viewModifiers"]), "View modifiers"),
        table(c(i["protocol"] for i in images), "Protocol"),
        table(c(i["photometric"] for i in images), "Photometric interpretation"),
        table(c(i["burnedInAnnotation"] for i in images), "BurnedInAnnotation tag"),
        table(c(tuple(i["orientation"]) + (i["laterality"],) for i in mg_2d), "Orientation + laterality"),
        "\n## NBSS values (to help decode the codes)",
    ]

    episodes = [e for x in cases for e in x["nbss"].values() if isinstance(e, dict)]
    for field in NBSS_EPISODE_FIELDS:
        out.append(table(c(e.get(field) for e in episodes), f"Episode {field}"))
    out.append(table(c((e.get("SCREENING") or {}).get("diagnosticsetoutcome") for e in episodes), "SCREENING outcome"))
    sides = [(e.get("SCREENING") or {}).get(s) or {} for e in episodes for s in ("R", "L")]
    sides = [s for s in sides if s]
    for field in NBSS_SCREENING_SIDE_FIELDS:
        out.append(table(c(s.get(field) for s in sides), f"SCREENING side {field}"))
    for section in ("ASSESSMENT", "CLINICAL", "BIOPSYWIDE", "BIOPSYFINE", "SURGERY"):
        present = [e[section] for e in episodes if isinstance(e.get(section), dict)]
        if not present:
            continue
        out.append(table(c(p.get("diagnosticsetoutcome") for p in present), f"{section} outcome"))
        out.append(table(c(p.get("Opinion") for p in present), f"{section} opinion"))
        details = [d for p in present for side in ("R", "L") for d in (p.get(side) or {}).values() if isinstance(d, dict)]
        for field in ("MammoOpinion", "UssOpinion", "MammoMass", "MammoCalcification", "action",
                      "NeedleSpecimenType", "MalignancyType", "InvasiveType"):
            values = c(d.get(field) for d in details if field in d)
            if values:
                out.append(table(values, f"{section} {field}"))
    lesions = [l for e in episodes for side in (e.get("LESION") or {}).values() for l in side.values()]
    out.append(table(c(l.get("LesionDescription") for l in lesions), "LESION description"))
    out.append(table(c(l.get("LesionPosition") for l in lesions), "LESION position"))
    other_sections = c(k for e in episodes for k, v in e.items() if isinstance(v, dict))
    out.append(table(other_sections, "NBSS sections present"))

    with open(path, "w") as f:
        f.write("\n".join(out) + "\n")


CASE_COLUMNS = [
    "id", "site", "classification", "nbssEpisodes", "nbssEpisodesRecalled", "nbssIntervalCancer",
    "screeningStudies", "latestScreeningHasNbss", "latestScreeningRecalled", "latestScreeningOpinion",
    "latestScreeningAge", "recalledScreeningStudies", "priorsBeforeLatestRecalled",
    "technicalRecallByAReaderStudies", "arbitratedScreeningStudies", "hasDuplicateViews",
    "hasImplants", "manufacturers", "studyKinds",
]
STUDY_COLUMNS = [
    "caseId", "studyUid", "studyDate", "episodeId", "episodeInNbss", "kind", "fileCount", "bytes",
    "duplicateViews", "hasForProcessing", "hasSynthetic2D", "hasImplants", "manufacturers", "age",
]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", help="folder containing one folder per participant")
    parser.add_argument("--out", default="survey-output", help="output folder (default: survey-output)")
    parser.add_argument("--limit", type=int, help="only survey the first N participants")
    args = parser.parse_args()

    folders = sorted(p for p in glob.glob(os.path.join(args.source, "*")) if os.path.isdir(p))
    if args.limit:
        folders = folders[: args.limit]
    if not folders:
        sys.exit(f"No participant folders found in {args.source}")
    os.makedirs(args.out, exist_ok=True)

    started = time.time()
    cases, errors = [], []
    for n, folder in enumerate(folders, 1):
        try:
            case = survey_case(folder, errors)
            if case:
                cases.append(case)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{os.path.basename(folder)}: {type(e).__name__}: {e}")
        if n % 10 == 0 or n == len(folders):
            print(f"{n}/{len(folders)} participants, {time.time() - started:.0f}s", flush=True)

    write_summary(cases, errors, os.path.join(args.out, "summary.md"), time.time() - started)

    with open(os.path.join(args.out, "cases.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CASE_COLUMNS, extrasaction="ignore")
        w.writeheader()
        for case in cases:
            row = dict(case, manufacturers="; ".join(case["manufacturers"]),
                       studyKinds="; ".join(f"{k}:{v}" for k, v in case["studyKinds"].items()))
            w.writerow(row)

    with open(os.path.join(args.out, "studies.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=STUDY_COLUMNS, extrasaction="ignore")
        w.writeheader()
        for case in cases:
            for s in case["studies"]:
                w.writerow(dict(s, caseId=case["id"], duplicateViews="; ".join(s["duplicateViews"]),
                                manufacturers="; ".join(s["manufacturers"])))

    with open(os.path.join(args.out, "manifest.headers.json"), "w") as f:
        json.dump({"version": 0, "source": "real-images", "cases": cases}, f, indent=1)

    with open(os.path.join(args.out, "errors.log"), "w") as f:
        f.write("\n".join(errors) + ("\n" if errors else ""))

    print(f"Done: {len(cases)} participants, {len(errors)} errors. Output in {args.out}/")


if __name__ == "__main__":
    main()
