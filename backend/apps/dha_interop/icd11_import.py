"""
ICD-11 MMS from WHO's own release file — never from memory (CLAUDE.md §6).

The source is WHO's "simple tabulation" for a release, published at
icdcdn.who.int/static/releasefiles/<release>/SimpleTabulation-ICD-11-MMS-en.zip.
The 2026-01 file is vendored unchanged in `icd11_release/` (provenance and
licence in its SOURCE.md); `manage.py import_icd11` loads a later one.

What an import does:

- Every *category* (an entity with a code) becomes or updates an
  `IcdCodeIndex` row stamped with the release. Its title is WHO's.
- A code imported from an earlier release but missing from this one is marked
  retired in this release. It stays (diagnoses point at it) but can't be chosen.
- Diagnoses recorded from the pre-release stub list (no `icd11_release`) are
  checked against WHO: where the code's WHO title is not what the clinician
  saw, or the code is in no WHO release at all, the diagnosis is flagged for
  re-coding (`code_review_reason`). It is not rewritten — its recorded
  display stays as it was signed — and it is never shared or billed until a
  clinician marks it entered in error and records the right code.

The functions take model classes so the data migration (historical models)
and the management command run the same code.
"""

import csv
import hashlib
import io
import re
import zipfile
from pathlib import Path

from django.db import transaction
from django.utils import timezone

RELEASE_DIR = Path(__file__).resolve().parent / "icd11_release"
VENDORED_RELEASE = "2026-01"
VENDORED_FILE = RELEASE_DIR / "SimpleTabulation-ICD-11-MMS-en-2026-01.zip"
VENDORED_SHA256 = "f1356588f40953a83e3af2b662deab47c5e269f944d1ea4ed0cfeb2007c7cd39"  # pragma: allowlist secret (WHO file hash)
TABULATION_MEMBER = "SimpleTabulation-ICD-11-MMS-en.txt"

# Chapters whose codes stand alone as a diagnosis. Not V (functioning
# assessment), 26 (traditional medicine, supplementary) or X (extension codes,
# which WHO uses only in addition to a stem code). The chapter titles shown
# in messages are read from the release, not written here.
DIAGNOSIS_CHAPTERS = frozenset(f"{n:02d}" for n in range(1, 26))

_TITLE_INDENT = re.compile(r"^(?:-\s)+")
_SPACES = re.compile(r"\s+")


class Icd11ImportError(Exception):
    pass


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _tabulation_text(path):
    path = Path(path)
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as archive:
            if TABULATION_MEMBER not in archive.namelist():
                raise Icd11ImportError(
                    f"{path.name} has no {TABULATION_MEMBER} — is it WHO's MMS simple tabulation?"
                )
            raw = archive.read(TABULATION_MEMBER)
    else:
        raw = path.read_bytes()
    return raw.decode("utf-8-sig")


def clean_title(title):
    """WHO indents titles with "- " per level; the title is what follows."""
    return _TITLE_INDENT.sub("", (title or "").strip().strip('"')).strip()


def same_meaning(a, b):
    return (
        _SPACES.sub(" ", (a or "").strip()).casefold()
        == _SPACES.sub(" ", (b or "").strip()).casefold()
    )


def read_release(path):
    """(version line, {code: entry}, {chapter: title}) from a WHO simple tabulation."""
    reader = csv.reader(io.StringIO(_tabulation_text(path), newline=""), delimiter="\t")
    header = next(reader, None) or []
    columns = {name: i for i, name in enumerate(header)}
    needed = (
        "Linearization URI",
        "Code",
        "Title",
        "ClassKind",
        "IsResidual",
        "ChapterNo",
        "isLeaf",
    )
    missing = [name for name in needed if name not in columns]
    if missing:
        raise Icd11ImportError(
            f"Not a WHO ICD-11 simple tabulation (missing {', '.join(missing)})."
        )
    version = next((name for name in header if name.startswith("Version:")), "")
    # Data rows stop at the last data column; the header adds the version cell.
    width = max(columns[name] for name in needed) + 1

    codes, chapters = {}, {}
    for row in reader:
        # A CodingNote that spans lines leaves continuation rows; they are not entities.
        if len(row) < width:
            continue
        kind = row[columns["ClassKind"]]
        title = clean_title(row[columns["Title"]])
        chapter = row[columns["ChapterNo"]].strip()
        if kind == "chapter":
            chapters[chapter] = title
        if kind != "category":
            continue
        code = row[columns["Code"]].strip()
        if not code:
            continue
        codes[code] = {
            "description": title[:500],
            "linearization_uri": row[columns["Linearization URI"]].strip()[:200],
            "chapter": chapter[:2],
            "is_leaf": row[columns["isLeaf"]].strip() == "True",
            "is_residual": row[columns["IsResidual"]].strip() == "True",
        }
    if not codes:
        raise Icd11ImportError("The file has no coded categories.")
    return version.removeprefix("Version:").strip(), codes, chapters


