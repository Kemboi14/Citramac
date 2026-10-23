# Consent Service Process Guide: Get OTP Whitelist Request Workflow
## 1. Overview: Check information of a created OTP Whitelist Request
This guide focuses on the Get OTP Whitelist Request workflow, a key part of the broader Consent Services Process. This workflow is important as it provides a means of retrieving the details of a specific OTP Whitelist Request using unique identifiers or patient information.
### 1.1. What This Workflow Does
The Get OTP Whitelist Request workflow retrieves the details of a specific OTP Whitelist Request. It does this by querying the system using either a unique GUID or a combination of beneficiary and facility identifiers.
### 1.2. Why This Workflow Is Critical (The "Why It Matters")
Retrieving OTP Whitelist Request information is crucial for:
- Checking the status of any pending Whitelist reauests for a particular beneficiary in a specific healthcare facility
- Supporting audit and review processes for consent workflows.
Without accurate retrieval, there is a risk of:
- Complicating follow up and review process of various OTP whitelist requests****
## 2. Workflow Details: Get OTP Whitelist Request
### 2.1. Workflow Description: Step-by-Step System Behavior
When a request to retrieve an OTP Whitelist Request is made, the following steps occur:
- Receive Query: The system receives a query with either a GUID or a combination of beneficiary_cr_id, facility_id, and facility_id_type.
- Validate Input: The system checks that the required parameters are present and correctly formatted.
- Search for Request: The system searches for the OTP Whitelist Request record matching the provided identifiers.
- Return Results: If found, the system returns the details of the OTP Whitelist Request, including status, reason, beneficiary, facility, and attachments. If not found, an error is returned.
### 2.2. Key Validations: Our System's Essential Checks
- GUID Provided:
- What it means: The system checks if a valid GUID is provided in the query.
- Why it's important: Ensures the request is specific and can be uniquely identified.
- Beneficiary and Facility Identifiers:
- What it means: If GUID is not provided, the system checks for beneficiary_cr_id, facility_id, and facility_id_type.
- Why it's important: Ensures the system can locate the correct request using alternate identifiers.
- Parameter Format:
- What it means: All parameters must be correctly formatted (e.g., string type).
- Why it's important: Prevents errors and ensures reliable query processing.
### 2.3. Workflow Data Dictionary (Conceptual): What Information We Work With
 | Field Name (Conceptual) | Description | Data Type (Conceptual) | Required | Purpose / What it Means (to the Business)
 | guid | Unique GUID of the OTP whitelist request. | String | Yes | Used to uniquely identify and retrieve a specific OTP whitelist request.
 | beneficiary_cr_id | Beneficiary CR ID. Required together with facility_id and facility_id_type. | String | No | Used to identify the patient associated with the OTP whitelist request.
 | facility_id | Facility identifier (e.g., FR Code). Required if beneficiary_cr_id is used. | String | No | Identifies the facility where the request was made.
 | facility_id_type | Type of facility identifier (e.g., fr-code). Required if beneficiary_cr_id is used. | String | No | Specifies the type of facility identifier for correct matching.
### 2.4. Expected Outcomes from this Workflow
When you query this workflow, you can expect:
- Success:
- The system returns the OTP whitelist request record, including details such as GUID, beneficiary, facility, reason, status, attachments, and timestamps.
- Failure:
- The system returns an error if the GUID or required parameters are missing or invalid.
- The system returns an error if no matching OTP whitelist request is found.
## 4. Critical Success Factors for Integration
- Provide precise input parameters (GUID or correct combination of beneficiary and facility identifiers).
- Understand the required identifier types and formats.
- Handle errors and missing data gracefully in your integration.
Last modified on September 28, 2026
