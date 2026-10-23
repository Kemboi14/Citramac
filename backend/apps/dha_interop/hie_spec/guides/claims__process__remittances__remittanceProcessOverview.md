# Remittance Process Overview: Streamlining Payment Reconciliation for Healthcare Providers
## 1. Introduction: Understanding Remittance
This comprehensive guide provides a high-level overview of how the financial reconciliation of payments received from the Social Health Authority (SHA) for submitted claims is managed.
The Remittance process is a series of interconnected steps designed to ensure that healthcare providers can accurately track and reconcile payments against their submitted claims. It's about moving from a state where payments have been received to a clear, reconciled financial record.
### 1.1. Why This Full Process Matters
An accurate Remittance process is fundamental to efficient, transparent, and compliant financial operations in healthcare. It is crucial because it:
- Ensures Financial Transparency & Accuracy: Providers understand what they’ve been paid, by whom, and for which claims - reducing discrepancies.
- Enables Efficient Reconciliation: Automates matching of incoming payments to claims, minimizing manual work and potential errors.
- Supports Audit Readiness: Maintains a clear audit trail of all payments and associated claims for compliance and reviews.
- Improves Cash Flow Management: Helps providers allocate received funds faster, enhancing financial planning and operational stability.
## 2. The Full Remittance Journey: Step-by-Step Payment Reconciliation
The complete Remittance process is a multi-step journey, with each workflow building on the previous. Each stage adds depth until full reconciliation is achieved.
### 2.1. Step 1: Get Remittances
This foundational step retrieves a high-level summary of all remittances (payments) received by a specific healthcare facility from SHA.
- Purpose: Provides an initial overview of all incoming payments.
- Value: Helps facilities identify new remittances for reconciliation.
### 2.2. Step 2: Get Claims Paid by Remittance
This workflow provides a detailed breakdown of the specific claims that were paid under a given remittance.
- Purpose: Enables claim-level reconciliation.
- Value: Identifies which claims were fully paid, partially paid, or unpaid.
## 3. How Workflows Connect: The Power of Interdependency
While distinct, these workflows are interconnected and form a cohesive reconciliation system. Key dependencies include:
Cascading Dependencies:
The Get claims paid by remittance workflow depends on output from Get Remittances. Specifically, bank_reference from the first is required to query the second.
Consistent Facility Identification:
Both workflows use the same facility_id and facility_id_type, ensuring accurate data retrieval and segregation by provider.
## 4. Key Success Factors for Overall Remittance Integration
To successfully and efficiently integrate with the Remittance process, follow these best practices:
Accurate Facility Identification
Always supply correct facility_id and facility_id_type to access relevant remittance data.
Effective Remittance Identifier Management
Use the bank_reference from the Get Remittances output to accurately query Get claims paid by remittance.
Robust Error Handling
Build in logic to handle invalid IDs or remittance references, enabling your system to manage failures gracefully.
These principles will ensure smooth, accurate integration with the Remittance process - streamlining reconciliation and improving your financial visibility.
Last modified on September 28, 2026
