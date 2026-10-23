# Understanding Preauthorizations
A Preauthorization (or "Preauth") is a formal request for prior financial approval from the Payer. It allows you to secure a guarantee of payment for specific, high-cost, or restricted medical services before you perform them.
When do I need a Preauth?
You don't need to guess. The Intervention
Coverage check will
explicitly tell you if a specific service requires pre-authorization inside
the intervention JSON structure.
## Anatomy of a Preauthorization
A preauth usually requires strong clinical evidence to justify the need for care. This evidence is reviewed by the payer and they approve or reject it or even approve a portion of the requested amount
The Preauth object is composed of four distinct data blocks:
- The Request (Root): This is the main preauth object. It contains high-level details like the preauthType (e.g., Surgical) and the totalEstimatedAmount.
- Clinical Justification: The preauthDiagnoses is key here as it helps provide the medical indications notices to warrant the need of the specific intervention being requested for. It helps explain why the procedure is necessary.
- Financial Line Items: The preauthItems array lists exactly what you want to bill for (e.g., "Appendectomy procedure - 1 Unit").
- Supporting Evidence: The preauthAttachments array holds files like X-rays or lab reports that prove the medical necessity.
- Attending medics: The preauthDoctors array has information on attending physicians who will administer to the patient and whether or not they have given their approval for the preauth.
## Data Structure Examples
### Preauthorization Payload (Simplified)
This JSON represents a finalized preauth. Notice how the preauthItems contain both the requested amount (unitPrice) and the approved amount (approvedUnitPrice).
Code 
{
  "accessPoint": "string",
  "anaesthesiaType": "string",
  "authorization": 214,
  "authorizationDetails": {
    "authCode": "string",
    "beneficiaryName": "string",
    "beneficiaryNumber": "string",
    "payerName": "string",
    "providerName": "string",
    "status": "string",
    "token": "string",
    "interventions": [
      {
        "code": "string",
        "name": "string",
        "needsPreauth": true,
        "overallTariff": 2996.3338685571907
      }
    ]
  },
  "beneficiaryDetails": {
    "beneficiaryId": 4912,
    "firstName": "string",
    "lastName": "string",
    "schemeName": "string"
  },
  "clinicalIndications": "string",
  "description": "string",
  "finalApprovedAmount": 9880.199954316204,
  "guid": "string",
  "id": 4700,
  "isElective": false,
  "isEmergency": false,
  "isHmisPreauth": true,
  "lengthOfStay": 9051,
  "memberName": "string",
  "payerName": "string",
  "preauthAttachments": [
    {
      "attachmentType": "MEDICAL_REPORT",
      "title": "string",
      "uploadedFile": "string"
    }
  ],
  "preauthDiagnoses": [
    {
      "name": "string",
      "preauthDiagnosisType": "string",
      "status": "string"
    }
  ],
  "preauthDoctors": [
    {
      "name": "string",
      "doctorReviewStatus": "string",
      "isHospitalDoctor": true,
      "status": "string"
    }
  ],
  "preauthItems": [
    {
      "name": "string",
      "quantity": "string",
      "unitPrice": 6606.9827456073035,
      "approvedAmount": 3943.764477869045,
      "status": "string"
    }
  ],
  "preauthType": "string",
  "providerName": "string",
  "serviceStart": "string",
  "serviceEnd": "string",
  "status": "string",
  "totalEstimatedAmountForPreauth": 7128.228861416082,
  "totalInterimApprovedAmountForPreauth": 9719.000418822541
}
Key Field Reference
 | Field | Description
 | guid | Critical. The global unique identifier (UUID) for this preauth.
 | id | Internal ID for the preauth.
 | preauthType | The category of care requested (e.g., Surgical, Medical).
 | status | The current state of the request (e.g., SUBMITTED, FINALISED).
 | finalApprovedAmount | The total amount the Payer has agreed to cover.
 | totalEstimatedAmountForPreauth | The total cost projected by the Provider.
 | totalInterimApprovedAmountForPreauth | Interim approved amount during processing.
 | serviceStart / serviceEnd | ISO timestamps for the proposed medical service window.
 | lengthOfStay | Expected duration of stay for inpatient services.
 | clinicalIndications | Medical reasons justifying the request.
 | description | Additional description of the preauth request.
 | isElective / isEmergency | Indicates if the procedure is elective or an emergency.
 | isHmisPreauth | Indicates if the preauth originated from an HMIS.
 | beneficiaryDetails | Details of the patient (ID, Name, Scheme).
 | memberName | Name of the insured member.
 | payerName | Name of the insurance payer.
 | providerName | Name of the healthcare provider.
 | authorizationDetails | Links to the parent visit, including the consent token and interventions.
 | preauthItems | List of specific services or items requested.
 | preauthItems[].approvedAmount | Amount authorized by the Payer for the item.
 | preauthDiagnoses | Diagnoses associated with the preauth request.
 | preauthDoctors | Doctors involved in the service and their review status.
 | preauthAttachments | Supporting documents (e.g., MEDICAL_REPORT).
 | accessPoint | Point of access for the service.
 | anaesthesiaType | Type of anaesthesia required (if applicable).
Last modified on September 28, 2026
