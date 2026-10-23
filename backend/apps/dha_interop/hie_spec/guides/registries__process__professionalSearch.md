# Professional Search Workflow Guide
## Professional Search Workflow: Finding and Validating Healthcare Professionals
### 1. Overview
This guide focuses on the Professional Search workflow, a key step in the Registries Process. Professional Search helps providers get and validate healthcare professionals information using official identifiers, ensuring that every patient encounter is linked to a legitimate, licensed professional. It provides information on the healthcare professional including their demographics, specialties, and most importantly their licensing status.
1.1. What This Workflow Does
The Professional Search workflow’s primary function is to retrieve a professional’s official record using their identification details. By providing a registration number, license number, or other recognized identifier, the system returns comprehensive professional information like demographics, specialties, and licensing status, which is essential for compliance, care quality, and reporting.
1.2. Why This Workflow Is Critical
Accurate professional identification is vital for:
- Regulatory Compliance: Ensures that only licensed and authorized professionals are involved in patient care.
- Billing and Claims: Correct professional details are required for claims processing and reimbursement.
- Care Quality: Links patient encounters to verified professionals, supporting accountability and safety.
- Data Integrity: Prevents errors and duplication in professional records, supporting a clean and reliable dataset.
This workflow is foundational for linking patient and facility interactions to the correct healthcare professional.
### 2. Workflow Details: Professional Search
2.1. Workflow Description
When you request to find a professional, the following internal process occurs:
Input Reception: The system receives the professional’s identification details, such as registration number, license number, or other supported identifier.
Health Worker Registry Query: The system sends a request to the Health Worker Registry, which acts as the authoritative source for professional data.
Information Retrieval: If a unique match is found, the registry returns the professional’s essential details (name, credentials, license status, contact info).
Outcome Delivery: The system provides the data which can then be used for subsequent processes.
2.2. Key Validations: System Checks
To ensure a successful and accurate professional search, the system performs several checks:
Valid Identifier Must Be Provided:
The identifier (e.g., registration number, license number) must be recognized and supported by the Health Worker Registry.
Required Fields:
Both identification_number and identification_type (e.g., registration_number) must be provided for a precise lookup. The regulator parameter is optional and can be supplied to narrow the search to a specific regulatory body.
2.3. Workflow Data Dictionary
 | Field Name | Description | Data Type | Required | Purpose
 | identification_number | The unique number or code assigned to the professional. | String | Yes | Used to query the Health Worker Registry and retrieve the professional's record.
 | identification_type | The category of identification used for the professional (e.g., "registration_number", "license_number"). | String | Yes | Tells the system what kind of identifier is being used for the search.
 | regulator | The regulatory body that issued or oversees the professional's registration. | String | No | Narrows the search to a specific regulator when a professional may be registered with more than one.
2.4. Expected Outcomes from this workflow
- Successful Search: The system finds and retrieves the correct professional’s data from the Health Worker Registry, enabling further processes.
- Professional Not Found: No professional matches the provided identifier; input may need verification.
- Input Error: Provided identifier type or value is invalid or unsupported.
### 3. Supported Professional Identifier Types
Below are the types of professional identifiers recognized for the Professional Search workflow. Ensure your inputs match the "Identifier Type Value" exactly.
 | Name (Common Use) | Identifier Type Value | Identifier Examples
 | Registration Number | registration_number | MED12345
 | License Number | license_number | LIC67890
### 4. How Professional Search Connects to Other Workflows
Professional Search is interconnected with patient and facility registries:
- Patient Visits: Professional details are linked to patient records for every encounter.
- Facility Validation: Ensures professionals are associated with legitimate facilities.
- Reporting and Analytics: Accurate professional data supports operational and regulatory reporting.
### 5. Key Success Factors for Professional Registry Integration
- Use Valid Identifiers: Always provide standardized, recognized professional identifiers.
- Keep Records Updated: Ensure professional data is current and synchronized.
- Follow Compliance: Adhere to privacy and regulatory requirements for professional data.
- Design for Interoperability: Integrate professional registry APIs for seamless data exchange.
Last modified on September 28, 2026
