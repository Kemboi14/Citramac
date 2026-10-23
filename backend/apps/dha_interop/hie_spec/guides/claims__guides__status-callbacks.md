# Status Callbacks
The HIE can tell you when a claim, a preauthorisation or an authorisation changes state, so you no longer have
to poll for it. You register an endpoint on your system once, and from then on every workflow transition on that
entity type is POSTed to you as a small JSON payload.
This guide is for whoever writes the receiving endpoint. It covers the two calls that set callbacks up, the
exact payload you will receive, how to acknowledge it, and what to check when nothing arrives.
A callback tells you that something changed and what it changed to. When you need the full record, fetch
it with the subject_guid the callback carries.
## What you need from the HIE first
 | You need | Notes
 | Your tenant_id, or your tenant_code | Either works when registering an endpoint. Your tenant_code is normally the same value as your client ID and is unique to you
 | Your facility's FR code | Set it as facility_fr_code when you register, so delivery has a fallback selector. You also send it in the path of the second call
 | A secret_ref | Only if you want the HIE to authenticate when it calls you. Not needed for auth_type: none
The two handles are interchangeable only on the registration call. The read route
GET /tenants/{tenant_id}/endpoints resolves a tenant ID or a facility_fr_code, so a tenant_code there
returns an empty array. And on the operations routes the first segment is not a tenant lookup at all - see
step 2.
There is no API route that stores a credential. secret_ref points at a secret the HIE already holds, so
anything other than auth_type: none has to be arranged with the HIE in advance. If your endpoint is protected
by network rules or an unguessable path rather than a header, auth_type: none is the right answer and you need
nothing from the HIE beyond your tenant handle.
## Setting it up: two calls
### 1. Register the endpoint
Code 
POST /api/v1/tenants/{tenant_id}/endpoints
Authorization: Bearer <token>
Content-Type: application/json
Code 
{
  "name": "Claim status callbacks",
  "entity_type": "claim",
  "base_url": "https://his.example.co.ke/hie",
  "auth_type": "none",
  "environment": "sandbox",
  "tenant_code": "his-tenant-code",
  "facility_fr_code": "FID-47-115307-8"
}
A 201 returns the endpoint, and the field you need next is endpoint_id:
Code 
{
  "endpoint_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "name": "Claim status callbacks",
  "entity_type": "claim",
  "base_url": "https://his.example.co.ke/hie",
  "auth_type": "none",
  "secret_ref": "",
  "headers": {},
  "timeout_ms": 60000,
  "environment": "sandbox",
  "tenant_code": "his-tenant-code",
  "facility_fr_code": "FID-47-115307-8",
  "is_active": true,
  "operations": []
}
environment is production or sandbox. prod is rejected.
### 2. Register the operation
Code 
POST /api/v1/tenants/FID-47-115307-8/endpoints/7c9e6679-7425-40de-944b-e07fc1f90ae7/operations
Authorization: Bearer <token>
Content-Type: application/json
Code 
{
  "name": "Claim status changed",
  "action": "status_changed",
  "method": "POST",
  "path": "/callbacks/claim-status"
}
Put your facility FR code in the first path segment. The operation attaches to endpoint_id alone, so that
segment is not a tenant lookup - but it is not ignored either: if the endpoint has no facility_fr_code yet,
this value is written into it verbatim.
A 201 returns the operation, and delivery is now live:
Code 
{
  "operation_id": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  "endpoint_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "name": "Claim status changed",
  "action": "status_changed",
  "method": "POST",
  "path": "/callbacks/claim-status",
  "path_url_override": null,
  "request_content_type": "application/json",
  "is_active": true
}
The HIE will now POST to https://his.example.co.ke/hie/callbacks/claim-status - the endpoint's base_url
followed by the operation's path.
Do not send a placeholder such as _ in that segment. On an endpoint registered without a
facility_fr_code, it would be stored as the facility code and quietly break delivery's fallback selector. If
you set facility_fr_code at creation, this value is ignored and anything is safe - which is the better habit.
path_url_override replaces base_url + path with an absolute URL of your choosing. Use it when one callback
must go to a different host; otherwise leave it unset.
### One endpoint per entity type
Register the pair above once for each entity type you want. Three integrations means three endpoints, each with
its own status_changed operation:
 | Entity type | Endpoint | Operation
 | claim | entity_type: "claim" | action: "status_changed"
 | preauth | entity_type: "preauth" | action: "status_changed"
 | authorization | entity_type: "authorization" | action: "status_changed"
