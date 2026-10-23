# Introduction to the Shared Health Record
The Shared Health Record (SHR) is the national clinical record. It holds the encounters,
observations, conditions, medications and other FHIR resources a patient accumulates across every
facility they visit, so a clinician at one facility can see what happened at another.
Two things make the SHR different from the other HIE services you integrate with:
- Everything is FHIR. You write clinical data as a FHIR Bundle and you read it back as a FHIR
search result. The middleware passes both through to the Digital Health Agency (DHA) platform
largely unchanged.
- Nothing happens without patient consent. The patient must consent before their record can be
read, and that consent is bound to a single visit. Consent produces a consent token that you
send on every read.
## 1. The lifecycle at a glance
Working with the SHR is a four-stage lifecycle: consent, visit, write, read.
### Stage 1: Request consent
Check for an open visit first. Call
GET /shr/open-visits with the
patient's CR ID (patient_id) and your facility's FR code (facility_id). If it returns a visit, the
patient already consented at your facility and that consent is still open - carry on with that
visit_id and
refresh its token rather
than sending the patient through another OTP. An empty visits array means you need fresh consent.
The response carries visit ids only. Anything else you need about the visit comes from the consent
status or refresh calls.
Call POST /shr/consents
with the facility's FR code, the patient's Client Registry (CR) ID, the visit type (OP or IP) and
who is asking. DHA sends the patient an OTP and returns a consent_id plus an otp_record.
If the patient never receives the OTP, call
POST /shr/consents/{consent_id}/resend-otp.
It returns a new otp_record - verify with that one, not the original.
You can poll
GET /shr/consents/{consent_id}/status
at any point to see where the request stands.
When the patient cannot consent themselves
Two variants of the same call cover the patients who cannot answer an OTP.
Emergency. For a patient who is incapacitated at the point of care, send emergency as 1 with an
incapacity_reason. The consent is approved on the spot: no OTP is sent, and the response carries the
visit_id and consent_token directly, so you can skip Stage 2 entirely and read records immediately.
Dependant. For a minor, or an adult who cannot consent for themselves, keep cr_id as the patient
and add representative_cr_id with the representative's CR ID plus representative_relationship
(Healthcare Proxy, Sibling, Principal or Other). The consent request and its OTP are routed to
the representative, who becomes the record's principal. For an incapacitated adult also send
patient_capable as 0 and an incapacity_reason; a minor needs neither.
### Stage 2: Verify consent and open the visit
Call
POST /shr/consents/{consent_id}/verify
with the otp_record and the OTP the patient read out. On success you get back two values that drive
everything else:
 | Value | What it is for
 | consent_token | Sent in the X-Consent-Token header on every read of patient records.
 | visit_id | Identifies the visit the consent opened. Used to refresh consent and to close the visit.
### The consent token is per visit
A consent token is scoped to one visit for one patient. Do not cache it across visits or reuse it for
another patient - request fresh consent instead.
Record a refusal, do not just drop it. A patient who declines is recorded through the same call:
send consent_decision as Reject with a rejection_reason. No token is issued and the consent
settles as rejected, which is what leaves an auditable trail. Abandoning the request instead leaves it
sitting as Pending.
### Stage 3: Write clinical data
Call POST /shr/bundles with a FHIR
collection Bundle. Two referencing rules matter:
- the Encounter must reference the visit's EpisodeOfCare, and
- every clinical resource in the bundle must reference that Encounter.
The middleware only checks that the body is a Bundle (resourceType is Bundle); everything else is
validated upstream by DHA, so a structurally valid bundle can still be rejected on its contents.
### Stage 4: Read patient records
Call
GET /shr/patient-records with
the patient's cr_id, the requesting practitioner_id, the resources you want (comma separated)
and the X-Consent-Token header. Page through large result sets with page_token.
Narrower, FHIR-conformant reads
Where patient-records returns whole resource types, two endpoints answer a specific question with a
FHIR searchset bundle and a stable pagination token:
- GET /shr/Observation reads one
patient's observations. It is consent-scoped like patient-records, so send X-Consent-Token, and
it additionally identifies the clinician through an X-PUID header.
- GET /shr/ServiceRequest reads referrals.
Filter by performer:Organization for referrals addressed to your facility, or by
requester:Organization for the ones you raised. This is a query over referrals directed at an
organisation rather than a read of one patient's record, so it takes no consent token.
Security labels
Every resource carries a security label saying how guarded it is. Fetch the whole catalogue once with
GET /shr/security-labels -
N and R for confidentiality, plus the sensitivity codes such as HIV, PSY and SUD - and use
GET /shr/resource-labels to find
which label applies to a particular resource type or code. Read them before you interpret a response,
and before you decide what labels to attach to a bundle you are writing.
### Closing out
When the encounter is over, call
POST /shr/visits/{visit_id}/close. If the
visit is still open but the token has expired, call
POST /shr/visits/{visit_id}/refresh
to get a fresh one.
Closing is usually a two-step. The close call normally dispatches a one-time password to whoever
gave consent and returns an otp_record; the visit stays open until you send that otp_record and the
password to
POST /shr/consents/{consent_id}/verify,
which responds with the end_date. Read the close response rather than assuming: if it comes back with
an end_date instead of an otp_record, the visit is already closed - which is what happens where
OTP-gated closure is switched off, or where consent came from a healthcare proxy.
For a patient who cannot consent to the closure - unconscious, or deceased - send the optional body
with patient_incapable as 1 and an incapacity_reason. The visit closes immediately, with no
password sent or required.
### Close the visit when you are done
Once a visit is closed its consent token can no longer be refreshed. Leaving visits open indefinitely
keeps a consent live for longer than the encounter justifies, so close it as part of your discharge or
visit-end routine.
## 2. Endpoint summary
 | Endpoint | Purpose
 | GET /shr/open-visits | List the visits at your facility that still hold an open consent for a patient.
 | POST /shr/consents | Start a consent request - standard, emergency or dependant. Returns consent_id and otp_record.
 | POST /shr/consents/{consent_id}/verify | Record the decision. Approving returns consent_token and visit_id; also completes an OTP-gated closure.
 | GET /shr/consents/{consent_id}/status | Poll the state of a consent request.
 | POST /shr/consents/{consent_id}/resend-otp | Resend the OTP. Returns a new otp_record.
 | POST /shr/visits/{visit_id}/refresh | Refresh the consent token for an open visit.
 | POST /shr/visits/{visit_id}/close | Close the visit, or dispatch the closure OTP.
 | POST /shr/bundles | Write a FHIR collection Bundle to the record.
 | GET /shr/patient-records | Read a patient's records against a consent token.
 | GET /shr/Observation | Query one patient's observations as a FHIR searchset bundle.
 | GET /shr/ServiceRequest | Query referrals raised by, or addressed to, a facility.
 | GET /shr/resource-labels | Look up the security labels for a resource type or code.
 | GET /shr/security-labels | Fetch the full security label catalogue.
## 3. Before you start
- Get the patient's CR ID first. Consent is requested against a Client Registry identifier, not a
national ID. Resolve it through
Patient Search if you do not already hold it.
- Know your practitioner ID. Reads are attributed to a practitioner from the Health Worker
Registry, and the practitioner_id is mandatory on every records fetch.
- Standardise your codes. Clinical content you write should be bound to the code systems the
Terminology Service publishes, so other facilities
can read what you wrote.
## 4. Related resources
- Shared Health Record API reference
- Introduction to the Terminology Service
- Patient Search
Last modified on September 28, 2026
