"""
Our own profiles for the psychotherapy note document (guide.md §3 item 2),
read from `fhir_profiles/` — the same files HL7's validator loads in CI.

Kenya Core 1.0.0 has no Composition profile, and no published IG profiles a
psychotherapy note, so these are local (urn:citramac:, VERIFY our canonical
base). `check()` enforces each profile's differential in tests — meta.profile,
min / max, fixed and pattern values, and required bindings to our own code
systems. The FHIRPath invariants (security labels, section set, risk entry) are
enforced by HL7's validator; the tests assert the same facts directly.
"""

import json
from functools import lru_cache
from pathlib import Path

from apps.dha_interop.fhir_validation.kenya_core import _binding_ok, _nodes, _values

PROFILES = Path(__file__).parent / "fhir_profiles"


@lru_cache(maxsize=1)
def artifacts():
    return {
        data["url"]: data
        for data in (json.loads(p.read_text()) for p in sorted(PROFILES.glob("*.json")))
    }


def valueset_codes(url):
    vs = artifacts().get(url) or {}
    allowed = set()
    for include in vs.get("compose", {}).get("include", []):
        cs = artifacts().get(include.get("system")) or {}
        allowed |= {(include["system"], c["code"]) for c in cs.get("concept", [])}
    return frozenset(allowed)


def _matches(value, pattern):
    if isinstance(pattern, dict):
        if not isinstance(value, dict):
            return False
        return all(_matches(value.get(k), v) for k, v in pattern.items())
    if isinstance(pattern, list):
        values = value if isinstance(value, list) else []
        return all(any(_matches(v, p) for v in values) for p in pattern)
    return value == pattern


def check(resource, profile):
    """Problems with `resource` against one of our profiles' differential."""
    sd = artifacts().get(profile)
    if sd is None:
        return [f"Unknown profile {profile}"]
    problems = []
    if profile not in (resource.get("meta") or {}).get("profile", []):
        problems.append(f"{sd['type']}.meta.profile: must include {profile}")
    for element in sd["differential"]["element"]:
        element_id = element["id"]
        if "." not in element_id:
            continue
        parts = element_id.split(".")[1:]
        parents = _nodes(resource, parts[:-1])
        for parent in parents:
            values = _values(parent, parts[-1])
            if len(values) < element.get("min", 0):
                problems.append(f"{element_id}: at least {element['min']} required")
            if element.get("max", "*") != "*" and len(values) > int(element["max"]):
                problems.append(f"{element_id}: at most {element['max']} allowed")
            for value in values:
                if "fixedCode" in element and value != element["fixedCode"]:
                    problems.append(f"{element_id}: must be {element['fixedCode']}")
                pattern = element.get("patternCodeableConcept")
                if pattern and not _matches(value, pattern):
                    problems.append(f"{element_id}: does not carry the profile's code")
            binding = element.get("binding") or {}
            if values and binding.get("strength") == "required":
                if not _binding_ok(values, valueset_codes(binding["valueSet"])):
                    problems.append(f"{element_id}: not in required ValueSet {binding['valueSet']}")
    return problems