A facility holds at most one endpoint per entity type, and each endpoint holds at most one operation per
action. The action never changes - it is the endpoint's entity_type that separates the integrations.
## The payload you receive
Every callback, for all three entity types, has the same shape. Fields are omitted when empty rather than sent
as null.
 | Field | Always present | What it is
 | subject_guid | Yes | The entity's GUID. Your key for fetching the full record and for de-duplication
 | to_state | Yes | The state the entity has just moved to
 | from_state | Yes | The state it moved from
 | entity_type | Yes | claim, preauth or authorization. Read this before interpreting any state
 | timestamp | Yes | When the transition happened
 | facility_fr_code | Yes | The facility the entity belongs to
 | provider_claim_no | Claims only | Your own claim number, echoed back
 | tenant_code | Conditional | Present when the source system is set
 | consent_token | Conditional | Present when the entity carries an authorisation with a token
 | notes | Conditional | Present when a note was recorded against the target state
 | authorization_reason | Authorisations only, conditional | Present when the authorisation has a machine-readable reason, such as BIOMETRICS_NOT_FOUND_OTP_ALLOWED. See OTP Fallback
### A claim callback
Code 
{
  "subject_guid": "9f8c1a2b-4d5e-4f60-8a71-2b3c4d5e6f70",
  "provider_claim_no": "OP-21-26-1",
  "from_state": "SUBMITTED_PAYER",
  "to_state": "APPROVED",
  "facility_fr_code": "FID-47-115307-8",
  "entity_type": "claim",
  "timestamp": "2026-08-06T13:15:50.862762+00:00",
  "consent_token": "K5HLPJVDNV",
  "notes": "Approved in full"
}
### An authorisation callback
Code 
{
  "subject_guid": "4b7d9e10-2c3f-4a5b-9d8e-7f6a5b4c3d2e",
  "from_state": "AUTHORIZED",
  "to_state": "SUBMITTED_CLAIM",
  "facility_fr_code": "FID-47-115307-8",
  "tenant_code": "his-tenant-code",
  "entity_type": "authorization",
  "timestamp": "2026-08-06T13:10:16.828383+00:00",
  "consent_token": "K5HLPJVDNV"
}
provider_claim_no is absent here: an authorisation has no provider claim number, so the field is dropped
rather than sent empty.
### A preauthorisation callback
Code 
{
  "subject_guid": "1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9",
  "from_state": "ACTIVE",
  "to_state": "FINALISED",
  "facility_fr_code": "FID-47-115307-8",
  "tenant_code": "his-tenant-code",
  "entity_type": "preauth",
  "timestamp": "2026-08-06T13:10:16.828383+00:00",
  "consent_token": "K5HLPJVDNV",
  "notes": "Finalised after service delivery"
}
### Which fields to expect, per entity type
 | Field | claim | authorization | preauth
 | provider_claim_no | Present | Never | Never
 | tenant_code | Present when the source system is set | Present | Present
 | consent_token | When an authorisation with a token exists | When a token exists | Always (may be empty)
 | notes | When a note exists for the target state | When a note exists | Always (may be empty)
 | authorization_reason | Never | When the authorisation has a reason | Never
Treat every conditional field as optional in your parser. A claim callback with neither notes nor
consent_token is perfectly normal, and a preauth callback may carry both as empty strings. Do not make a
field's presence a precondition for processing the callback.
## The state vocabularies differ per entity type
This is the single most likely source of bugs in a callback integration.
Never switch on a state value without also switching on entity_type. The three entities have separate,
non-overlapping vocabularies. FINALISED is a preauth state and never a claim state. SUBMITTED_CLAIM is an
authorisation state and never a preauth one. A single switch (to_state) across all three will mis-handle
transitions, and worse, will look correct until an unfamiliar value arrives.
 | entity_type | Where the vocabulary is documented
 | claim | Understanding Claim Statuses
 | preauth | Understanding Preauth Statuses
 | authorization | Authorization status callbacks
entity_type takes exactly one of three values - claim, preauth, authorization - singular and
lower case, both when you register an endpoint and in the payload you receive. Two normalisations are worth
knowing because they affect what you see:
- A publisher that spells the type out as preauthorization is mapped to preauth, which is the value your
endpoint is registered under and the value the payload carries.
- An empty entity type falls back to claim.
## Acknowledging a callback
Return any 2xx. The response body is ignored. Anything that is not a 2xx - including a timeout - counts as a
failed attempt and is retried according to the retry_config on the operation, or the endpoint's if the
operation does not set one.
Acknowledge as soon as you have durably accepted the payload, and do your processing afterwards. If you
adjudicate, write to several tables and rebuild a cache before replying, you risk exceeding timeout_ms and
being sent the same transition again while the first copy is still in flight.
### Idempotency and ordering
Retries mean the same transition can arrive more than once. Two callbacks are the same event when they share
subject_guid and to_state.
Nothing guarantees ordering. Do not assume the callback for A to B arrives before the one for B to C. Two
practical consequences:
- Key your de-duplication on subject_guid + to_state, not on arrival order.
- Use from_state as a consistency check. If it does not match the state you hold, you have missed a transition
or received one out of order - re-read the entity rather than applying the change blindly.
### The delivery sequence
Note the asymmetry: only a failure to resolve an endpoint moves the search on to the next identifier. Once
an endpoint is found, a delivery failure stops there and is retried against that endpoint - it is not
re-delivered to a second one.
## Registering all three: a worked example
Code 
POST /api/v1/tenants/{tenant_id}/endpoints
{ "name": "Claim status", "entity_type": "claim", "base_url": "https://his.example.co.ke/hie",
  "auth_type": "none", "environment": "production", "facility_fr_code": "FID-47-115307-8" }
