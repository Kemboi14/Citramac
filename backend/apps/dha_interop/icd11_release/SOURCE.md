# Provenance: WHO ICD-11 MMS release file

Every ICD-11 code the system offers or accepts for a diagnosis comes from this file. None is
typed in or recalled from memory (guide.md §6).

- **Publisher:** World Health Organization, ICD-11 for Mortality and Morbidity Statistics
  (MMS), simple tabulation, English.
- **Release:** `2026-01`. The file's own header reads `Version:2026 Jan 17 - 05:30 UTC`.
- **Downloaded:** 2026-11-10 from
  `https://icdcdn.who.int/static/releasefiles/2026-01/SimpleTabulation-ICD-11-MMS-en.zip`.
  On that day, `…/2027-01/…` returned 404, so 2026-01 was the latest release.
- **File:** `SimpleTabulation-ICD-11-MMS-en-2026-01.zip`, vendored unchanged. Only the name
  was changed, to add the release.
- **SHA-256:** `f1356588f40953a83e3af2b662deab47c5e269f944d1ea4ed0cfeb2007c7cd39`.
  `icd11_import.VENDORED_SHA256` checks it on every import.
- **Contents:** 35,664 coded categories (31,179 leaves) in 28 chapters.
- **Licence:** WHO licenses ICD-11 under Creative Commons Attribution-NoDerivs 3.0 IGO
  (CC BY-ND 3.0 IGO). See the ICD-API licence page, `https://icd.who.int/docs/icd-api/license/`.
  The file is redistributed here unmodified, with attribution to WHO.
- **FHIR system:** `http://id.who.int/icd/release/11/mms`, the Kenya Core
  `Condition.code` binding (`shr.ICD11_SYSTEM`).

## How it is loaded

`dha_interop` migration 0009 loads this file on deploy. `manage.py import_icd11 <zip>
--release <id> --sha256 <hash>` loads a later WHO release. Every import records a
`TerminologySyncRun` with the release and the hash.

- **New diagnoses** accept only a code from the loaded release that has not been retired
  since. It must also come from chapters 01–25. Chapter V (functioning), chapter 26
  (traditional medicine) and chapter X (extension codes) are supplementary, and their codes
  are never recorded on their own (`icd11_import.DIAGNOSIS_CHAPTERS`).
- **Each diagnosis keeps the display text it was recorded with** (`icd11_display`) and the
  release it was chosen from. A later release that retitles a code does not change a signed
  diagnosis.

## The old stub list (dha_interop 0002)

Before this file, a 16-code "illustrative stub" was seeded from memory. Checked against this
release, five of its codes meant something other than the title they were shown with:

| Code | Stub title | WHO 2026-01 title |
|---|---|---|
| 6C4B | Disorders due to use of other specified psychoactive substances | Disorders due to use of volatile inhalants |
| 6C45 | Disorders due to use of sedatives, hypnotics or anxiolytics | Disorders due to use of cocaine |
| 6A25 | Schizophrenia | Symptomatic manifestations of primary psychotic disorders |
| 6D10 | Disorders of intellectual development | Personality disorder |
| QA02 | Problems associated with education and literacy | Medical observation or evaluation for suspected diseases or conditions, ruled out |

Loading the release replaced those titles with WHO's. Each diagnosis already recorded under one
of these codes was flagged (`DiagnosisCode.code_review_reason`) instead of being changed. A
flagged diagnosis still shows what the clinician recorded, marked "ICD-11 code under review".
Its code is not shown, sent to the SHR, billed to SHA or emitted as a FHIR coding. A clinician
corrects it by marking it entered in error and recording the right code.
