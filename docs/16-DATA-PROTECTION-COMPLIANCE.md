# 16 — Data protection & digital-health compliance (system controls)

Source: legal opinion for CAFRIC Center by Udalang' & Mwiti Associates
Advocates, 2 October 2026 ("Data protection registration and health-data
regulatory compliance obligations of a multitenant hospital management
information system"). This document maps the opinion's system-side
obligations to what the platform does. The organisational obligations
(ODPC registration, DPO appointment, data processing agreements, Digital
Health Agency certification, policies) are CAFRIC's, not the software's.

## Roles (opinion §4)

- CAFRIC is a **data controller** for its own patients, staff, consultants,
  suppliers and partners.
- CAFRIC is a **data processor** for each tenant facility's patient data; the
  tenant is the controller. Processing tenant data outside the tenant's
  instructions makes CAFRIC a controller for it (DPA s.42(3)).

## Controls in the system (`backend/apps/compliance`)

| Obligation (opinion §) | Control | Where |
|---|---|---|
| Process tenant data only on the tenant's instructions (§4.2, §6) | Support access grants: requested by platform staff, approved by the facility's Org Admin, max 72 h. Without one, superuser requests to patient-data routes get 403; with one, the request is scoped to that facility only and audit-logged as `SUPPORT_ACCESS`. Clinical models are not in Django admin. | `support_access.py`, `admin_lock.py`; Org Admin → Support Access; Super Admin → Support Access |
| Breach notification (§10) | Incident register with tracks and clocks: facility 48 h (platform as processor), ODPC 72 h, Digital Health Agency 48 h, data subjects without delay when high risk. 30-minute reminder job; closing blocked while a required notification is outstanding. The Agency's prescribed form is not generated — record its reference. | `BreachIncident`, `BreachNotification`, `tasks.py`; Org Admin & Super Admin → Breach Incidents |
| Data subject rights (§11; DPA s.26, s.38; DHA s.36) | Request register: access, portability, correction, objection, restriction. Identity verification + Org Admin approval before release; access/portability fulfilled by a full export (R4 FHIR bundle + structured record), audit-logged as `EXPORT`. Erasure keeps its dual-approval flow. | `DataSubjectRequest`, `export.py`; client record → Legal & consent |
| Tenant registration & agreements (§4.3, §6) | Compliance profile per facility: ODPC registration number, expiry, evidence (verified by platform staff), DPA version and date, acceptance of the current compliance warranty, facility DPO contact; gaps listed. | `TenantComplianceProfile`; Org Admin → Data Protection; Super Admin → Tenant Compliance |
| DPO contact publicly available (§5) | Platform DPO contact set by platform staff, shown on the login page. | `PlatformComplianceSettings`, public `/api/v1/compliance/public/dpo/` |
| Tenant segregation not by UI alone (§7) | Postgres row-level security under the application checks (existing); cross-tenant platform access now gated as above. | `apps/tenancy/rls.py` |
| DPIA on material change (§8) | DPIA reviewed for the 2026-10-07 changes. | `DPIA-CAFRIC-MENTAL-HEALTH-MHP.md` §7 |

## Not settled by the software

- **Hosting location (§9) — HIGH.** The production server address is
  registered to Contabo, country DE. Confirm the physical location of the
  server and backups; Regulation 26 requires a Kenyan server or serving copy
  for health-care data, and DHA s.47 restricts sharing outside Kenya.
- Legal wording (compliance warranty, consent wording) is entered by CAFRIC
  and facilities from counsel; the system never supplies it.
- ODPC registration, DPO appointment, data processing agreements, Digital
  Health Agency certification (regs 36–39), incident response plan and
  information security policy.
