# Eligibility Process Guide: Patient Search Workflow
## Eligibility Process Guide: Patient Search Workflow
### 1. Overview
This guide focuses on the Patient Search workflow, the essential first step in the broader Eligibility Process. Patient Search focuses on helping one find the right patient and getting their accurate details. Itʼs how we accurately identify a patient making a health facility visit before determining the services for which they're qualified.
1.1. What This Workflow Does
The Patient Search workflow's primary function is to locate a patient's official record using their identification details. When you provide an ID type (like a National ID) and the corresponding ID number, the system retrieves the correct patient's information, which is crucial in the eligibility process.
1.2. Why This Workflow Is Critical
Getting patient identification right from the start is crucial for the entire healthcare journey. Without a precise match:
- Accurate intervention display: Having the right patient details helps show the correct medical interventions they can access in the facility.
- Eligibility Failures: All subsequent checks (like what benefits a patient has) would be unreliable if we're looking at the wrong record.
- Data Integrity Issues: It prevents creating duplicate records or scattering patient information across different entries, ensuring a clean and reliable data set for everyone. A single source of truth.
This workflow is the foundation of eligibility. It ensures that every step of the Eligibility Process is built on the right patient's foundation.
### 2. Workflow Details: Patient Search
2.1. Workflow Description
When you request to find a patient, the following internal process happens:
Input Reception: The system receives the patient's identification details, specifically an ID type (e.g., "National ID") and the corresponding ID number (e.g., "40150936").
National Client Registry (NCR) Query: If the initial checks pass, the system then sends a request to the NCR. The NCR acts as the single source of truth, performing a deep search based on the provided identifiers.
Information Retrieval: If the NCR finds a unique match, it sends back the patient's essential biodata (like name, date of birth, etc.) to our system.
Outcome Delivery: Our system then uses this retrieved data for the next steps in the Eligibility Process.
2.2. Key Validations: Our System's Essential Checks
There are some essential checks performed to ensure a successful and accurate patient search. Understanding them helps you provide the correct information from your end.
Valid ID Type Must Be Provided:
The ID type you send (like NATIONAL_ID or PASSPORT) must be one that our system and the National Client Registry (NCR) explicitly recognise and support.
This is important as it helps the system know how to look for the information in the central registry. If it's not a recognised type, the search won't even start.
Both ID Number and ID Type Are Required:
You must provide both the actual ID number (e.g., "40150936") AND its correct corresponding ID type (e.g., "NATIONAL_ID"). You can't send one without the other.
This is critical for unique identification. An ID number alone isn't enough, as it could be a National ID, a temporary ID, or something else entirely. Likewise, an ID type without a number is useless. Providing both information helps the system perform a precise and accurate lookup, preventing errors or finding the wrong patient.
2.3. Workflow Data Dictionary
This helps show you the information we work with, whether it is required or not and in what format the system expects it in.
 | Field Name | Description | Data Type | Required | Purpose
 | identification_type | The category or kind of identification document the identification_number belongs to (e.g., "National ID," "Passport"). | String | Yes | This tells our system what kind of ID the identification_number is. Knowing the type is important for a correct system search within the NCR and for applying the right matching rules.
 | identification_number | The unique number or code directly from the patient's official identification document (e.g., the digits on a National ID card). | String | Yes | This is the exact identification number we use to query the National Client Registry. It's the primary key to unlocking the patient's record.
2.4. Expected Outcomes from this workflow
Successful Search: The system successfully finds and retrieves the correct patient's data from the National Client Registry. This means you have the foundational information to proceed with other eligibility checks.
Patient Not Found: The system indicates that no patient matching the provided ID type and number could be located in the National Client Registry. This might require verifying the input or exploring alternative identification methods.
Input Error: The system identifies that the provided ID type or number did not meet our validation rules (e.g., an unsupported ID type was sent). This means the search couldn't even begin properly.
### 3. Supported Patient ID Types
To help you map your patient data, here are the types of patient identifiers our system recognises for the Patient Search workflow. Please ensure your inputs match the "Identifier Type Value (System Recognition)" precisely.
 | Name (Common Use) | Identifier Type Value | Identifier Examples
 | National ID | NATIONAL ID | 40150936
 | Refugee ID | REFUGEE ID | 41506070
 | Temporary ID | TEMPORARY ID | 41506070
 | Mandate Number | MANDATE NUMBER | 41506070
 | Alien ID | ALIEN ID | 41506070
 | Birth Certificate Number | BIRTH CERTIFICATE NUMBER | 31415161
 | Client Registry Identifier | CR ID | CR9795515286992-5
 | SHA Identifier | SHA NUMBER | SHA0488143632695-
 | Birth Notification | BIRTH NOTIFICATION | 933306
Last modified on September 28, 2026
