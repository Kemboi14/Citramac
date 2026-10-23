# Provenance: `ke.fhir.core-1.0.0.tgz`

- **Source:** <https://fhir.dha.go.ke/ig/package.tgz> (the "Kenya Core Implementation Guide",
  published by the Digital Health Agency (DHA), Kenya)
- **Package:** `ke.fhir.core` version `1.0.0`, canonical `https://fhir.dha.go.ke/core`,
  `fhirVersions: ["4.0.1"]`, build date 2026-10-02
- **Dependencies declared:** `hl7.fhir.r4.core 4.0.1`, `hl7.terminology.r4 7.4.0`,
  `hl7.fhir.uv.extensions.r4 5.3.0`, `hl7.fhir.uv.ips 1.1.0`
- **Fetched:** 2026-10-23
- **SHA-256:** `59a7d93f5b7691e31d27d8af62ba029fff40083e4b5c1e518ae7c76d630dedd9`

Vendored verbatim (not unpacked, not edited). `fhir_validation.kenya_core` reads the
StructureDefinitions, ValueSets and CodeSystems straight out of the archive, so the profile
URLs, identifier `system` URIs and code lists the Shared Health Record exporter uses cite this
file rather than memory (CLAUDE.md §6).

This is the regulator-supplied national IG that CLAUDE.md §8 names as binding. It is FHIR
R4 4.0.1, consistent with §1. Note: DHA's public HAPI server at `fhir.dha.go.ke/fhir`
reports FHIR 4.3.0 (R4B) in its CapabilityStatement; that server is not what this package
targets, and nothing here talks to it.

The package profiles the resources the SHR accepts except `Medication`,
`MedicationRequest`, `MedicationDispense`, `MedicationAdministration` and `Immunization`,
which are therefore sent against base R4.

Re-fetch only as a deliberate, reviewed version change (CLAUDE.md §1):

```bash
curl -fsSL -o ke.fhir.core-<version>.tgz https://fhir.dha.go.ke/ig/package.tgz
sha256sum ke.fhir.core-<version>.tgz
```
