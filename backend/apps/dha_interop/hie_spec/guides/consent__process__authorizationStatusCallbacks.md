# Consent Process Guide: Authorization Status Callbacks
## 1. Overview: Being Told When an Authorisation Is Consumed
An authorisation is created when a patient consents to a visit, by OTP or by biometrics. It then has a life of
its own: it is used by a claim, it may be rejected, and it eventually reaches a terminal state.
Authorisation status callbacks tell you about those transitions as they happen, instead of you polling
Get Authorizations to find out.
The setup, the payload shape, acknowledgement and retry behaviour are identical for all three entity types.
This page covers only what is specific to authorisations. For the mechanics, see the
Status Callbacks integration guide - it is the single source for the
payload contract and the troubleshooting sequence.
### 1.1. What Is Specific to Authorisations
- entity_type is authorization. That value on the endpoint is what makes it an authorisation
integration; the action is status_changed, exactly as for claims and preauths.
- The state vocabulary is the authorisation one, and it does not overlap with claim or preauth states.
- provider_claim_no is never present. An authorisation has no provider claim number.
- consent_token is normally present, which makes these callbacks unusually easy to correlate: the token is
the handle you already hold from the consent step.
### 1.2. Why This Matters
- You learn when your authorisation has been consumed. The move to SUBMITTED_CLAIM tells you a claim has
taken up the authorisation, which is often the signal your billing flow is waiting for.
- You learn about rejections without polling. A rejected authorisation
reaches you as a transition rather than as a surprise on your next read.
- Correlation is free. With consent_token in the payload, you can match the callback to the visit you
started without an extra lookup.
- You learn when a patient should switch to OTP. A rejection carrying authorization_reason: BIOMETRICS_NOT_FOUND_OTP_ALLOWED tells you eCitizen has no usable fingerprints for the patient and OTP is
now allowed. See OTP Fallback When No Usable Fingerprints Are Found.
## 2. Setting It Up
Two calls, the same as any other entity type - register the endpoint, then register the operation on it.
Code 
{
  "name": "Authorization status callbacks",
  "entity_type": "authorization",
  "base_url": "https://his.example.co.ke/hie",
  "auth_type": "none",
  "environment": "sandbox",
  "tenant_code": "his-tenant-code",
  "facility_fr_code": "FID-47-115307-8"
}
Then, using the endpoint_id from the 201 - and putting your facility FR code in the first path segment,
since on that route the value backfills the endpoint's facility_fr_code rather than being resolved as a
tenant:
Code 
{
  "name": "Authorization status changed",
  "action": "status_changed",
  "method": "POST",
  "path": "/callbacks/authorization-status"
}
This endpoint receives only authorisation transitions. Claims and preauths need their own endpoints, each
registered under its own entity_type - a facility holds at most one endpoint per entity type. Registering a
second status_changed operation on this endpoint does not add coverage for another entity.
The field-by-field detail for both calls is in
Register a callback endpoint and
Register a callback operation.
## 3. The Authorisation Payload
Code 
{
  "subject_guid": "4b7d9e10-2c3f-4a5b-9d8e-7f6a5b4c3d2e",
  "from_state": "AUTHORIZED",
  "to_state": "SUBMITTED_CLAIM",
  "facility_fr_code": "FID-47-115307-8",
  "tenant_code": "his-tenant-code",
  "entity_type": "authorization",
  "timestamp": "2026-08-06T13:10:16.828383+00:00",
  "consent_token": "K5HLPJVDNV"
}
### 3.1. Reading the Response
 | Field | Present | What to do with it
 | subject_guid | Always | The authorisation's GUID. Use it as the guid query parameter on Get Authorizations to fetch the full record, and as half of your de-duplication key
 | to_state | Always | The new authorisation state. Interpret it only against the authorisation vocabulary
 | from_state | Always | The previous state. Compare it with what you hold as a consistency check
 | entity_type | Always | authorization. Read it before interpreting to_state
 | timestamp | Always | When the transition happened
 | facility_fr_code | Always | The facility the authorisation belongs to
 | tenant_code | Present | Your tenant code, as published with the event
 | consent_token | When the authorisation carries a token | The easiest correlation key - it is the token you received at consent time
 | notes | When a note was recorded against the target state | Free text; do not parse it for decisions
 | authorization_reason | When the authorisation has a machine-readable reason | Branch on this, not on notes. BIOMETRICS_NOT_FOUND_OTP_ALLOWED on a REJECTED authorisation means switch the patient to OTP
 | provider_claim_no | Never | An authorisation has none. Do not require the field
