# Status Callbacks Process Guide: Register a Callback Endpoint
## 1. Overview: Telling the HIE Where to Call
This guide covers the first of the two calls that set up status callbacks:
POST /tenants/{tenant_id}/endpoints. It registers the destination - your host, which entity type you want
to hear about, and how the HIE should authenticate when it calls you.
It does not yet cause anything to be delivered. An endpoint without an operation is a destination with no
reason to be called; registering the operation is
step two.
### 1.1. What This Workflow Does
- Resolves the tenant from the path value, so the endpoint is owned by a known tenant.
- Stores the destination - base_url, plus the selectors (tenant_code, facility_fr_code) used later to
find this endpoint when a status change happens.
- Stores the delivery policy - authentication, timeout and retry behaviour.
- Returns the complete endpoint record, including the endpoint_id you need for step two.
### 1.2. Why This Workflow Is Critical
- It is the anchor for the whole integration. The endpoint_id it returns is how every later call - adding
an operation, pausing delivery, deleting the registration - addresses this configuration.
- It fixes which entity type you receive. The entity_type set here decides whether this endpoint hears
about claims, preauths or authorisations. It cannot be inferred later from the payload.
- It is where authentication is decided. If your receiving endpoint is protected, the credential has to be
in place before the first delivery, not after.
## 2. Workflow Details: Registering the Endpoint
### 2.1. The Path Value Takes Either Handle
POST /tenants/{tenant_id}/endpoints
The path segment is resolved against the tenant table as a tenant ID first, and retried as a
tenant_code, so either handle registers the endpoint.
Your tenant_code is normally the same value as your client ID, and it is unique to you - the HIE
guarantees that, so the two handles are equivalent here and you can use whichever you have to hand. If neither
matches a tenant, the response is a 404.
That equivalence applies to this route only. On GET /tenants/{tenant_id}/endpoints the path value is
resolved as a tenant ID and then as a facility_fr_code, so a tenant_code there returns an empty array.
On the two operations routes the segment is not a tenant lookup at all - see
Register a callback operation.
### 2.2. Step-by-Step System Behaviour
- Path resolution - the value is looked up as a tenant ID, then as a tenant code. An unknown value gives
a 404.
- Body validation - name, entity_type, base_url, auth_type and environment must all be present;
base_url must parse as an absolute URL; auth_type and environment must be known values; and
secret_ref must be present whenever auth_type is anything other than none.
- Defaults applied - timeout_ms defaults to 60000, is_active to true, headers to an empty map,
and operations to an empty list.
- Selector defaulting - if you omit tenant_code, the resolved tenant's own code is stored.
- Persistence - an endpoint_id is generated and the complete record is returned with a 201.
### 2.3. Request Fields
 | Field | Required | What it means
 | name | Yes | Your label. Not parsed, need not be unique
 | entity_type | Yes | One of claim, preauth, authorization. Fixes what this endpoint receives
 | base_url | Yes | Scheme and host the operation's path is appended to. Must be absolute
 | auth_type | Yes | How the HIE authenticates to you. See 2.4
 | environment | Yes | production or sandbox
 | secret_ref | Conditional | Required whenever auth_type is not none. Issued by the HIE
 | tenant_code | No | Primary delivery selector, normally the same value as your client ID. Defaults to the resolved tenant's code, which is usually what you want
 | facility_fr_code | No | Fallback delivery selector, and a lookup key for the list route
 | headers | No | Static headers sent on every delivery. Never put credentials here
 | timeout_ms | No | Response deadline. Defaults to 60000
 | retry_config | No | max_retries, backoff_ms, backoff_multiplier
entity_type takes exactly one of three values: claim, preauth or authorization - singular, all
lower case. Send the value verbatim. A facility holds at most one endpoint per entity type, so each kind you
want to receive needs its own endpoint.
### 2.4. Authentication: What You Can Set Yourself
auth_type is required, and only one of its values is self-service.
 | auth_type | secret_ref | Self-service
 | none | Not required | Yes
 | bearer_static | Required | No
 | bearer_login | Required | No
 | api_key | Required | No
 | basic_auth | Required | No
 | oauth2_client_credentials | Required | No
