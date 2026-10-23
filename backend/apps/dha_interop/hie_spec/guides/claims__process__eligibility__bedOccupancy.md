# Eligibility Process Guide: Facility Bed Occupancy Workflow
## Eligibility Process Guide: Facility Bed Occupancy Workflow
### 1. Overview: Current Bed Capacity and Occupancy
This guide covers the Facility Bed Occupancy workflow (GET /facilities/{facilityCode}/beds/occupancy),
a lookup within the Eligibility Process. It returns a facility's total bed capacity alongside its current
occupancy, broken down by ward type (normal, ICU, HDU, dialysis, and newborn cots).
Inpatient interventions are only appropriate where the facility has the capacity and ward type the
patient needs. This lookup lets an integrator confirm real-time capacity before starting an inpatient
visit or directing a patient to a ward.
1.1. What This Workflow Does
The Facility Bed Occupancy workflow retrieves, for a given facility:
- Facility identity: the facility name and its KEPH / business-partner level (bp_level).
- Bed capacity: the total number of beds and the counts per ward type (normal, ICU, HDU, dialysis
beds, and baby cots).
- Current occupancy: the number of active inpatient visits overall and per ward type.
1.2. Why This Workflow Is Critical
- Capacity-aware admissions: Confirms a bed of the required type is available before an inpatient
visit is started.
- Accurate patient routing: Helps direct patients to a facility or ward that can accommodate them.
- Operational visibility: Gives integrators a real-time view of ward utilisation.
### 2. Workflow Details: Retrieving Facility Bed Occupancy
2.1. Workflow Description
- Input Reception: The system receives the facility's Facility Registry (FR) code in the request
path as facilityCode.
- Facility Lookup: The system resolves the facility and retrieves its registered bed capacity and
current inpatient occupancy.
- Outcome Delivery: The facility name, level, per-ward capacity, and per-ward occupancy are
returned.
2.2. Workflow Data Dictionary
Request
 | Field Name | Description | Data Type | Required | Purpose
 | facilityCode | Facility Registry (FR) code (path parameter). | String | Yes | Identifies the facility to look up.
Response (bed_occupancy_rate)
 | Field Name | Description | Data Type
 | total_number_of_bed | Total beds across all ward types. | Integer
 | number_of_normal_bed | Normal (general) ward beds. | Integer
 | number_of_icu_bed | Intensive Care Unit beds. | Integer
 | number_of_hdu_bed | High Dependency Unit beds. | Integer
 | number_of_dialysis_bed | Dialysis beds. | Integer
 | number_of_baby_cot | Newborn baby cots. | Integer
 | total_ip_visits | Total active inpatient visits (current occupancy). | Integer
 | normal_ip_visits | Active visits in the normal ward. | Integer
 | icu_visits | Active visits in the ICU. | Integer
 | hdu_visits | Active visits in the HDU. | Integer
 | dialysis_visits | Active dialysis visits. | Integer
 | newborn_visits | Active newborn visits. | Integer
The response also carries the facility name and bp_level (facility / KEPH level).
2.3. Expected Outcomes
 | Outcome | Description
 | Success: Occupancy Retrieved | Capacity and current occupancy for the facility were returned.
 | Failure: Facility Not Found | The facilityCode was missing or the upstream capacity lookup failed.
 | Failure: Unauthorized | The authentication token was missing or invalid.
 | Failure: Forbidden | The caller does not have permission to read the facility's occupancy.
### 3. Critical Success Factors for Integration
- Correct Facility Code: Supply the facility's FR code exactly as registered.
- Treat Data as Real-Time: Occupancy changes as patients are admitted and discharged; read it close
to the point of decision rather than caching it.
## See Also
- Eligibility Process Overview
- The overnight-stay requirement - why the admission and discharge dates must differ for a per-diem rebate
- Facility Bed Occupancy API
Last modified on September 28, 2026
