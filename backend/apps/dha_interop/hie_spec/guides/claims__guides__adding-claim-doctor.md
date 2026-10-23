# Adding a Claim Doctor
Every claim you submit must identify the attending practitioner (the doctor) who delivered or supervised
the care. The HIE will not let a claim be dispatched without doctor details, so attaching the doctor is a
required part of building any standard outpatient or inpatient claim.
This guide explains what the doctor fields are, the single rule that governs them (one doctor, added
once), and the three endpoints through which you can attach that doctor.
## The doctor fields
The doctor is described by three fields that are always supplied together:
 | Field | Required together | Description
 | practitioner_identification_type | Yes | How the practitioner is identified. One of registration_number, National ID, Alien ID, Refugee ID.
 | practitioner_identification_number | Yes | The identifier value itself, e.g. the practitioner's registration number.
 | practitioner_regulation_body | Yes | The regulator the practitioner is registered with. One of KMPDC, COC, NCK, PPB.
Code 
{
  "practitioner_identification_type": "registration_number",
  "practitioner_identification_number": "A00000",
  "practitioner_regulation_body": "KMPDC"
}
### Example values are dummy data
The identification number above (A00000) is placeholder data. Supply the real registration number of
the attending practitioner.
## One doctor, added once
A standard claim carries exactly one doctor. You do not need to add the doctor on every step,
and you should not repeat the fields across steps. Supply the three fields once, on whichever step is
most convenient for your integration, and the doctor is attached to the claim from that point on.
### Pick one entry point
The doctor fields are optional on each individual endpoint precisely because you only need to provide
them through one of the three below. Choose the step that best fits your workflow and include the fields
there.
## Where you can attach the doctor
The same three fields are accepted on each of these endpoints:
 | Step | Endpoint | When to use it
 | Start visit | Start Visit | Attach the doctor at the very start, when you create the visit.
 | Add diagnosis | Add Diagnosis | Attach the doctor while recording the diagnosis.
 | Add billable line | Add New Line | Attach the doctor while adding the first billable line.
Include the fields on one of these calls. If you supply them on more than one, the last one wins, but
there is no benefit to repeating them.
## Emergency and preauth doctors are different
This guide covers the doctor on a standard claim. Two related flows use their own dedicated
endpoints and field names, and are documented separately:
- Emergency claims attach and manage doctors through the dedicated
Add a Doctor to an Emergency Claim and
Remove a Doctor from an Emergency Claim endpoints.
- Preauthorizations route doctor approval through the
Preauth Doctor Consent flow.
## Related resources
- Add New Line
- Add Diagnosis
- Inpatient Claim Dispatch - doctor details are validated before dispatch.
- Outpatient Claim Dispatch - doctor details are validated before submission.
Last modified on September 28, 2026
