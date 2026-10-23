# Adding Attachments
Many HIE endpoints let you attach supporting documents - invoices, discharge summaries, lab results,
imaging orders, death certificates and so on - to a claim, preauthorization or emergency protocol. This
guide explains how attachments are transmitted, the relationship between the attachment metadata and
the actual file, and the two upload patterns you will encounter.
### Attachments are sent as binary, not base64
Files are uploaded as raw binary parts of a multipart/form-data request. Do not base64-encode
the file into a JSON field. The document metadata travels as form fields (or a JSON string within a form
field), and the file itself is a separate binary part in the same multipart request.
## Metadata and file blob: how they link
Every attachment has two halves:
- Metadata - what the document is: its title, its document_type, and (for the array pattern below)
the name of the multipart part that carries the bytes.
- The file blob - the raw bytes of the file, sent as a binary multipart part.
The file part's Content-Disposition filename is significant: it carries the original file name and
extension (for example CLAIM_FORM.pdf), which downstream consumers rely on to infer the MIME type.
Always send a filename with a correct extension.
There are two patterns for linking the metadata to the blob, depending on the endpoint.
## Pattern A - metadata array with a named file part
Used when a single request can carry several attachments at once: adding a billable line, creating a
preauthorization, and adding emergency protocol details (combined billing).
You send a form field named attachments containing a JSON string - an array of metadata objects.
Each object names, via file_field_name, the separate multipart part that carries its bytes:
 | Metadata field | Description
 | document_title | A human-readable title for the document.
 | document_type | The document classification (see Document types).
 | file_field_name | The name of the multipart part that carries this document's binary. You may name this part anything - it just has to match.
### The file part can be named anything
In Pattern A the binary part's name is arbitrary. The only rule is that the name you put in
file_field_name must exactly match the name of the multipart part that carries the bytes. This lets you
attach multiple files in one request by giving each a distinct name.
Code 
curl -X POST "$BASE_URL/api/v1/claims/lines" \
  -H "Authorization: Bearer $TOKEN" \
  -F 'consent_token=K5HLPJVDNV' \
  -F 'intervention_code=SHA-18-005' \
  -F 'unit_price=1500' \
  -F 'quantity=1' \
  -F 'attachments=[{"document_title":"Itemised bill","document_type":"FINAL_BILL","file_field_name":"bill_file"},{"document_title":"Lab result","document_type":"LAB_RESULTS","file_field_name":"lab_file"}]' \
  -F 'bill_file=@/path/to/final-bill.pdf' \
  -F 'lab_file=@/path/to/lab-result.pdf'
Here bill_file and lab_file are arbitrary names; each matches a file_field_name in the metadata array.
## Pattern B - single fixed file_blob field
Used by the standalone Add Attachment endpoint (POST /claims/attachments), which attaches one
document to an existing claim. There is no metadata array here - the binary part is always named literally
file_blob, and the document metadata travels as sibling form fields:
 | Field | Description
 | consent_token | The claim's consent token.
 | file_blob | The binary part carrying the file. Must be named file_blob.
 | document_type | The document classification.
 | intervention_code / intervention_codes | The intervention(s) the attachment applies to.
Code 
curl -X POST "$BASE_URL/api/v1/claims/attachments" \
  -H "Authorization: Bearer $TOKEN" \
  -F 'consent_token=K5HLPJVDNV' \
  -F 'document_type=INVOICE' \
  -F 'intervention_code=SHA-18-005' \
  -F 'file_blob=@/path/to/invoice.pdf'
### Pattern B uses a fixed field name
Unlike Pattern A, the standalone Add Attachment endpoint does not read a file_field_name. The file
part must be named exactly file_blob.
## Document types
The document_type must come from the allowed set for the endpoint:
- Claim attachments (POST /claims/attachments) use the claim attachment document types (for example
INVOICE, FINAL_BILL, DISCHARGE_SUMMARY).
- Line, preauth and emergency attachments use the encounter/preauth document types (for example
LAB_RESULTS, IMAGING_RESULT, TREATMENT_PLAN, REFERRAL_LETTER, PREAUTH_FORM,
DISCHARGE_SUMMARY).
Where an intervention publishes an applicableDocumentTypes list, the document_type you use must be one
of those values. See the Claims and Preauths API reference for the full enumerations.
## Adding required documentation to claims and preauths
Which documents a claim or preauthorization must carry is not a fixed list you can hard-code. Every
intervention object states its own documentation requirements, and you read them off the intervention
you are billing.
### The four document-type fields
 | Field | What it means
 | applicableDocumentTypes | Documents required for the claim.
 | optionalDocumentTypes | Documents that may accompany the claim but are not required.
 | requiredPreauthDocumentTypes | Documents required for the preauthorization.
 | optionalPreauthDocumentTypes | Documents that may accompany the preauth but are not required.
Watch the casing: these arrive camelCase on the eligibility and interventions responses, and some
claims payloads carry applicable_document_types in snake_case. Read whichever form the endpoint
you actually called returned rather than assuming one convention across the API.
Integrators must read these per intervention and validate on their own side that everything
required has been attached before submitting. The requirement belongs to the intervention, so a claim
carrying several interventions inherits the union of their requirements.
### Regulator mandate: auto-attach, do not offer a manual upload
The Digital Health Agency (DHA) and the Social Health Authority (SHA), as the regulators,
currently require every HMIS integrating with the HIE to auto-attach clinical documentation and
not present users with a manual upload control.
The only exceptions are the claim form, the preauth form, and the birth notification.
The measure exists to prevent fraud and user error: documents pulled straight from the record cannot be
substituted, mislabelled, or forgotten at the point of submission.
### Special cases: documents that arrive on paper
A referral patient may walk in carrying physical clinical documents from another facility. The flow is
the same in principle: the user uploads the document into their own HMIS, and the HMIS then
auto-attaches it to the claim or preauth. The technical means of auto-attaching is deliberately left
to the integrator - what the regulators require is that the attachment step is not a manual choice made
against the HIE API.
## Related resources
- Add Attachment
- Remove Attachment
- Understanding Benefits and Intervention Codes
- Interventions Coverage
- Add New Line
- Add Combined Billing Details
- Preauths Process Overview
- Add Emergency Case Protocols
Last modified on September 28, 2026