def import_release(
    IcdCodeIndex,
    DiagnosisCode,
    TerminologySyncRun,
    path,
    release,
    expected_sha256=None,
    actor="",
):
    """Load one WHO release. Returns a summary dict; raises Icd11ImportError."""
    if not re.fullmatch(r"\d{4}-\d{2}", release or ""):
        raise Icd11ImportError("The release is WHO's release id, e.g. 2026-01.")
    sha = file_sha256(path)
    if expected_sha256 and sha != expected_sha256.lower():
        raise Icd11ImportError(f"SHA-256 mismatch: the file is {sha}, expected {expected_sha256}.")
    version, codes, chapters = read_release(path)
    if not version.startswith(release[:4]):
        raise Icd11ImportError(
            f"The file says it is version “{version}”, which is not release {release}."
        )

    started = timezone.now()
    fields = ["description", "linearization_uri", "chapter", "is_leaf", "is_residual"]
    with transaction.atomic():
        existing = {row.code: row for row in IcdCodeIndex.objects.all()}
        to_create, to_update, retired = [], [], []
        for code, entry in codes.items():
            row = existing.get(code)
            if row is None:
                to_create.append(
                    IcdCodeIndex(code=code, release=release, retired_release="", **entry)
                )
                continue
            for name in fields:
                setattr(row, name, entry[name])
            row.release = release
            row.retired_release = ""
            to_update.append(row)
        for code, row in existing.items():
            if code not in codes and row.release and not row.retired_release:
                row.retired_release = release
                retired.append(row)
        IcdCodeIndex.objects.bulk_create(to_create, batch_size=2000)
        IcdCodeIndex.objects.bulk_update(
            to_update, fields + ["release", "retired_release"], batch_size=2000
        )
        IcdCodeIndex.objects.bulk_update(retired, ["retired_release"], batch_size=2000)

        flagged = flag_stub_diagnoses(DiagnosisCode, codes, release)

        summary = {
            "release": release,
            "version": version,
            "sha256": sha,
            "codes": len(codes),
            "added": len(to_create),
            "updated": len(to_update),
            "retired": len(retired),
            "flagged_diagnoses": flagged,
            "chapters": chapters,
        }
        TerminologySyncRun.objects.create(
            source="ICD11",
            status="SUCCESS",
            release=release,
            source_sha256=sha,
            records_synced=len(codes),
            detail=(
                f"WHO ICD-11 MMS {release} ({version}), {Path(path).name}"
                f"{f', by {actor}' if actor else ''}: {len(codes)} codes, {len(to_create)} added, "
                f"{len(to_update)} updated, {len(retired)} retired; "
                f"{len(flagged)} diagnosis(es) flagged for re-coding."
            ),
            started_at=started,
            finished_at=timezone.now(),
        )
    return summary


def flag_stub_diagnoses(DiagnosisCode, codes, release):
    """Flag diagnoses recorded from the unverified list whose code doesn't mean
    what the clinician saw. Returns [(diagnosis id, code, recorded, WHO title)]."""
    flagged, changed = [], []
    rows = DiagnosisCode.objects.filter(icd11_release="", code_review_reason="").exclude(
        verification_status="ENTERED_IN_ERROR"
    )
    for diagnosis in rows.iterator():
        code = diagnosis.icd11_code_id
        recorded = diagnosis.icd11_display
        entry = codes.get(code)
        if entry is None:
            reason = (
                f"Recorded as “{code} {recorded}” from the old, unverified code list. "
                f"{code} is not a code in WHO ICD-11 MMS {release}."
            )
        elif same_meaning(recorded, entry["description"]):
            continue
        else:
            reason = (
                f"Recorded as “{code} {recorded}” from the old, unverified code list. "
                f"In WHO ICD-11 MMS {release}, {code} is “{entry['description']}”."
            )
        diagnosis.code_review_reason = (
            reason + " Mark this diagnosis entered in error and record the correct code."
        )
        changed.append(diagnosis)
        flagged.append((str(diagnosis.pk), code, recorded, entry["description"] if entry else None))
    DiagnosisCode.objects.bulk_update(changed, ["code_review_reason"], batch_size=500)
    return flagged
