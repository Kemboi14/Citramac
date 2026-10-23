# Status Callbacks Process Guide: Register a Callback Operation
## 1. Overview: Telling the HIE What to Call About
This guide covers the second of the two calls that set up status callbacks:
POST /tenants/{tenant_id}/endpoints/{endpoint_id}/operations. It registers the behaviour at a destination
you have already created - which event to react to, which HTTP method to use, and which path to call.
This is the call that switches delivery on. Until it succeeds, the endpoint from step one is inert.
### 1.1. What This Workflow Does
- Attaches an operation to an existing endpoint, identified by endpoint_id.
- Binds it to an action - status_changed for every status callback, whatever the entity type.
- Fixes the URL the HIE will call, either as a path appended to the endpoint's base_url or as an absolute
override.
- Optionally overrides the endpoint's timeout and retry policy for this one operation.
### 1.2. Why This Workflow Is Critical
- Nothing is delivered without it. An endpoint with an empty operations array receives no callbacks, and
no error is raised to tell you so.
- It is where the called URL is finally decided, and the override rule surprises people - see 2.4.
- The action is what the delivery machinery looks for. A status change resolves your endpoint and then asks
it for its status_changed operation. Register the action under any other name and the delivery finds
nothing.
## 2. Workflow Details: Registering the Operation
### 2.1. The First Segment Is Not a Tenant Lookup - Send Your Facility FR Code
POST /tenants/{tenant_id}/endpoints/{endpoint_id}/operations
The operation is attached using endpoint_id alone, which is already unique. The first segment is not
resolved as a tenant here, and it is not discarded either.
On this route the path value backfills the parent endpoint's facility_fr_code. If that field is still
empty on the endpoint, whatever you put in this segment is written into it, verbatim and unvalidated.
Send your facility FR code:
POST /tenants/FID-47-115307-8/endpoints/7c9e6679-7425-40de-944b-e07fc1f90ae7/operations
Do not send a placeholder such as _. On an endpoint registered without a facility_fr_code, that would
store _ as the facility code and quietly break delivery's fallback selector - callbacks would then depend
entirely on tenant_code matching, with nothing to fall back to.
If you did set facility_fr_code when you created the endpoint, the backfill is a no-op and this segment
is harmless whatever you send. Setting it at creation is the safer habit.
The matching GET on this path is different: there the segment is genuinely ignored - the handler never
reads it - and nothing is written. Any non-empty value works, though sending the facility code keeps your logs
consistent with the POST.
### 2.2. Step-by-Step System Behaviour
- Path check - endpoint_id must be present; a missing value is a 400.
- Body validation - name, action and method are required; method must be one of GET, POST,
PUT, PATCH, DELETE; and either path or path_url_override must be supplied.
- Defaults applied - request_content_type defaults to application/json, is_active to true, and
headers to an empty map.
- Persistence - an operation_id is generated and the complete record is returned with a 201.
- Facility backfill - if the parent endpoint has no facility_fr_code, the first path segment is written
into it.
- Delivery begins - the next transition on that entity type is POSTed to the composed URL.
### 2.3. Request Fields
 | Field | Required | What it means
 | name | Yes | Your label for the operation
 | action | Yes | status_changed for status callbacks, for all three entity types
 | method | Yes | GET, POST, PUT, PATCH or DELETE. Use POST
 | path | Conditional | Appended to the endpoint's base_url. Required unless you send path_url_override
 | path_url_override | Conditional | Absolute URL that replaces base_url + path entirely
 | request_content_type | No | Defaults to application/json, which is what the payload is
 | headers | No | Static headers for this operation, on top of the endpoint's own
 | timeout_ms | No | Overrides the endpoint's deadline for this operation
 | retry_config | No | Overrides the endpoint's retry policy for this operation
