# Terminology Service Process Guide: Fetch Concept Mappings
## 1. Overview: Fetching Concepts and Their Mapped Child Concepts
This guide covers the Fetch Concept Mappings workflow (GET /clinical/concepts/mappings). It returns a
parent concept together with the child concepts it maps to - for example a sub-intervention and the
protocols mapped beneath it - so an integrator can walk a concept's hierarchy.
### 1.1. What This Workflow Does
Given a starting concept in a terminology source, the workflow returns the concepts mapped from it,
following the requested mapping type. This is how you resolve the children of a concept rather than
searching flat.
### 1.2. Why This Workflow Is Critical
Many clinical concepts are hierarchical: a concept has narrower child concepts mapped beneath it.
Fetching those mappings lets you present and select the correct specific concept, which is essential when
a parent concept alone is not billable or actionable.
## 2. Workflow Details: Fetch Concept Mappings
### 2.1. Workflow Description: Step-by-Step System Behavior
- Input Reception: The system receives the terminology owner and source, the from_concept to
start from, and the map_type describing which mapping relationship to follow.
- Mapping Resolution: The system resolves the mappings of the starting concept in the source.
- Result Delivery: The system returns the parent concept with its mapped child concepts.
### 2.2. Key Validations
- Owner and source: The owner and source must identify a resolvable terminology source.
- Starting concept: from_concept must identify a concept that exists in the source.
### 2.3. Workflow Data Dictionary
 | Field Name | Info | Is required? | Type
 | owner | The owner (namespace) of the terminology source. | True | string (query)
 | source | The terminology source to resolve mappings within. | True | string (query)
 | from_concept | The concept to fetch mappings from (the parent). | True | string (query)
 | map_type | The mapping relationship to follow (which child concepts to return). | False | string (query)
### 2.4. Expected Outcomes
- Success: The parent concept and its mapped child concepts are returned.
- No Mappings: The concept resolves but has no mappings of the requested type.
- Failure - Unresolvable Source or Concept: The owner/source or from_concept cannot be resolved.
## 3. Related Resources
- Search Hierarchical Concepts - find the concept to start from.
- Terminology Service API Reference
Last modified on September 28, 2026
