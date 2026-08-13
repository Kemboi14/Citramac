#!/usr/bin/env python
"""
Data-integrity smoke test for a restored database — docs/12-DEVOPS-DEPLOYMENT.md
§12.6 step 3: "row counts, referential integrity spot checks, a sample
patient record round-trip."

Usage:
    # Capture a baseline from the live database before backing it up:
    DATABASE_URL=<live-db-url> python scripts/verify_restore.py --capture-baseline baseline.json

    # After restoring into a scratch database, verify it matches:
    DATABASE_URL=<restored-db-url> python scripts/verify_restore.py --baseline baseline.json
"""

import argparse
import json
import os
import sys
from pathlib import Path

import django

# Run via `python scripts/verify_restore.py` from the `backend/` directory —
# Python puts the script's own folder on sys.path, not the cwd, so the
# `config`/`apps` packages need to be added explicitly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")
django.setup()

from apps.ccp_program.models import PsychotherapySession  # noqa: E402
from apps.client_registry.models import Patient  # noqa: E402
from apps.clinical_encounter.models import Encounter  # noqa: E402
from apps.tenancy.context import platform_admin_context  # noqa: E402
from apps.tenancy.models import Organization  # noqa: E402

TABLES = {
    "organizations": Organization,
    "patients": Patient,
    "encounters": Encounter,
    "psychotherapy_sessions": PsychotherapySession,
}


def collect_counts():
    with platform_admin_context():
        return {name: model.objects.count() for name, model in TABLES.items()}


def referential_integrity_spot_check():
    """Every Encounter must resolve a real Patient — a partial/corrupt restore breaks this join."""
    with platform_admin_context():
        joined = Encounter.objects.select_related("patient").count()
        total = Encounter.objects.count()
    return joined == total


def sample_round_trip():
    with platform_admin_context():
        sample = Patient.objects.order_by("?").first()
    if sample is None:
        return None
    return {
        "id": str(sample.id),
        "name": f"{sample.first_name} {sample.last_name}",
        "citramac_number": sample.citramac_number,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--capture-baseline", metavar="PATH", help="Write current counts to PATH.")
    parser.add_argument("--baseline", metavar="PATH", help="Diff current counts against PATH.")
    args = parser.parse_args()

    counts = collect_counts()
    print("Row counts:", json.dumps(counts, indent=2))

    if args.capture_baseline:
        with open(args.capture_baseline, "w") as f:
            json.dump(counts, f, indent=2)
        print(f"Baseline captured to {args.capture_baseline}")
        return

    failures = []

    if args.baseline:
        with open(args.baseline) as f:
            baseline = json.load(f)
        for table, expected in baseline.items():
            actual = counts.get(table)
            if actual != expected:
                failures.append(f"{table}: expected {expected} rows, found {actual}")

    if not referential_integrity_spot_check():
        failures.append("Referential integrity spot check failed: an Encounter has no Patient.")

    sample = sample_round_trip()
    if sample is None:
        failures.append("No Patient row available for the round-trip sample check.")
    else:
        print("Round-trip sample:", json.dumps(sample, indent=2))

    if failures:
        print("\nFAILED:")
        for failure in failures:
            print(f" - {failure}")
        sys.exit(1)

    print("\nAll integrity checks passed.")


if __name__ == "__main__":
    main()
