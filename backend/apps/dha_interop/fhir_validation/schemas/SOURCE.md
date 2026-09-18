# Provenance: `fhir.schema.json`

- **Source:** https://hl7.org/fhir/R4/fhir.schema.json
- **Release:** R4, version 4.0.1 (`"id": "http://hl7.org/fhir/json-schema/4.0"`)
- **Fetched:** 2026-09-18
- **SHA-256:** `2230406893b4cf002a4ee1e5e2bbeca22ac5d2d4931b3e9ef7b9594bbc376a01`

This is HL7's own combined JSON Schema for every R4 resource type, vendored verbatim (not
regenerated, not hand-edited) so `fhir_validation.validator` can check constructed resources
against real R4 4.0.1 without a network call at test/CI time. Re-fetch and replace this file
(and update the hash above) only for a deliberate, reviewed R4 patch release — not casually,
per `CLAUDE.md` §1 ("treat a version bump as a project, not a dependency upgrade").

Re-fetch:

```bash
curl -fsSL -o fhir.schema.json https://hl7.org/fhir/R4/fhir.schema.json
sha256sum fhir.schema.json
```
