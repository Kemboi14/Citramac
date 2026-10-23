"""
Kenya Core (ke.fhir.core 1.0.0, R4 4.0.1) read straight from the vendored
package (kenya_core/ke.fhir.core-1.0.0.tgz, provenance in kenya_core/SOURCE.md).

Two uses:
- the Shared Health Record exporter takes its profile URLs, identifier
  systems and code lists from here, so none of them is typed from memory;
- `check()` enforces a profile's own differential against a resource:
  meta.profile, required elements (min ≥ 1, nested ones checked under each
  parent present) and required bindings whose codes the package enumerates.
  Base R4 schema validity is checked separately (validator.validate_resource);
  CI additionally runs HL7's official validator against the same package.
"""

import json
import tarfile
from functools import lru_cache
from pathlib import Path

PACKAGE = Path(__file__).parent / "kenya_core" / "ke.fhir.core-1.0.0.tgz"
CANONICAL = "https://fhir.dha.go.ke/core"


@lru_cache(maxsize=1)
def _artifacts():
    found = {}
    with tarfile.open(PACKAGE, "r:gz") as archive:
        for member in archive.getmembers():
            name = member.name
            if not name.startswith("package/") or "/example/" in name or not name.endswith(".json"):
                continue
            data = json.load(archive.extractfile(member))
            if isinstance(data, dict) and data.get("url"):
                found[data["url"]] = data
    return found


def artifact(url):
    return _artifacts().get(url)


def profile_url(name):
    url = f"{CANONICAL}/StructureDefinition/{name}"
    if url not in _artifacts():
        raise KeyError(f"{url} is not in ke.fhir.core 1.0.0")
    return url


# The profiles the SHR exporter conforms to.
def encounter_profile():
    return profile_url("kenya-core-encounter")


def episode_profile():
    return profile_url("kenya-core-episodeofcare")


def condition_profile():
    return profile_url("kenya-core-condition")


def identifier_system(slice_name, profile="kenya-core-patient"):
    """patternUri of a Patient.identifier slice, e.g. 'nationalId', 'shaNumber'."""
    sd = artifact(profile_url(profile))
    for element in sd["differential"]["element"]:
        if element.get("id") == f"Patient.identifier:{slice_name}.system":
            return element["patternUri"]
    raise KeyError(f"No identifier slice {slice_name} in {profile}")


def _codes_from_codesystem(cs):
    codes = []

    def walk(concepts):
        for concept in concepts or []:
            codes.append(concept["code"])
            walk(concept.get("concept"))

    walk(cs.get("concept"))
    return codes


@lru_cache(maxsize=None)
def valueset_codes(url):
    """{(system, code)} the ValueSet enumerates, or None when it includes a
    whole external code system (not enumerable from the package)."""
    vs = artifact(url)
    if vs is None:
        return None
    pairs = set()
    for include in vs.get("compose", {}).get("include", []):
        system = include.get("system")
        if include.get("concept"):
            pairs.update((system, c["code"]) for c in include["concept"])
            continue
        cs = artifact(system) if system else None
        if cs is None or include.get("filter"):
            return None
        pairs.update((system, code) for code in _codes_from_codesystem(cs))
    return frozenset(pairs)


def coding(valueset_url, code):
    """{system, code, display} for `code` from a package ValueSet — so a code
    the package does not define can never be emitted."""
    vs = artifact(valueset_url)
    for include in (vs or {}).get("compose", {}).get("include", []):
        system = include.get("system")
        cs = artifact(system) if system else None
        concepts = include.get("concept") or (cs or {}).get("concept") or []
        stack = list(concepts)
        while stack:
            concept = stack.pop()
            if concept.get("code") == code:
                return {"system": system, "code": code, "display": concept.get("display", code)}
            stack.extend(concept.get("concept") or [])
    raise KeyError(f"{code} is not in {valueset_url}")


def _values(node, key):
    """Values of `key` on a node, expanding a choice element (`value[x]`)."""
    if not isinstance(node, dict):
        return []
    if key.endswith("[x]"):
        stem = key[:-3]
        return [v for k, v in node.items() if k.startswith(stem) and k[len(stem):][:1].isupper()]
    value = node.get(key)
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _nodes(resource, parts):
    nodes = [resource]
    for part in parts:
        nodes = [child for node in nodes for child in _values(node, part)]
    return nodes


def _binding_ok(values, allowed):
    for value in values:
        if isinstance(value, str):
            if not any(code == value for _, code in allowed):
                return False
        elif isinstance(value, dict):
            codings = value.get("coding") if "coding" in value else [value]
            if codings and not any(
                (c.get("system"), c.get("code")) in allowed for c in codings if isinstance(c, dict)
            ):
                return False
    return True


def check(resource, profile):
    """Problems with `resource` against a Kenya Core profile's differential."""
    sd = artifact(profile)
    if sd is None:
        return [f"Unknown profile {profile}"]
    problems = []
    if profile not in (resource.get("meta") or {}).get("profile", []):
        problems.append(f"{sd['type']}.meta.profile: must include {profile}")
    for element in sd["differential"]["element"]:
        element_id = element.get("id", "")
        if ":" in element_id or "." not in element_id:
            continue  # slices are optional here; the root has no constraint to test
        parts = element_id.split(".")[1:]
        parents = _nodes(resource, parts[:-1])
        if element.get("min", 0) >= 1:
            for parent in parents:
                if not _values(parent, parts[-1]):
                    problems.append(f"{element_id}: required (min {element['min']})")
        binding = element.get("binding") or {}
        if binding.get("strength") == "required" and binding.get("valueSet"):
            allowed = valueset_codes(binding["valueSet"].split("|")[0])
            if allowed:
                values = [v for parent in parents for v in _values(parent, parts[-1])]
                if values and not _binding_ok(values, allowed):
                    problems.append(f"{element_id}: not in required ValueSet {binding['valueSet']}")
    return problems
