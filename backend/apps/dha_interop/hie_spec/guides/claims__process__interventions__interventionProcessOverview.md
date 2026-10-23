# Intervention Process Overview: Managing Patient Services
## Intervention Process Overview: Managing Patient Services
### 1. Introduction: Understanding Interventions
This is a comprehensive guide providing a high-level overview of how we manage interventions, which are the specific healthcare services that providers give to patients covered under the Social Health Authority (SHA). This process covers the whole lifecycle of an intervention, including adding new ones, retiring existing ones, switching between them, and restoring previously retired interventions to a patient's visit, with all changes accurately reflected in the corresponding claim of the visit.
At its core, the Intervention Process is designed to ensure that a healthcare provider can accurately record the specific healthcare services provided to a patient and manage and modify these services as needed, depending on allowable scenarios. It's about maintaining a precise and verifiable record of all medical services a SHA-covered patient receives at a health facility, therefore enabling the health facility to submit an appropriate and accurate claim for payment for those services.
1.1. Why This Full Process Matters
An accurate and well-managed Intervention Process is important for several critical reasons, as it ensures a clear and precise picture of all healthcare services provided during a patient's visit. It is crucial because it:
- Provides a Comprehensive Record of Services: This process ensures a precise and exhaustive account of all healthcare services delivered to a patient during their visit to a healthcare facility, supporting clinical accuracy and historical record-keeping.
- Facilitates Efficient Claims Processing: By enabling the accurate capture of interventions and their associated billing information, this process directly contributes to a smoother, faster, and more efficient claims submission and payment process, reducing discrepancies and delays.
- Ensures Compliance and Auditability: This process establishes a clear, auditable trail of all service modifications, which is vital for compliance and resolving any disputes related to services provided or claims submitted.
## 2. The Full Intervention Process Journey: Step-by-Step Management of Interventions
The complete intervention process is a multi-step journey, with each workflow building upon or providing management capabilities for the interventions recorded during a patient's visit. Here are the key workflows in their sequential order:
### 2.1. Step 1: Add New Intervention
This is the foundational step that enables the recording of any healthcare service. It allows for the addition of a new, valid intervention to a patient's existing visit record.
This workflow is crucial for establishing the initial record of all valid healthcare services provided to a patient covered under SHA. It also makes it possible to apply subsequent workflows, such as retiring or switching an intervention, as an intervention must first exist to be modified.
### 2.2. Step 2: Retire an Intervention
This workflow specifically allows for the logical removal or deactivation of an existing intervention from a patient's current visit record.
This workflow is important as it helps to correct inaccuracies or remove unnecessary interventions from a patient's visit record. For instance, if an intervention was mistakenly added or later deemed not applicable, it can be retired from the visit record to ensure claims accuracy.
### 2.3. Step 3: Switch Intervention
This workflow facilitates the replacement of one existing intervention with another specified intervention within a patient's visit record.
Depending on dynamic changes during a visit (e.g., a planned service change, or a more appropriate intervention is identified), there might be a need to swap one specified intervention for another. This workflow comes in handy for maintaining an accurate and flexible record of care.
### 2.4. Step 4: Restore Intervention
This workflow retrieves a previously retired intervention and reinstates its status to make it a valid and active intervention again for the patient's visit.
In cases of error where an intervention was mistakenly retired, or if circumstances change requiring its re-inclusion, this workflow provides the capability to restore it to the patient's visit record, ensuring data integrity and flexibility.
## 3. How Workflows Connect: The Power of Interdependency
While each workflow in the Intervention Process has a specific role, they are interconnected and data flows seamlessly with crucial cross-workflow validations ensuring integrity:
- Foundational Dependence: The Add New Intervention workflow is foundational. No other intervention management workflows (Retire, Switch, Restore) can operate unless an intervention has first been successfully added to a patient's visit.
- Intervention State dependence: Each subsequent workflow's operation is strictly dependent on the current status of an intervention. For example: An intervention must be an active and existing intervention before it can be retired or switched. Or only a previously Retired intervention can be restored. This prevents restoring an active intervention or an intervention that never existed.
- Claim Reflection: All changes made to interventions (Add, Retire, Switch, Restore) are designed to be accurately reflected in the patient's visit details, which directly impacts the generation and submission of the subsequent claim for that visit.
## 4. Key Success Factors for Overall Intervention Process Integration
For your integration with the entire Intervention Process to be successful and efficient, keep these overarching principles in mind:
- Data Accuracy and Consistency: Ensuring that intervention codes and associated details are consistently accurate at every stage (from adding to modifying) is paramount. Inaccurate data will lead to incorrect claims and hinder proper service management.
- Strict Adherence to SHA Rules: Understanding and implementing SHA's rules for adding, retiring, switching, and restoring interventions is vital. This includes rules around eligibility, service applicability, and timing to avoid rejections or compliance issues.
- Error Handling and User Feedback: Implement error detection and reporting at each step of the process. Clear, actionable feedback for users is essential to quickly resolve issues, whether due to invalid input, business rule violations, or technical glitches.
- Auditability and Traceability: Every change within the intervention lifecycle should be logged and traceable. This ensures accountability, supports dispute resolution, and aids in regulatory compliance checks.
By understanding and adhering to these principles, you can ensure a smooth, accurate, and effective integration with the Intervention Process, ultimately contributing to precise patient records, efficient claims processing, and improved quality of care.
Last modified on September 28, 2026
