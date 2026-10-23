# The Deceased Patient Workflow
Handling a deceased patient correctly protects both the payer and the provider. There are two situations
to plan for: a patient who is already deceased when you check eligibility, and a patient who dies
during a visit that is already under way. This guide covers how to detect each case and what an
integrator must do.
## Detecting a deceased patient
Eligibility is the gate. The eligibility response carries an isAlive flag:
- isAlive: true - proceed as normal.
- isAlive: false - the patient is recorded as deceased (a deceased_datetime may also be present).
### Block all transactions for a deceased patient
When isAlive is false, integrators must block all subsequent transactions for that patient - do
not start a visit, create a claim, or raise a preauthorization. The only exception is completing a claim
for an encounter that was already in progress when the patient died (see below).
## Patient who dies during a visit
If a patient dies while an encounter is already in progress, you still need to close out the claim for the
care that was delivered. Do this through inpatient discharge:
- Discharge the patient with discharge_reason = DECEASED.
- Attach the death certificate to the claim so the payer can verify the outcome. Use the deceased-patient
claim attachment types, for example DEATH_NOTICE (and, where required, CERTIFIED_COPY_OF_DECEASED_ID
or CERTIFIED_BURIAL_PERMIT). See Adding Attachments.
### DECEASED is an inpatient discharge reason
DECEASED is available as an inpatient discharge reason. The outpatient discharge reasons are
RECOVERED, REFERRED, ABSCONDED and OTHER.
## Related resources
- Eligibility Check - where isAlive is returned.
- Inpatient Claim Dispatch - the deceased discharge path.
- Adding Attachments - attaching the death certificate.
Last modified on September 28, 2026
