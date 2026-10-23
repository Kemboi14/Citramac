# Consent Process Guide: OTP Fallback When No Usable Fingerprints Are Found
## 1. Overview
Adult patients consent with their fingerprint. The capture iframe sends the print to eCitizen (eKYC), which
matches it against the fingerprints the national registry holds for the patient. See
Biometrics Consent.
Some patients have fingerprints on record that eCitizen cannot use for matching yet. For these patients a
fingerprint match can never succeed, however many times they try.
The HIE handles this case for you. When eCitizen reports that it has no usable fingerprints for an adult
patient, the HIE:
- Rejects the biometrics authorization.
- Allows the patient to consent by OTP for a short time, even at a facility that enforces biometrics.
- Tells you why, with the reason BIOMETRICS_NOT_FOUND_OTP_ALLOWED, so your system can switch the operator
to OTP.
You do not request anything. Your only job is to recognise the reason and move to the OTP path.
### 1.1. When It Applies
All three must be true:
 | Condition | Detail
 | The authorization was created through the HIE | POST /api/v1/claims/authorize with the biometrics fields
 | eCitizen found no usable fingerprints for the patient | The fingerprints could not be used at all - this is different from a capture that did not match
 | The patient is 18 or older | Worked out from the date of birth on the patient's record
It does not apply, and the authorization is rejected without the reason, when:
- The fingerprint was captured but did not match. Retry the capture as usual.
- The capture expired or was cancelled before eCitizen gave a result.
- The patient is under 18. Minors consent through Minors Biometrics Consent.
- The patient has no date of birth on record.
## 2. The Workflow, Step by Step
- Start biometrics consent as usual. Call POST /api/v1/claims/authorize with the biometrics fields and
render the iframe. The authorization is PENDING.
- The patient places a finger. eCitizen reports that it has no usable fingerprints for them.
- The HIE rejects the authorization and allows OTP. The authorization moves to REJECTED with the reason
BIOMETRICS_NOT_FOUND_OTP_ALLOWED, and the patient may now consent by OTP.
- You find out. Your authorization status callback
receives the rejection with the reason. If you do not use callbacks, read it with
Get Authorizations. Section 3 shows both.
- Tell the operator to use OTP. For example: "This patient's fingerprints cannot be verified yet. Use OTP
to continue."
- Complete consent with OTP. Send the OTP, then start the visit on the
OTP path. The facility's biometrics requirement
does not block it while the allowance lasts.
### Do not retry biometrics for this patient
A new biometrics authorization will fail in exactly the same way. Go straight to OTP.
## 3. How You Find Out
### 3.1. Status Callback (Recommended)
If you have registered an authorization status callback,
the rejection is posted to you as soon as it happens:
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
### 3.2. Get Authorizations
If you poll instead, GET /api/v1/claims/authorizations?guid={subject_guid} returns the same reason on the
authorization record:
Code 
[
  {
    "guid": "4b7d9e10-2c3f-4a5b-9d8e-7f6a5b4c3d2e",
    "token": "K5HLPJVDNV",
    "status": "REJECTED",
    "authorizationReason": "BIOMETRICS_NOT_FOUND_OTP_ALLOWED"
  }
]
The record carries more fields than shown here.
### Same value, two spellings
The callback spells the field authorization_reason. The Get Authorizations response spells it
authorizationReason. The value is the same.
### 3.3. The Check in Your Code
Switch to OTP when all three hold:
Code 
const switchToOtp =
  event.entity_type === "authorization" &&
  event.to_state === "REJECTED" &&
  event.authorization_reason === "BIOMETRICS_NOT_FOUND_OTP_ALLOWED";
### Decide on the reason, never on the notes
notes is text for people. Show it to the operator if you like, but do not parse it: its wording can change.
authorization_reason is the stable value to branch on.
## 4. How Long OTP Is Allowed
- Until the end of the next day. The last allowed day is in the callback notes, for example
allowed OTP until 2026-09-29. OTP stays available until 23:59 UTC on that day, which is about 3:00 am East
Africa Time the following morning. Depending on the time of the rejection, that gives the patient between
24 and 48 hours.
- After that, the patient is back on biometrics. If eCitizen still cannot use their fingerprints, the next
biometrics attempt triggers this flow again.
- A longer allowance is never shortened. If the patient already had OTP access for longer, for example from
an approved OTP Whitelist Request, it is kept as it is and
the note shows that later date.
- For longer-term OTP access, submit an OTP Whitelist Request.
While the allowance lasts, an eligibility check for the
patient returns whitelistedForOTP: true.
## 5. Troubleshooting
 | What you see | What it means | What to do
 | REJECTED with no reason | A normal biometrics failure (no match, expired, cancelled), or the patient is under 18 | Follow the Biometrics Consent troubleshooting
 | OTP visit refused as "restricted to biometric visits" | The allowance has ended, or the rejection did not carry the reason | Check authorizationReason on the rejected authorization. If the allowance ended, try biometrics once more
 | No callback arrived | Callbacks are not set up for authorizations, or delivery is still being retried | Read the authorization with Get Authorizations, then check your callback setup
## 6. Critical Success Factors
- Register an authorization status callback so the operator is told to switch to OTP straight away.
- Branch on authorization_reason, together with entity_type and to_state. Never parse notes.
- Switch the operator to OTP immediately. Do not start another biometrics attempt for this patient.
- Treat a rejection without the reason as a normal biometrics failure. Nothing about that path has changed.
## 7. Related Resources
- Biometrics Consent - the biometrics authorization flow.
- Send OTP - sending the OTP to the patient.
- Start Visit Workflow - starting the visit on the OTP path.
- Authorization Status Callbacks - receiving the rejection.
- Get Authorizations - reading the reason by polling.
- OTP Whitelist Request - longer-term OTP access.
Last modified on September 28, 2026
