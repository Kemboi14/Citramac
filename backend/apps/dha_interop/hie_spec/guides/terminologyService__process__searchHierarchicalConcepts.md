# Terminology Service Process Guide: Search Hierarchical Concepts
## 1. Overview: Searching Clinical Concepts in a Terminology Source
This guide covers the Search Hierarchical Concepts workflow (GET /clinical/concepts). It lets an
integrator search a terminology source for clinical concepts - for example interventions, diagnoses, or
other coded entries - so the correct standardised code can be resolved and used elsewhere in the HIE.
### 1.1. What This Workflow Does
The workflow queries a terminology source (identified by its owner and source, and optionally scoped to a
collection) and returns the matching concepts. You can free-text search and page through results.
### 1.2. Why This Workflow Is Critical
Using the correct, standardised concept code is the foundation of clean claims, preauthorizations and
clinical data. Searching the terminology source ensures you send codes the HIE recognises rather than
free text, reducing rejections and reconciliation issues.
## 2. Workflow Details: Search Hierarchical Concepts
### 2.1. Workflow Description: Step-by-Step System Behavior
- Input Reception: The system receives the terminology owner and source (and optionally a
collection), plus a search term and optional paging (limit, offset).
- Source Query: The system queries the identified terminology source for concepts matching the search
term.
- Result Delivery: The system returns the matching concepts (paged according to limit/offset).
### 2.2. Key Validations
- Owner and source: The owner and source must identify a terminology source the system can resolve.
- Paging bounds: limit and offset must be valid non-negative values when supplied.
### 2.3. Workflow Data Dictionary
 | Field Name | Info | Is required? | Type
 | owner | The owner (namespace) of the terminology source. | True | string (query)
 | source | The terminology source to search within. | True | string (query)
 | collection | Restrict the search to a specific collection within the source. | False | string (query)
 | search | The free-text search term used to match concepts. | False | string (query)
 | limit | Maximum number of results to return (paging). | False | integer (query)
 | offset | Number of results to skip (paging). | False | integer (query)
### 2.4. Expected Outcomes
- Success: Matching concepts are returned for the search term.
- No Matches: The source resolves but no concepts match the search term.
- Failure - Unresolvable Source: The owner/source combination does not resolve to a known source.
## 3. Related Resources
- Fetch Concept Mappings - resolve a concept's mapped child concepts.
- Terminology Service API Reference
Last modified on September 28, 2026