There is no API route that stores a credential. Secrets are held in the HIE's secret manager and referenced
by name, so secret_ref is a pointer to a credential the HIE already holds - not the credential itself, and
not something you can create through this API.
To use anything other than auth_type: none, ask the HIE to store your credential and give you the
secret_ref, then register the endpoint with that value. Registering a non-none auth_type without a
secret_ref is rejected.
If your receiving endpoint is open (for example, protected by network rules or a secret path rather than a
header), auth_type: none is the correct and complete answer.
### 2.5. How the Two Selectors Are Used
At delivery time the HIE has to find your endpoint from the event it just received. It tries, in order:
- tenant_code - matched against the tenant code the EDI backend publishes with the event.
- facility_fr_code - tried only if no endpoint was found under the tenant code.
Only an unresolved endpoint moves the search on to the next identifier. If the endpoint is found and the
delivery then fails, the HIE stops there and reports the failure - it does not fall through to the facility
code and deliver twice. Events from older publishers carry no tenant code at all and go straight to the
facility code.
### 2.6. Example
Code 
{
  "name": "Claim status callbacks",
  "entity_type": "claim",
  "base_url": "https://his.example.co.ke/hie",
  "auth_type": "none",
  "environment": "sandbox",
  "tenant_code": "his-tenant-code",
  "facility_fr_code": "FID-47-115307-8",
  "timeout_ms": 60000,
  "retry_config": {
    "max_retries": 3,
    "backoff_ms": 1000,
    "backoff_multiplier": 2
  }
}
### 2.7. Reading the Response
A 201 returns the complete endpoint record - not just what you sent. Note the generated endpoint_id, the
applied defaults, and the empty operations array.
Code 
{
  "id": 8,
  "endpoint_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "tenant_id": "b5f8c2d4-3e7a-4f19-9c6b-1a2d3e4f5a6b",
  "name": "Claim status callbacks",
  "entity_type": "claim",
  "base_url": "https://his.example.co.ke/hie",
  "auth_type": "none",
  "secret_ref": "",
  "headers": {},
  "timeout_ms": 60000,
  "retry_config": {
    "max_retries": 3,
    "backoff_ms": 1000,
    "backoff_multiplier": 2
  },
  "environment": "sandbox",
  "tenant_code": "his-tenant-code",
  "facility_fr_code": "FID-47-115307-8",
  "is_active": true,
  "operations": [],
  "created_at": "2026-08-06T13:10:16.828383Z",
  "updated_at": "2026-08-06T13:10:16.828383Z"
}
 | Field | Why it matters to you
 | endpoint_id | Carry this forward. Step two needs it, and so does every update or delete
 | is_active | Must be true for anything to be delivered
 | operations | Empty here. Until it holds a status_changed operation, nothing arrives
 | secret_ref | Empty for auth_type: none. The credential itself is never returned
 | id | An internal row number. Address the endpoint by endpoint_id, never by this
Every read and every partial update returns the complete record, including zero values such as
is_active: false or an empty secret_ref. You never have to guess whether a field was omitted because it is
unset or because the response is abbreviated.
### 2.8. Expected Outcomes
- 201 Created - the endpoint is registered. Continue to step two.
- 400 Bad Request - the body is not valid JSON.
- 404 Not Found - no tenant carries that tenant ID or tenant_code.
- 500 Internal Server Error - also how a rejected field value surfaces: a missing name, an unknown
auth_type or environment, a base_url that is not a URL, or a missing secret_ref. Read message
before treating a 500 as an outage - it names the field that was rejected.
## 3. Critical Success Factors
- Keep the endpoint_id. Everything else in the integration is addressed by it.
- Send entity_type verbatim - claim, preauth or authorization, singular and lower case.
- Set facility_fr_code here, at creation. It gives delivery a fallback selector, and it stops the
operations route from backfilling the field with whatever you put in its path.
- Use production and sandbox. prod is not accepted.
- Sort out authentication before you register, if you need anything beyond auth_type: none.
- Register one endpoint per entity type. A facility holds at most one per entity_type.
- Do not put credentials in headers. They are stored as plain configuration; that is what secret_ref
exists for.
## Related resources
- Status Callbacks Process Overview - how the two
steps fit together.
- Register a callback operation - step two.
- Manage callback endpoints - list, pause, update,
delete.
- Status Callbacks integration guide - the payload your endpoint has to
handle.
- Register a callback endpoint - the API reference.
Last modified on September 28, 2026
