# 
# Facility Identification
Most claims, preauthorization and patient endpoints are scoped to a single facility. The middleware
needs to know which facility a request is acting on behalf of. There are two ways a request can carry
that facility context, and this page explains both, how they interact, and when each applies.
## The two methods
### 1. The JWT facility claim
A facility-scoped access token carries the facility directly in its claims: facility_id and
facility_id_type. When setting up credentials we are able to embed this information in a token. So when you authenticate as a facility, the token issued already identifies that
facility, and no extra request data is needed - the middleware reads the facility straight from the
token.
### 2. The X-Facility-Id headers
Some cases there are needs whereby a token needs not be tied to a single facility. For example
tokens used by an HMIS that operates across many facilities in a multitenancy fashion. These tokens do not carry a facility claim.
For them, the originating facility is supplied per request using two headers:
 | Header | Description
 | X-Facility-Id | The facility's registry identifier, e.g. FID-47-115307-8.
 | X-Facility-Id-Type | The type of identifier supplied. Currently only fr-code is supported.
### Both headers are required together
X-Facility-Id and X-Facility-Id-Type must both be present. If either is missing, the header pair
is ignored and the request falls back to the facility claim in the token (if any). Managing this facility information per each request and for the right facility will be the responsibility of the integrator.
## Which one wins?
When both a JWT facility claim and the X-Facility-Id headers are present on the same request, the
headers take precedence and override the facility claim from the token. If the headers are absent
(or incomplete), the facility claim in the token is used.
However we do not encourage having both methods tied to the same request as it can lead to confusion and potential errors.
### Precedence summary
Header pair present -> facility comes from the headers.
Header pair absent or incomplete -> facility comes from the JWT claim.
## Applicability and multitenancy
- Facility-scoped tokens. A token issued to a single facility carries its facility claim. These
callers normally do not send the headers - the facility is already established by the token.
- Service-account / organization (multitenant) tokens. A caller that acts on behalf of many
facilities (for example a central HMIS integration) holds a token with no facility claim. Such a
caller must send X-Facility-Id and X-Facility-Id-Type on every request to scope it to one
facility. The same credentials can therefore serve many facilities by varying the headers per
request.
### Choosing an approach
If your integration represents one facility, authenticate as that facility and rely on the token
claim. If a single integration serves multiple facilities, use a service-account token and set the
X-Facility-Id headers on each call.
Last modified on September 28, 2026
