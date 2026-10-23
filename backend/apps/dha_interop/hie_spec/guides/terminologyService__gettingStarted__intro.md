# TERMINOLOGIES SERVICE APIs
## Terminology Service (TS): The Universal Translator for Healthcare Data
Healthcare is complex. Different hospitals, labs, pharmacies, and insurers often use different words, codes, or formats to describe the same thing. For example, one system might record a prescription as Panadol, while another records it as Paracetamol 500mg Tablet. Without a common standard, this creates confusion, errors, and inefficiencies. Unless systems agree on a common reference, patient records won’t align when it comes to referring to Healthcare Products and Technologies (HPTs).
The Terminology Service (TS) is the foundation of standardization in the Health Information Exchange (HIE) ecosystem. Its role is to:
- Provide a systematic way to represent healthcare concepts (drugs, lab tests, diagnoses, procedures).
- Ensure all systems "speak the same language" by binding data to controlled vocabularies and code systems such as:
- ICD-11 for diseases and conditions
- LOINC for lab tests
- ICHI for procedures
By acting as a translator and reference library, TS ensures:
- Data from Hospital A can be understood by Hospital B.
- Prescriptions created in one EMR are valid in another.
- National and international reporting remains consistent.
- Data stored in the Shared Health Record is standardized and accessible to any EMR or healthcare system.
### Why the Terminology Service Matters
Consistency
Example: “Panadol” = “Paracetamol 500mg Tablet” across all systems. Reduces ambiguity and ensures product consistency across EMRs.
Integration
Connects clinical codes to billing, insurance claims, and supply chain identifiers.
Example: A prescription of Paracetamol is linked to both its clinical code and its SKU in the pharmacy.
Decision Support
Powers Clinical Decision Support Systems (CDSS) for key decision-making.
Analytics & Reporting
Enables meaningful aggregation of data.
Example: A national report on “Number of antibiotics dispensed in Q1” only works if antibiotics are coded consistently.
### The Role of TS in the HIE Ecosystem
TS works with three other registries:
- Master Patient Index (MPI): Who is the patient?
- Health Worker Registry (HWR): Who is providing the service?
- Facility Registry (FR): Where is the service happening?
Together, these ensure trust, consistency, and accountability across the healthcare ecosystem.
## Core Concepts in TS
- Organization: Manages concepts and sources (e.g., Ministry of Health, WHO).
- Source: A set of terminologies or codes published by an organization (e.g., ICD-11).
- Collection: A curated subset of concepts within a source (e.g., all antibiotics).
- Concept: The fundamental unit (e.g., “Paracetamol 500mg Oral Tablet”).
Example Hierarchy
- Organization: Ministry of Health
- Source: National Drug Codes
- Collection: Antibiotics
- Concept: Amoxicillin 500mg Capsule
## Why Developers Should Care
If you’re integrating with the HIE:
- Always query the Terminology Service API when referencing drugs, tests, diagnoses, or procedures.
- This ensures your system speaks the same “language” as every other system on the network.
Example:
- Your EMR records “Panadol 500mg.”
- Instead of storing free text, you query TS and link it to the standardized concept: “Paracetamol 500mg Oral Tablet (VMP Code: 12345).”
- When this record is shared, other facilities recognize it, even if their local system displays it as “Acetaminophen 500mg.”
The Terminology Service is not just a technical component — it’s the universal translator of the HIE ecosystem, ensuring interoperability, reliability, and trust.
Last modified on September 28, 2026
