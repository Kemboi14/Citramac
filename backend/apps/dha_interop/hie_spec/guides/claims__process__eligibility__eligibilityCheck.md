# Eligibility Check Workflow Guide
## Eligibility Process: Eligibility Check Workflow
### 1. Overview: Patient Eligibility Check
This guide provides information on the Eligibility Check Workflow, a core workflow within the Eligibility Process. It helps to provide a one-stop solution to immediately determining a patient's current healthcare coverage status and entitlements under the Social Health Authority (SHA).
This workflow combines essential identity verification and coverage status checks to provide information on whether a specific patient is currently covered by SHA on what services and the coverage validity period. It returns a clear status of their coverage and the fundamental details of their entitlement.
1.1. What This Workflow Does
The Eligibility Check Workflow performs two critical functions:
- Patient Identification: Accurately identifies the patient using their provided identifier (e.g., National ID) against the central Client Registry.
- Coverage Status Verification: Immediately verifies the patient's coverage status under SHA and validity period for this coverage.
The primary outcome is the patient's SHA coverage status and key details of their enrollment and coverage. This is the simplest, fastest way to confirm a patient's eligibility to receive services.
1.2. Why This Workflow Is Critical
- Instant Verification: Provides an instant way to check a patient's coverage status in one place.
- Billing Assurance: Offers a preliminary confirmation of SHA coverage, reducing financial risk for healthcare providers.
- Service Triage: Enables providers to quickly determine the appropriate funding scheme for a patient (e.g., UHC, PMF) and any subsequent services they can access.
### 2. Workflow Details: Eligibility Check
2.1. Workflow Description
This workflow is simpler and more direct than the full multi-step eligibility process, focusing only on identification and key contribution standing information with SHA.
- Input Reception: The system receives the patient's identification details as query parameters: the identification_type (e.g. National ID) and the identification_number value.
- Patient Search & Validation: The system queries the Client Registry to verify the existence and identity of the patient, converting the input identifier into a verified Client Registry ID (CR ID).
- Coverage Status Check: The system checks the patient's CR ID and gets the SHA coverage to determine their active coverage status.
- Outcome Delivery: The system returns the official SHA coverage status and related entitlement details.
2.2. Key Validations: System Checks
 | Validation Check | Description | Why It Matters
 | Valid Identification Type: | The identification_type (e.g., National ID, Birth Certificate) must be a supported type recognized by the Client Registry. Refer to the types from Patient Search docs | Ensures the system attempts to search using a known, queryable format.
 | Valid Identification Number: | The identification_number must be present and correctly formatted (e.g., a specific length or alphanumeric pattern). | Critical for accurately locating the patient in the Client Registry.
 | Patient Must Be Found: | The system must successfully match the provided ID to an active patient profile in the Client Registry to retrieve the CR ID. | Without a verified identity (CR ID), no coverage check can be performed.
### Use the CR ID by default
For SHA eligibility, supply ClientRegistry ID as the identification_type whenever you already hold
the patient's Client Registry ID. The CR ID is the identifier SHA works in, and every other type is
resolved to it before the coverage check runs, so passing it directly skips a lookup and removes a
class of matching failures. The other types are fallbacks for when a CR ID is not yet known - resolve
one through Patient Search and use it from then on.
2.3. Workflow Data Dictionary
Both fields are supplied as query parameters.
 | Field Name | Description | Data Type | Required | Purpose
 | identification_type | The type of identifier being used. Full list: National ID, ClientRegistry ID, Birth Notification, Birth Certificate, Alien ID, Refugee ID, Mandate Number. | String | Yes | Tells the system which index to search for the patient. Prefer ClientRegistry ID - see the callout above.
 | identification_number | The specific value of the patient's identifier (e.g., "12345678"). | String | Yes | The actual search query to locate the patient.
2.4. Key Response Fields
Alongside the patient's core details (fullName, dateOfBirth, gender, age, memberCrNumber) and their covered schemes, the response returns these flags that your integration should act on:
 | Field Name | Description | Data Type | Purpose
 | isAlive | Indicates whether the patient is alive (true) or recorded as deceased (false). | Boolean | Lets the facility handle deceased-patient cases appropriately before proceeding.
 | whitelistedForOTP | Indicates whether the patient is permitted to use OTP-based consent. | Boolean | Determines whether the OTP consent path is available for this patient.
 | facilityBiometricsEnforced | Indicates whether the facility is required to use biometrics for consent. | Boolean | When true, the facility must use the biometrics consent path rather than OTP.
2.5. Expected Outcomes
 | Outcome | Description
 | Eligible / Active Coverage: | The patient is successfully identified and their contribution status is confirmed as active and compliant with SHA. Coverage details are returned.
 | Ineligible / Not Active: | The patient is identified, but their contribution status is not compliant, or their coverage has lapsed.
 | Patient Not Found: | The provided identification_type and identification_number did not match any entry in the Client Registry.
 | Input Error: | Missing or invalid required fields (e.g., missing identification_number or invalid identification_type).
2.6. Detecting a POMSF beneficiary
To tell whether a beneficiary is POMSF-eligible, read schemeName on the schemes returned by the
eligibility check. The applicable scheme names are POMSF, TSC and USALAMA.
POMSF has suffixed variants - for example POMSF-047, POMSF-SHA - so match POMSF as a prefix,
never as an exact string equality. An equality check silently misses every suffixed member.
Detecting POMSF is the precondition for two things: reading
POMSF balances, and choosing which of a household's
covers to bill through Set Coverage.
### 3. Critical Success Factors for Integration
- Accurate ID Input: Ensure user-provided ID types and values are validated on your end before being passed to this API. Junk data in means failure out.
- Handle All Outcomes: Design your user interface to clearly distinguish between "Patient Not Found" (identity issue) and "Ineligible" (financial/status issue), as they require different responses from the facility staff.
- Audit Compliance: Always ensure that the Facility Identifier and Facility Identifier Type are correctly passed for every request, as this ensures all checks are properly audited for security and compliance.
Last modified on September 28, 2026
