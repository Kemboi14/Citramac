"""
FHIR R4 4.0.1 conformance validator — CLAUDE.md "Project standing rules —
FHIR R4 conformance", §2 rung 2 (valid R4 that passes the base schema).

Checks constructed resources against HL7's own combined JSON Schema for R4
4.0.1 (vendored verbatim in `schemas/fhir.schema.json`, see `schemas/SOURCE.md`),
never against `fhir.resources`' bundled schema. This is deliberate:
`apps.dha_interop.fhir_mapper` constructs resources via `fhir.resources.R4B`
(see that module's docstring and CLAUDE.md §1's documented exception) because
no maintained release of that library still ships a true-R4 default
namespace. Validating against the library's own R4B schema would silently
legitimize any R4B-only shape it happens to produce; validating against the
real, independently-sourced R4 schema is what actually enforces the pinned
4.0.1 contract, including catching an R4B-only field via the schema's
`additionalProperties: false`.

Rung 2 only: the base R4 schema makes almost every element optional (see
CLAUDE.md §2), so a resource passing here is schema-valid, not necessarily
complete or clinically sound. Reaching rung 3/4 needs real StructureDefinitions
bound to a published implementation guide, which does not exist for this
system yet (see docs/DHA-CERTIFICATION-SUBMISSION-READINESS.md) — out of
scope for this module by design, not an oversight.
"""

import json
from functools import lru_cache
from pathlib import Path

import jsonschema
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT6

_SCHEMA_PATH = Path(__file__).parent / "schemas" / "fhir.schema.json"


class FhirConformanceError(AssertionError):
    """A constructed resource/bundle failed HL7 R4 4.0.1 schema validation."""


@lru_cache(maxsize=1)
def _schema():
    with open(_SCHEMA_PATH) as f:
        return json.load(f)


@lru_cache(maxsize=1)
def _registry():
    schema = _schema()
    resource = Resource.from_contents(schema, default_specification=DRAFT6)
    return Registry().with_resource(uri=schema["id"], resource=resource)


@lru_cache(maxsize=None)
def _validator_for(resource_type):
    schema = _schema()
    if resource_type not in schema["definitions"]:
        return None
    sub_schema = {"$ref": f"{schema['id']}#/definitions/{resource_type}"}
    return jsonschema.Draft6Validator(sub_schema, registry=_registry())


def validate_resource(resource):
    """
    Validate one FHIR resource dict against the real R4 4.0.1 definition for
    its own `resourceType`. Returns a list of human-readable error strings
    (empty list = conformant to rung 2). Never raises on a failed check —
    callers (tests, `assert_conformant`) decide whether that's fatal.
    """
    resource_type = resource.get("resourceType")
    if not resource_type:
        return ["resource has no 'resourceType'"]
    validator = _validator_for(resource_type)
    if validator is None:
        return [f"{resource_type!r} is not a known FHIR R4 resource type"]
    errors = sorted(validator.iter_errors(resource), key=lambda e: list(map(str, e.path)))
    return [f"{'/'.join(str(p) for p in e.path) or '<root>'}: {e.message}" for e in errors]


def validate_bundle(bundle):
    """
    Validate a Bundle against the real R4 4.0.1 Bundle definition, *and*
    every `entry[].resource` against its own specific resourceType's
    definition. The Bundle schema alone only constrains each entry.resource
    to *some* valid resource (a `oneOf` over every R4 resource type) — most
    resource schemas leave almost everything optional, so a resource that's
    schema-valid as some unrelated type could slip past a bare Bundle check.
    Validating each entry against the type it actually claims closes that
    gap.

    Returns a dict of {label: [errors]} for every entry that failed; an
    empty dict means the whole bundle is conformant to rung 2.
    """
    results = {}
    bundle_errors = validate_resource(bundle)
    if bundle_errors:
        results["Bundle"] = bundle_errors
    for i, entry in enumerate(bundle.get("entry", [])):
        resource = entry.get("resource")
        if resource is None:
            continue
        resource_errors = validate_resource(resource)
        if resource_errors:
            results[f"entry[{i}] ({resource.get('resourceType', '?')})"] = resource_errors
    return results


def assert_conformant(payload):
    """
    Raise `FhirConformanceError` with every violation if `payload` (a
    resource or a Bundle dict) is not rung-2 conformant to R4 4.0.1.
    """
    if payload.get("resourceType") == "Bundle":
        errors = validate_bundle(payload)
    else:
        resource_errors = validate_resource(payload)
        errors = (
            {payload.get("resourceType", "<unknown>"): resource_errors} if resource_errors else {}
        )
    if errors:
        detail = "\n".join(f"{label}:\n  " + "\n  ".join(msgs) for label, msgs in errors.items())
        raise FhirConformanceError(f"FHIR R4 4.0.1 conformance failed:\n{detail}")
