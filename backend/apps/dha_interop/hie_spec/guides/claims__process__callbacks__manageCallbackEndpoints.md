# Status Callbacks Process Guide: Manage Callback Endpoints
## 1. Overview: Reading, Pausing and Removing a Registration
Once callbacks are set up, seven of the nine routes exist to look after the configuration: list what is
registered, read a single operation, change a setting, pause delivery, or remove the registration entirely.
This is also where you look when callbacks stop arriving, because the two most common causes - a paused
record and a missing operation - are both visible from a single read.
### 1.1. What These Workflows Do
 | Route | What it does
 | GET /tenants/{tenant_id}/endpoints | Lists the active endpoints under a tenant or facility code, with their active operations embedded
 | GET /tenants/{tenant_id}/endpoints/{endpoint_id}/operations | Lists the active operations under one endpoint
 | GET /tenants/endpoints/operations/{operation_id} | Reads one operation, including an inactive one
 | PATCH /tenants/endpoints/{endpoint_id} | Partially updates an endpoint
 | PATCH /tenants/endpoints/operations/{operation_id} | Partially updates an operation
 | DELETE /tenants/endpoints/{endpoint_id} | Deletes an endpoint and all its operations
 | DELETE /tenants/endpoints/operations/{operation_id} | Deletes one operation, leaving the endpoint
Updates and deletes are not nested under a tenant. They address the record by its own ID -
/tenants/endpoints/{endpoint_id}, not /tenants/{tenant_id}/endpoints/{endpoint_id} - because that ID is
already unique. The two POST routes and the two list routes are the nested ones.
### 1.2. Why These Workflows Matter
- Pausing is not deleting. Maintenance on your receiving endpoint is a PATCH with is_active: false, not
a delete followed by a re-registration with a new ID.
- Reading back is the only confirmation you get. No callback is delivered to prove the setup works, so the
endpoint read - with its embedded operations - is what tells you the integration is complete.
- Rotating a destination is a partial update. A new host is a base_url change, not a new registration.
## 2. Workflow Details
### 2.1. Listing Endpoints
GET /tenants/{tenant_id}/endpoints
The path value is resolved as a tenant ID first and falls back to a facility_fr_code, so you can list by
either of those two handles. Add ?entity_type=claim to narrow it; because a facility holds at most one endpoint
per entity type, that returns at most one result.
A tenant_code is not resolved on this route. Registration accepts a tenant ID or a tenant_code; this
read accepts a tenant ID or a facility_fr_code. Listing by tenant code returns an empty array rather than an
error, which looks exactly like "nothing is registered". Use the tenant ID or the facility FR code.
The response is the bare array, each endpoint carrying its operations.
Code 
[
  {
    "endpoint_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "name": "Claim status callbacks",
    "entity_type": "claim",
    "base_url": "https://his.example.co.ke/hie",
    "auth_type": "none",
    "environment": "sandbox",
    "tenant_code": "his-tenant-code",
    "facility_fr_code": "FID-47-115307-8",
    "is_active": true,
    "operations": [
      {
        "operation_id": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        "name": "Claim status changed",
        "action": "status_changed",
        "method": "POST",
        "path": "/callbacks/claim-status",
        "is_active": true
      }
    ]
  }
]
This route returns active records only, so read an empty result carefully. Both the endpoint list and each
embedded operations array are filtered to is_active: true. A paused record is therefore absent from the
response rather than shown with is_active: false.
That gives an empty [] three quite different meanings:
- nothing is registered under the identifier you used;
- something is registered but the endpoint is paused;
- you are listing by an identifier this route does not resolve - a tenant_code, for example.
The same applies one level down: an endpoint that comes back with operations: [] either has no operation or
has a paused one. To tell those apart, read the operation directly with
GET /tenants/endpoints/operations/{operation_id} - that route does return inactive records.
What a healthy configuration looks like here: the endpoint appears at all, and its operations array
contains an entry whose action is status_changed. Because the filtering already excludes inactive records,
their presence in this response is the confirmation that both are active.
### 2.2. Reading a Single Operation
GET /tenants/endpoints/operations/{operation_id}
Unlike the list route this does not need the parent endpoint, and it returns inactive operations too -
which makes it the only way to see a paused operation, and so the quickest way to tell "paused" from "deleted".
It needs the operation_id, so keep that value when you register.
### 2.3. Pausing and Resuming Delivery
Set is_active on either record:
Code 
{
  "is_active": false
}
Both the endpoint and the operation must be active for anything to be delivered, and a paused record raises
no error. Delivery simply stops. Nothing is queued and nothing is replayed, so transitions that occur while
either record is inactive are not delivered when you re-enable it. If you need the outcome of a claim whose
transitions you missed, read it back from the claim endpoints.
Pausing the operation is the narrower instrument; pausing the endpoint stops everything registered under it.
### 2.4. Updating an Endpoint or an Operation
Both PATCH routes are genuine partial updates: send only the fields you are changing, and omitted fields are
left untouched. An empty body is rejected with a 400.
Code 
{
  "base_url": "https://his.example.co.ke/hie/v2",
  "timeout_ms": 30000
}
Two behaviours worth knowing:
- headers is replaced, not merged. Sending a headers map overwrites the stored one wholesale, so include
every header you still want, not just the new one.
- The response is the complete record, not just the changed fields, so you can verify the result without a
second read.
The endpoint PATCH validates any auth_type, environment or base_url you supply, and rejects a bad value
with a 400 - unlike the create route, where a rejected value surfaces as a 500.
Changing entity_type on a live endpoint re-points it at a different integration, and changing action away
from status_changed stops callbacks reaching the operation. Both are accepted without warning; neither is
usually what you want on a working registration.
### 2.5. Deleting
 | Route | Effect
 | DELETE /tenants/endpoints/{endpoint_id} | Removes the endpoint and every operation under it
 | DELETE /tenants/endpoints/operations/{operation_id} | Removes one operation; the endpoint survives and can take a replacement
Both return only a message:
Code 
{
  "message": "endpoint deleted successfully"
}
Deleting is irreversible: re-registering produces a new endpoint_id, so anything you have stored against
the old one has to be updated. For a temporary stop, prefer is_active: false.
### 2.6. Expected Outcomes
- 200 OK - read, update or delete succeeded. Reads and updates return the record; deletes return a message.
- 400 Bad Request - a required path value is missing, the body is not valid JSON, the update body carries no
fields, or an updated auth_type, environment, base_url or method is invalid.
- 404 Not Found - no endpoint or operation carries that ID. Also what you get after a delete.
- 500 Internal Server Error - an unexpected failure.
## 3. Critical Success Factors
- Read before you debug. One GET /tenants/{tenant_id}/endpoints answers most "callbacks stopped"
questions - but remember it hides paused records, so an empty result is not proof that nothing is registered.
- Keep the endpoint_id and operation_id. They are the only way to reach a paused or misconfigured record.
- Pause with is_active, do not delete. Deleting loses the ID, and nothing is replayed either way.
- Send complete headers maps on an update, since the stored map is replaced.
- Remember which routes are nested. Creates and lists take {tenant_id}; updates and deletes do not.
- List by tenant ID or facility FR code, not by tenant_code, or you will get an empty array from a
perfectly healthy configuration.
## Related resources
- Status Callbacks Process Overview - how the pieces
fit together.
- Register a callback endpoint - step one.
- Register a callback operation - step two.
- Status Callbacks integration guide - the payload and the full
troubleshooting sequence.
- Status Callbacks API reference - all nine operations.
Last modified on September 28, 2026
