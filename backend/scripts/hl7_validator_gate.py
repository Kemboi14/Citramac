"""
Fail the build when HL7's official FHIR validator reports an error in the
published Shared Health Record examples (CLAUDE.md §2 rung 4, §3 item 5).

The validator's exit status does not reflect validation errors, so CI runs it
with `-output <file>` and this script reads the OperationOutcome(s) it writes.

One message is accepted, and only where it is a defect in the national IG
rather than in our data:

- Terminology_TX_ValueSet_NotFound_CS on Condition.code — Kenya Core 1.0.0's
  kenya-core-condition binds Condition.code to `http://id.who.int/icd/release/11/mms`,
  a CodeSystem URL, where a ValueSet belongs. No resource can satisfy that
  binding. To report to DHA (fhir@dha.go.ke, the maintainer address in the
  package manifest). Remove this entry when a corrected release is vendored.

Usage: python scripts/hl7_validator_gate.py outcome.json
"""

import json
import sys

ACCEPTED_IG_DEFECTS = {
    ("Terminology_TX_ValueSet_NotFound_CS", ".code"),
}


def _message_id(issue):
    for extension in issue.get("extension", []):
        if extension.get("url", "").endswith("operationoutcome-message-id"):
            return extension.get("valueCode", "")
    return ""


def _outcomes(document):
    if document.get("resourceType") == "Bundle":
        return [entry["resource"] for entry in document.get("entry", [])]
    return [document]


def main(path):
    with open(path) as handle:
        document = json.load(handle)
    failures = []
    for outcome in _outcomes(document):
        source = next(
            (
                extension.get("valueString", "")
                for extension in outcome.get("extension", [])
                if extension.get("url", "").endswith("operationoutcome-file")
            ),
            "",
        )
        for issue in outcome.get("issue", []):
            if issue.get("severity") not in ("error", "fatal"):
                continue
            expression = " ".join(issue.get("expression") or [])
            message_id = _message_id(issue)
            if any(
                message_id == accepted_id and expression.endswith(suffix)
                for accepted_id, suffix in ACCEPTED_IG_DEFECTS
            ):
                continue
            failures.append(
                f"{source} {expression}: [{message_id}] {issue.get('details', {}).get('text', '')}"
            )
    for failure in failures:
        print(failure)
    print(f"{len(failures)} validation error(s) outside the accepted Kenya Core defects.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
