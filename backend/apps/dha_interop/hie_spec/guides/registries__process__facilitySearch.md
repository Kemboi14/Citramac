# Facility Search Workflow Guide
## Facility Search Workflow: Finding and Validating Healthcare Facilities
### 1. Overview
This guide focuses on the Facility Search workflow, a core step in the Registries Process. Facility Search helps to provide valid and accurate healthcare facility information using the facility's official identifiers. It provides key information about a healthcare facility such as their registration status with the country's health authority, and also confirms their contracting status with Social Health Authority (SHA) to provide specific services for patients covered by SHA ensuring that every patient encounter is linked to a legitimate, operational facility.
1.1. What This Workflow Does
The Facility Search workflow’s primary function is to retrieve a facility’s official record using its registration details. By providing a facility registration number or other recognized identifier, the system returns comprehensive facility information, which is essential for accurate reporting, billing, and compliance. This workflow ensures that all healthcare interactions are associated with valid, recognized and contracted facilities.
1.2. Why This Workflow Is Critical
Accurate facility identification is vital for:
- Regulatory Compliance: Ensures that only licensed and operational facilities are used for patient care.
- Billing and Claims: Correct facility details are required for claims processing and reimbursement. Also confirms if the facility is contracted with SHA for specific services.
- Patient Safety: Links patient records to legitimate facilities, enhancing care continuity and safety.
- Data Integrity: Prevents errors and duplication in facility records, supporting a clean and reliable dataset.
This workflow is foundational for linking patient and professional interactions to the correct healthcare facility.
### 2. Workflow Details: Facility Search
2.1. Workflow Description
When you request to find a facility, the following internal process occurs:
Input Reception: The system receives the facility’s identification details, such as a registration number or facility registry code.
Facility Registry Query: The system sends a request to the Facility Registry, which acts as the single authoritative source for facility data.
Information Retrieval: If a unique match is found, the registry returns the facility’s essential details (name, location, registration status, contact info, SHA contractual details).
Outcome Delivery: The system provides this data for subsequent processes as required.
2.2. Key Validations: System Checks
To ensure a successful and accurate facility search, the system performs several checks:
At Least One Search Parameter Should Be Provided:
All three search parameters - identifier, identifier-type, and name - are optional, but you should provide at least one so the Facility Registry has something to match against.
Supported Identifier Type:
When an identifier-type is supplied (e.g., registration-number, fr-code), it must be recognized and supported by the Facility Registry.
Identifier value and format:
The identifier value provided must match the expected format for the given identifier type (e.g., alphanumeric, specific length).
2.3. Workflow Data Dictionary
 | Field Name | Description | Data Type | Required | Purpose
 | identifier | The unique number or code assigned to the facility (e.g., registration number or fr-code). | String | No | Used to query the Facility Registry and retrieve the facility's record.
 | identifier-type | The category of identifier being used for the facility (e.g., "registration-number", "fr-code"). | String | No | Tells the system what kind of identifier is being used for the search.
 | name | The name (or part of the name) of the facility to search for. | String | No | Allows searching for a facility by name when an identifier is not available.
2.4. Expected Outcomes from this workflow
- Successful Search: The system finds and retrieves the correct facility’s data from the Facility Registry, enabling further processes.
- Facility Not Found: No facility matches the provided identifier; input may need verification.
- Input Error: Provided identifier type or value is invalid or unsupported.
### 3. Supported Facility Identifier Types
Below are the types of facility identifiers recognized for the Facility Search workflow. Ensure your inputs match the "Identifier Type Value" exactly.
 | Name (Common Use) | Identifier Type Value | Identifier Examples
 | Registration Number | registration-number | FAC12345
 | Facility Registration Code | fr-code | HOSP67890
### 4. Key Success Factors for Facility Registry Integration
- Use Valid Identifiers: Always provide standardized, recognized facility identifiers.
- Keep Records Updated: Ensure facility data is current and synchronized.
- Follow Compliance: Adhere to privacy and regulatory requirements for facility data.
- Design for Interoperability: Integrate facility registry APIs for seamless data exchange.
Last modified on September 28, 2026