### 3.2. The Authorisation State Vocabulary
Authorisation states describe the life of the consent, not of a claim. These are the values that can appear in
from_state and to_state:
 | State | What it means
 | PENDING | Consent has been requested but not yet granted
 | AUTHORIZED | Consent granted; the authorisation is available for a claim to use
 | AUTHORIZED_PENDING_VISIT | Authorised ahead of the visit being started
 | AUTHORIZED_MULTISESSION | Authorised for a multi-session course of treatment, from an approved preauth
 | EMERGENCY_AUTHORIZED | Authorised under the emergency path, where the member is not yet identified
 | SUBMITTED_CLAIM | A claim has taken up this authorisation
 | AUTHORIZED_RESUBMISSION | Re-authorised so a corrected claim can be resubmitted
 | RESUBMITTED_CLAIM | A resubmitted claim has taken up the authorisation
 | REJECTED | The authorisation was rejected, for example after a biometric iframe expired. With authorization_reason: BIOMETRICS_NOT_FOUND_OTP_ALLOWED, the patient may consent by OTP instead (OTP Fallback)
 | EXPIRED | The authorisation lapsed before it was used
 | CLOSED | The authorisation is out of play. Not necessarily final - a closed authorisation can move back to AUTHORIZED, REJECTED or SUBMITTED_CLAIM
Only PENDING, AUTHORIZED_PENDING_VISIT and AUTHORIZED count as active. REJECTED, EXPIRED,
CLOSED, SUBMITTED_CLAIM, RESUBMITTED_CLAIM and AUTHORIZED_RESUBMISSION count as inactive;
AUTHORIZED_MULTISESSION and EMERGENCY_AUTHORIZED are in neither list.
Do not treat any of these as a permanently final state. The transition graph is not a straight line: a
CLOSED authorisation can be re-opened, and a SUBMITTED_CLAIM one can move on to
AUTHORIZED_RESUBMISSION when a claim is corrected and resubmitted. Apply each callback as it arrives rather
than closing your local record on the first inactive state you see.
Not every pair of states is a legal transition, so treat from_state as information about where the record
actually was rather than as something to predict.
Do not interpret these values with a claim or preauth state machine. SUBMITTED_CLAIM is an authorisation
state that means "a claim has consumed me" - it is not a claim state and says nothing about whether the
payer has received or approved that claim. For the claim's own progress, register a claim endpoint and read
Understanding Claim Statuses.
### 3.3. A Rejection That Means "Use OTP"
When eCitizen has no usable fingerprints for an adult patient, the rejection carries a reason. This is the
signal to switch the patient to OTP:
Code 
{
  "subject_guid": "4b7d9e10-2c3f-4a5b-9d8e-7f6a5b4c3d2e",
  "from_state": "PENDING",
  "to_state": "REJECTED",
  "facility_fr_code": "FID-47-115307-8",
  "tenant_code": "his-tenant-code",
  "entity_type": "authorization",
  "timestamp": "2026-09-28T06:14:03.512240+00:00",
  "consent_token": "K5HLPJVDNV",
  "notes": "biometrics_not_found: member allowed OTP until 2026-09-29; retry the authorization with OTP.",
  "authorization_reason": "BIOMETRICS_NOT_FOUND_OTP_ALLOWED"
}
The full workflow is in OTP Fallback When No Usable Fingerprints Are Found.
### 3.4. Expected Outcomes
- Return any 2xx to acknowledge. The body is ignored.
- Anything else, including a timeout, is a failed attempt and is retried per the operation's retry_config.
- The same transition can arrive twice. De-duplicate on subject_guid + to_state.
- Ordering is not guaranteed. Use from_state to detect a missed or out-of-order transition and re-read the
authorisation rather than applying the change blindly.
## 4. Critical Success Factors
- Register entity_type: "authorization" exactly - singular and lower case. It is one of exactly three
accepted values, alongside claim and preauth.
- Switch on entity_type before to_state, even if this endpoint only receives authorisations today - one
shared receiving path across entity types is common, and the vocabularies collide.
- Correlate on consent_token where you can, and on subject_guid where you cannot.
- Do not expect provider_claim_no. Requiring it will reject every authorisation callback you receive.
- Set both tenant_code and facility_fr_code at creation, so delivery has a fallback if the tenant code
does not match - and so the operations call has nothing left to backfill.
- Read the configuration back by tenant ID or facility FR code, not by tenant_code, and remember the list
route hides paused records.
## Related resources
- Status Callbacks integration guide - the full payload contract,
idempotency rules and troubleshooting sequence.
- Status Callbacks Process Overview - the two-step
setup and the three entity types.
- Get Authorizations - fetching the full record with subject_guid
or consent_token.
- Reject Authorization - the workflow behind a REJECTED
transition.
- Biometrics Consent - how an authorisation is created.
- OTP Fallback When No Usable Fingerprints Are Found -
what to do when a rejection carries BIOMETRICS_NOT_FOUND_OTP_ALLOWED.
- Status Callbacks API reference - the registration operations.
Last modified on September 28, 2026
