# Provenance: DHA Health Information Exchange (HIE) API specification

Every endpoint path, query parameter, request field and enum value used by
`apps/dha_interop/hie_api.py` and the services built on it is taken from the files
in this directory — not from memory and not from third-party SDKs (CLAUDE.md §6).

- **Publisher:** Digital Health Agency (DHA), Kenya — "Health Information Exchange"
  developer documentation, <https://hie-docs.dha.go.ke>
- **Fetched:** 2026-10-23
- **Server URL in every spec:** `https://ilm-dev.dha.go.ke/uat-middleware/api/v1` (UAT).
  The production base URL is not published; DHA issues it at onboarding. It is
  configuration (`PlatformHieSettings.base_url` / `HIE_API_BASE_URL`), never a constant.

## `openapi/` — the six OpenAPI 3.1.1 specifications

The docs site (Zudoku) bundles each spec as a JavaScript module
(`/assets/<name>.json-<hash>.js`). Each module was evaluated in an isolated Node `vm`
context (no `require`, no I/O) and re-serialised as JSON with shared component objects
restored as `$ref`s; content is otherwise unchanged. Keys are sorted for stable diffs.

| File | Spec title | SHA-256 |
|---|---|---|
| `auth.openapi.json` | Authentication and Authorization 1.0.0 | `10d3588a29eed055784fe8328ed8f5fe96730ece104cc0c1cd466dfa2a7f8bae` |
| `registries.openapi.json` | HIE Registries 1.0.0 | `4b9afee7232f863df05b8a26207a517a9d170d67cab4e1b6360026a81fc0cbc1` |
| `eclaims.openapi.json` | eClaims and Preauth APIs 1.0.0 | `78856f9cdda7d6a3325b6a3e1976e9131d8dced4a2b8542b7e1d2e1f32d9a70a` |
| `consent.openapi.json` | Consent Services APIs 1.0.0 | `8ea802ca805f25ecdfe2830605aa7776b39ef0c09bb4d80aeb6e9ad80ba370eb` |
| `sharedhealthrecord.openapi.json` | SHR Service APIs 1.0.0 | `5a3d0b48ec70533e6b687a5f1dd908214fbb3ea16eabb0f8919f9cba9d0c35ca` |
| `terminology_service.openapi.json` | Terminology Service APIs 1.0.0 | `86feb2d3bf8506db03655c673403fefaba1881314c5551b1a40728718c241fad` |

## `guides/` — the process guides, as text

The 131 server-rendered documentation pages under `/docs/…` (plus `/changelog` and
`/introduction`), converted from HTML to plain text with navigation chrome removed.
File names are the page path with `/` replaced by `__`, e.g.
`claims__guides__status-callbacks.md` is `/docs/claims/guides/status-callbacks`.
Last-modified dates printed on the pages are 2026-09-28 or earlier.

## Gaps in the published documentation (open `VERIFY:` items)

These are absent from both the specs and the guides. The code does not fill them in.

1. **Production base URL** — issued by DHA at onboarding.
2. **Remittance endpoints** — `claims/process/remittances/*` documents the inputs
   (`facility_id`, `facility_id_type`, `bank_reference`) but no request path and no response
   fields. The paths are configuration (`PlatformHieSettings.remittance_path`,
   `remittance_claims_path`); statements are stored raw and are not auto-matched to claims.
3. **Eligibility coverage status vocabulary** — `schemes[].coverage.status` has no
   published enum. Which values mean "active" is configuration
   (`settings.SHA_ACTIVE_COVERAGE_STATUSES`), empty until confirmed against UAT.
4. **Practitioner Unique Identifier (PUID)** — required by `/shr/consents` and the SHR
   reads; which Health Worker Registry field carries it is not stated. It is recorded per
   practitioner from the registry response by a person, never derived.
5. **Callback authentication** — `auth_type` values other than `none` need a `secret_ref`
   arranged with DHA in advance; this build registers `auth_type: none` behind an
   unguessable path, which `claims/guides/status-callbacks` names as the supported setup.

## Re-fetch

Re-fetch only as a deliberate, reviewed change (CLAUDE.md §1). The extraction script used is
reproduced in the commit that added this directory; compare hashes before replacing files.
