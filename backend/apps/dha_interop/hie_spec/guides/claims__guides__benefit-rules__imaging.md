# Medical Imaging Rules
Medical Imaging and Other Investigations (SHA-09) is paid on a fixed fee rate and is available from
Level 3 to Level 6. Every intervention in the package requires preauthorisation. The rules that matter to
an integrator are about when an approval is still usable, whose balance it consumes, and who is allowed
to request the study.
## Imaging is standalone at entry but addable during an admission
These two statements are both true and they are not in conflict:
- If SHA-09 is the first intervention on a visit, the combination rules require it to be reported
alone. On a POMSF cover the sheet spells out the remedy: close SHA-09 and start a new visit.
- If an admission is already open, the provider may add imaging to it. The patient then earns the
inpatient per-diem rebate for all days plus the imaging rate.
### The order of the two interventions decides the answer
"Alone" describes what may follow SHA-09 when imaging opens the visit. It does not stop imaging being added
to a visit that inpatient care opened.
If a patient needs imaging during an admission, add it to the existing admission - see
Adding a package during the admission.
If imaging is the reason for the encounter, keep the visit to imaging alone.
## Preauthorisation is mandatory
Every SHA-09 intervention is flagged as requiring preauthorisation, on both SHIF and POMSF covers. There is
no path that bills imaging without an approval first. See
Imaging Preauthorization.
Read the documents each study needs from requiredPreauthDocumentTypes on
Intervention Coverage - see
Required documentation below. They differ per intervention and per scheme, so a
transcribed list is the wrong thing to build against.
## Approved preauths expire in 7 days
An approved imaging preauthorisation expires 7 days after approval if no visit has been created against
it (SHA Medical Imaging access rules).
Understanding why needs one piece of context about how imaging preauths are raised.
Every imaging intervention is elective. The approval is obtained before the visit: you get it first,
then the patient comes in, and the visit is created against the approval that already exists. So
Elective Preauthorizations is the workflow that applies to
the whole package.
Because the approval comes first, it can sit unused. The 7-day clock is what stops it sitting there
indefinitely: measured from the payer's approval, if no visit is created against the preauthorisation within
7 days it expires and can no longer be claimed against.
### Read the flag anyway, do not hard-code the package
Branch your integration logic on needsManualPreauthApproval from
Intervention Coverage rather than on "this is an
SHA-09 code, so it is elective".
Both statements are true today. But the flag is live data and this page is not: if SHA reclassifies an
intervention, code that reads the flag keeps working and code that hard-codes the package silently sends the
wrong preauth. The same applies to needsPreauth and needsDoctorAuthorization.
### Cancel an approval you will not use
If the study is not going to happen inside the window, cancel the preauthorisation rather than leaving it
to expire - see Cancel Preauthorization. Cancelling is
explicit and immediate, where expiry is a background process.
An expired approval cannot be reused or extended. If the patient comes in later, raise a fresh
preauthorisation.
## Balance tracking and quantity limits
- The balance is checked and committed immediately after the preauthorisation is approved, not at claim
time. That is why an approval you will not use should be cancelled rather than abandoned.
- Quantity caps are set per sub-benefit group rather than per intervention. Where a cap is stated it is
commonly 2 per year, and the group-leader interventions carry it for the whole group.
Read the authoritative remaining allowance from
Patient Utilization rather than tracking a counter
yourself. It tells you what has actually been consumed, which is the only reliable answer once several
approvals are in flight.
## Who may request imaging
On a POMSF cover, radiology requests may only be initiated by specialists who are properly credentialed
in the system, per the list published in the benefit matrix (POMSF Medical Imaging rules 1.1). A request
from an uncredentialed practitioner is not a valid imaging request.
The SHA Benefits Matrix states no equivalent credentialing rule for SHIF covers.
## Haemato-oncology imaging is segregated
On a POMSF cover, imaging requests for haemato-oncology cases must be handled separately from other
imaging categories, and must be limited to the haemato-oncology benefits matrix (POMSF Medical Imaging rules
1.2).
This lines up with SHA-06 (Haematology and Oncology Services) being a standalone package in the combination
rules: oncology imaging belongs to the oncology episode, not to a general imaging visit. See
Oncology Preauthorization.
## What the imaging sheet contains
The package is a long catalogue of individual studies. The shape is useful to know; the prices are not
something to hard-code.
 |  | SHIF | POMSF
 | Interventions listed | 80 (SHA-09-001 onward) | 158
 | Facility levels | Level 3 to 6 | Level 3 to 6
 | Payment mechanism | Fixed fee rate | Fixed fee rate
 | Sub-benefit groups | CT scan, CT angiography, MRI, ultrasound, mammography, fluoroscopy, ECG, echocardiography | The same, plus X-ray and EKG groups that exist only under POMSF
The tariff tables are deliberately not reproduced here. They are long, they differ between the two schemes for
the same code, and they are returned per intervention by the API - so a transcribed copy would go stale
silently. Resolve amounts from
Intervention Coverage and, for POMSF,
PMF Tariffs.
## Required documentation
Do not hard-code a document list from this page or from the matrix. Every intervention publishes its own
documentation requirements, and they differ per study and per scheme.
Read them from Intervention Coverage for the
intervention you are billing:
 | You need | Read this field
 | Documents required for the claim | applicableDocumentTypes
 | Documents required for the preauthorisation | requiredPreauthDocumentTypes
See Adding Attachments for those fields in full, the optional
counterparts, and how to attach a document once you know its type.
Figures on this page are the non-tariff limits recorded in the SHA Benefits Matrix (05.06.25) and the SHA
POMSF Benefits & Tariffs Matrix (10.03.2026). Resolve amounts at claim time from
Intervention Coverage.
## Related resources
- Special Benefit Rules - the other five rule sets, and the terms used here.
- Imaging Preauthorization - raising the request.
- Elective Preauthorizations - the pre-visit flow and the 7-day expiry.
- Cancel Preauthorization - releasing an approval that will not be used.
- Preauths Process Overview - how the preauth paths relate.
- Intervention Coverage - preauth flags, tariffs and document requirements.
- Inpatient Benefit Rules - adding imaging to an open admission.
- Intervention Combination Rules - why SHA-09 is reported alone at entry.
- Patient Utilization - reading the remaining balance.
- Adding Attachments - reading required documents off the intervention.
Last modified on September 28, 2026