Use POST. DELETE passes validation at registration time but is not supported by the delivery client, so
an operation registered with it will fail on every attempt. The payload is a JSON body describing a state
change, which POST is the natural fit for.
### 2.4. How the Called URL Is Composed
There are exactly two outcomes, and the override wins outright:
 | What you set | URL the HIE calls
 | path: "/callbacks/claim-status" | base_url + path, so https://his.example.co.ke/hie/callbacks/claim-status
 | path_url_override: "https://callbacks.example.co.ke/hie/claim-status" | Exactly that, ignoring base_url completely
path_url_override is not a path - it is a full URL, and it bypasses the endpoint's base_url and host
entirely. If you set it, changing base_url later has no effect on this operation. Use it deliberately, when
one callback genuinely has to go to a different host from the rest of the endpoint's configuration.
Watch the slashes: the composed URL is a plain concatenation of base_url and path, so a base_url ending in
/ together with a path starting with / produces a double slash.
### 2.5. Example
Code 
{
  "name": "Claim status changed",
  "action": "status_changed",
  "method": "POST",
  "path": "/callbacks/claim-status",
  "request_content_type": "application/json",
  "timeout_ms": 30000,
  "retry_config": {
    "max_retries": 3,
    "backoff_ms": 1000,
    "backoff_multiplier": 2
  }
}
### 2.6. Reading the Response
A 201 returns the complete operation record.
Code 
{
  "id": 12,
  "operation_id": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  "endpoint_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "name": "Claim status changed",
  "action": "status_changed",
  "method": "POST",
  "path": "/callbacks/claim-status",
  "path_url_override": null,
  "headers": {},
  "timeout_ms": 30000,
  "retry_config": {
    "max_retries": 3,
    "backoff_ms": 1000,
    "backoff_multiplier": 2
  },
  "request_content_type": "application/json",
  "is_active": true,
  "created_at": "2026-08-06T13:10:16.828383Z",
  "updated_at": "2026-08-06T13:10:16.828383Z"
}
 | Field | Why it matters to you
 | operation_id | Carry this forward. Reading, pausing, updating and deleting the operation all use it
 | action | Must read status_changed, or the delivery machinery will not find this operation
 | is_active | Must be true, and so must the endpoint's - both are checked
 | path_url_override | null here, so the URL is base_url + path
 | timeout_ms | Set, so it overrides the endpoint's value. null would mean "use the endpoint's"
Next step: there is no third call. Once this returns 201, confirm the configuration end to end by reading
the endpoint back - GET /tenants/{tenant_id}/endpoints?entity_type=claim returns the endpoint with this
operation embedded in its operations array. Check facility_fr_code on that response while you are there,
since this call may have set it. Then implement the receiving endpoint against the
integration guide.
Note that the read returns active records only, so use the tenant ID or facility FR code you registered
with - a tenant_code is not resolved on that route.
### 2.7. Expected Outcomes
- 201 Created - the operation is registered and delivery is live.
- 400 Bad Request - endpoint_id missing from the path, or the body is not valid JSON.
- 500 Internal Server Error - also how a rejected field value surfaces: a missing name or action, an
unsupported method, or neither path nor path_url_override. Read message before treating a 500 as an
outage.
## 3. Critical Success Factors
- action is status_changed, spelled exactly, for claims, preauths and authorisations alike.
- Put your facility FR code in the first path segment, never a placeholder - on an endpoint with no
facility_fr_code yet, that value becomes the facility code.
- Use POST, not DELETE.
- Send path, or path_url_override - not casually both. The override silently wins.
- Confirm with a read. The endpoint's operations array is the single view that proves both halves of the
setup are in place.
- One operation per action per endpoint. Registering a second status_changed on the same endpoint is not
how you receive more; a second entity type needs its own endpoint.
## Related resources
- Register a callback endpoint - step one, which
produces the endpoint_id used here.
- Manage callback endpoints - reading back, pausing
and deleting.
- Status Callbacks integration guide - the payload, acknowledgement and
idempotency rules.
- Register a callback operation - the API reference.
Last modified on September 28, 2026