-> 201 endpoint_id = 7c9e6679-7425-40de-944b-e07fc1f90ae7
POST /api/v1/tenants/FID-47-115307-8/endpoints/7c9e6679-7425-40de-944b-e07fc1f90ae7/operations
{ "name": "Claim status changed", "action": "status_changed", "method": "POST",
  "path": "/callbacks/claim-status" }
-> 201
POST /api/v1/tenants/{tenant_id}/endpoints
{ "name": "Preauth status", "entity_type": "preauth", "base_url": "https://his.example.co.ke/hie",
  "auth_type": "none", "environment": "production", "facility_fr_code": "FID-47-115307-8" }
-> 201 endpoint_id = 2d4f6a80-1b3c-4d5e-8f90-a1b2c3d4e5f6
POST /api/v1/tenants/FID-47-115307-8/endpoints/2d4f6a80-1b3c-4d5e-8f90-a1b2c3d4e5f6/operations
{ "name": "Preauth status changed", "action": "status_changed", "method": "POST",
  "path": "/callbacks/preauth-status" }
-> 201
POST /api/v1/tenants/{tenant_id}/endpoints
{ "name": "Authorization status", "entity_type": "authorization", "base_url": "https://his.example.co.ke/hie",
  "auth_type": "none", "environment": "production", "facility_fr_code": "FID-47-115307-8" }
-> 201 endpoint_id = 8e0a2c46-3d5f-4a7b-9c1d-2e3f4a5b6c7d
POST /api/v1/tenants/FID-47-115307-8/endpoints/8e0a2c46-3d5f-4a7b-9c1d-2e3f4a5b6c7d/operations
{ "name": "Authorization status changed", "action": "status_changed", "method": "POST",
  "path": "/callbacks/authorization-status" }
-> 201
Three separate paths on your side is a convenience, not a requirement - entity_type in the payload is enough
to route a single shared path. Separate paths make your logs easier to read.
## Troubleshooting: nothing is arriving
Work down this list in order. It is ordered by how often each cause turns out to be the culprit.
Is there an operation at all? GET /tenants/{tenant_id}/endpoints?entity_type=claim and look at
operations. An empty array is the most common cause: the endpoint was registered and step two was never
completed. An endpoint alone delivers nothing.
Read that empty result carefully. This route returns active records only, and it resolves a tenant ID
or a facility_fr_code - not a tenant_code. So an empty [] can mean nothing is registered, or the
endpoint is paused, or you are listing by the wrong handle. Likewise operations: [] can mean no
operation or a paused one. To see a paused operation, read it directly with
GET /tenants/endpoints/operations/{operation_id}, which does return inactive records.
Are both records active? The endpoint's is_active and the operation's must both be true. Either
one being false stops delivery silently, with no error anywhere - and, per step 2, hides the record from the
list route.
Is entity_type one of the three values? It must be exactly claim, preauth or authorization -
singular, lower case. Register a different string and the endpoint will not be the one delivery resolves.
Is action exactly status_changed? Any other value means the delivery machinery finds no operation to
call.
Do the delivery selectors match? Delivery matches your tenant_code first and falls back to
facility_fr_code. If the registered tenant_code does not match what the HIE publishes, and no
facility_fr_code is set, there is nothing left to resolve against. Setting both is the robust
configuration.
Check facility_fr_code on the endpoint. If you left it unset at creation, the second registration call
wrote its first path segment into it. An endpoint whose facility_fr_code reads _ - or anything that is not
your FR code - is that mistake, and the fallback selector is broken. Fix it with
PATCH /tenants/endpoints/{endpoint_id}.
Is the URL what you think it is? If path_url_override is set it wins outright and base_url is
ignored. Check the composed URL for a double slash from a trailing / on base_url.
Is your endpoint returning a 2xx inside timeout_ms? A slow endpoint looks identical to a broken one from
the HIE's side. Log the inbound request before you process it, so you can tell "never arrived" from "arrived
and my handler failed".
Was the transition during a pause? Nothing is queued or replayed. Transitions that occur while either
record is inactive are lost, so read the entity back rather than waiting for a redelivery.
If all ten check out, contact HIE support with your endpoint_id, operation_id and the approximate time of a
transition you expected - delivery attempts are recorded server-side and support can confirm whether the HIE
tried and what your endpoint returned.
## Related resources
- Status Callbacks Process Overview - the process view
of the same setup.
- Register a callback endpoint - step one, field by
field.
- Register a callback operation - step two, and URL
composition.
- Manage callback endpoints - list, pause, update,
delete.
- Understanding Claim Statuses - the claim vocabulary.
- Understanding Preauth Statuses - the preauth vocabulary.
- Status Callbacks API reference - all nine registration operations.
Last modified on September 28, 2026
