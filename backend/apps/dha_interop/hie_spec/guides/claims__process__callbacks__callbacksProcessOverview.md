# Status Callbacks Process Overview: Being Told When a Status Changes
## 1. Introduction: Stop Polling, Start Listening
A claim, a preauthorisation and an authorisation all move through a workflow after you submit them. The payer
reviews, decides, and the record changes state. Until now the only way to learn about those changes was to ask
repeatedly - poll the status endpoint, compare it with what you stored, and hope your polling interval was
short enough to matter and slow enough to stay inside the API rate limits.
The HIE rate-limits its APIs, and aggressive polling is the usual way integrators hit those limits. Polling
every few seconds across all your open claims, preauths and authorisations will exhaust your allowance, at
which point requests are rejected - including the ones you actually need. Callbacks remove the reason to poll
at all.
Status callbacks invert that. You register an endpoint on your own system once, and from then on the HIE
POSTs a small JSON payload to it every time the entity's workflow state changes. No polling loop, no interval
to tune, and no window in which your records are stale without you knowing.
Callbacks tell you that something changed and what it changed to. They are a notification, not a
replacement for the read endpoints: when you need the full record, fetch it as you always have, with whichever
identifier that endpoint expects. The callback carries several, so use the one that fits the entity:
- A claim - your own provider_claim_no, or the consent_token for the visit.
- A preauthorisation - the consent_token, or subject_guid as the preauth's GUID.
- An authorisation - the consent_token, or subject_guid as the guid query parameter on
Get Authorizations.
subject_guid is always present and always identifies the entity that changed, so it is the reliable
correlation key even where it is not the identifier a given read endpoint takes.
### 1.1. Why This Process Matters
Timeliness: you learn about an approval, a rejection or a request for clarification as it happens,
rather than on your next poll.
Less load on both sides, and no rate-limit exhaustion: a facility polling every claim it has open
generates a great deal of traffic to answer "nothing has changed", and it is the most common way integrators
run into the API rate limits. Callbacks generate one call when there is genuinely news.
Fewer missed transitions: a state can change twice between two polls, and a polling integration only
ever sees the second one. Every transition is delivered.
Cleaner reconciliation: because each callback names both from_state and to_state, you can verify
that your local record was where the HIE thought it was, and detect a divergence instead of quietly
overwriting it.
## 2. The Two-Step Setup
Setting up callbacks is two calls, and nothing is delivered until both have succeeded. An endpoint on its
own is inert: it says where to call, but not what to call about.
Register the endpoint - POST /tenants/{tenant_id}/endpoints. This is the destination: your base URL,
which entity_type you want to hear about, how the HIE should authenticate to you, and which environment
this is. It returns an endpoint_id.
Register the operation - POST /tenants/{tenant_id}/endpoints/{endpoint_id}/operations. This is what
the HIE does at that destination: action: status_changed, the HTTP method, and the path to call. On this
route the first segment is not a tenant lookup - send your facility FR code, since the value
backfills the endpoint's facility_fr_code when that field is empty.
Register one endpoint per entity type. A facility may hold at most one endpoint for each of claim,
preauth and authorization, and each carries at most one operation per action. Three integrations means
three endpoints, each with its own status_changed operation - not one endpoint with three operations.
### 2.1. The Registration and Delivery Sequence
### 2.2. What You Need Before You Start
 | You need | Where it comes from
 | Your tenant_id, or your tenant_code | The HIE. Either handle works when registering an endpoint. Your tenant_code is normally the same value as your client ID, and it is unique to you
 | Your facility's FR code | You already have it. Set it as facility_fr_code when you register, so delivery has a fallback selector
 | A reachable HTTPS base URL | Your side. It must be an absolute URL
 | A secret_ref | The HIE, and only if you want an authenticated delivery. Not needed for auth_type: none
tenant_id and tenant_code are interchangeable only when registering an endpoint. On
GET /tenants/{tenant_id}/endpoints the path value is resolved as a tenant ID and then as a
facility_fr_code - a tenant_code there returns an empty array rather than an error. And on the two
operations routes the segment is not a tenant lookup at all; see
Register a callback operation.
## 3. The Three Entity Types
The three integrations are independent. They differ in which endpoint receives them, and - importantly - in
the vocabulary of states they report.
 | entity_type | What it reports | State vocabulary
 | claim | A claim moving through submission and adjudication | Claim statuses, for example SUBMITTED_PAYER to APPROVED
 | preauth | A preauthorisation being approved, finalised, rejected or expiring | Preauth statuses, for example ACTIVE to FINALISED
 | authorization | A visit authorisation being consumed by a claim | Authorisation statuses, for example AUTHORIZED to SUBMITTED_CLAIM
The three vocabularies do not overlap, and this is the most common source of integration bugs. FINALISED
is a preauth state and never a claim state; SUBMITTED_CLAIM is an authorisation state and never a preauth
one. Never switch on a state value without also switching on entity_type.
The action is status_changed for all three. It is the endpoint's entity_type, not the action, that tells
the integrations apart.
## 4. Where to Go Next
- Register a callback endpoint - step one, field by
field.
- Register a callback operation - step two, and how
the called URL is composed.
- Manage callback endpoints - list, read, pause,
update and delete.
- Status Callbacks integration guide - the payload you receive, how
to acknowledge it, idempotency, and troubleshooting. Start here if you are the one writing the receiving
endpoint.
## Related resources
- Understanding Claim Statuses - the claim vocabulary.
- Understanding Preauth Statuses - the preauth vocabulary.
- Authorization status callbacks - the authorisation
entity type, on the Consent side.
- Status Callbacks API reference - all nine registration operations.
Last modified on September 28, 2026
