"""CI gate: fail only when the tree has a secret finding the baseline doesn't list.

Usage: python backend/scripts/secrets_baseline_gate.py <baseline> <fresh-scan>

The old check (`detect-secrets scan --baseline` then `git diff --exit-code`) could
never pass: the scan rewrites `generated_at` on every run, and any edit that
moves a line in a file holding a baselined fixture shifts its `line_number`.
A finding is identified here by (file, type, hashed secret), so moved lines
and the timestamp are ignored while a new secret, or a known one appearing in
a new file, still fails the build.
"""

import json
import sys


def findings(path):
    with open(path) as fh:
        results = json.load(fh)["results"]
    return {
        (filename, item["type"], item["hashed_secret"]): item["line_number"]
        for filename, items in results.items()
        for item in items
    }


def main(baseline_path, scan_path):
    known = findings(baseline_path)
    new = {key: line for key, line in findings(scan_path).items() if key not in known}
    if not new:
        print(f"No new secrets ({len(known)} baselined findings).")
        return 0
    print("New potential secrets not in .secrets.baseline:")
    for (filename, kind, _), line in sorted(new.items()):
        print(f"  {filename}:{line}  {kind}")
    print(
        "\nIf these are not real secrets, audit them and update the baseline:\n"
        '  detect-secrets scan --baseline .secrets.baseline --exclude-lines "citramac:citramac"'
    )
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
