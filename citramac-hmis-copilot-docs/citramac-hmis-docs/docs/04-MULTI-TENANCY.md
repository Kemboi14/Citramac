# 04 — Multi-Tenancy Architecture

## 4.1 Tenancy model

CITRAMAC uses a **three-level hierarchy**:

```
Platform (CITRAMAC itself — Super Admin tier)
 └─ Organization (tenant — a hospital group / CCP centre / clinic network)
      └─ Branch (a physical facility location under that Organization)
           └─ Staff, Patients, Clinical Records, Billing, Inventory (all scoped to Branch → Organization)
```

- **Super Admin** operates above all tenants: creates/suspends Organizations, manages Subscriptions/billing plans for tenants, views a cross-tenant Governance/Audit Log, defines global Roles & Permission templates.
- **Org Admin** operates within exactly one Organization: manages that org's Branches, Ward & Bed setup, Staff/CCP Team, branch-level settings, and role assignment scoped to their org.
- **Clinical Workspace users** (doctors, nurses, therapists, lab techs, pharmacists, cashiers) operate within one Branch at a time, switchable if they have multi-branch access.

## 4.2 Isolation strategy: shared database, shared schema, `tenant_id` discriminator + Postgres Row-Level Security

Given DHA/SHA scale requirements and operational simplicity, use **shared database + shared schema with an `organization_id` foreign key on every tenant-scoped table**, enforced at three layers so isolation cannot be bypassed by an application bug alone:

1. **Application layer**: a Django middleware (`TenantMiddleware`) resolves the current `Organization` from the authenticated user's session/JWT claims and binds it to thread-local/request context. A custom base `TenantScopedManager`/`TenantScopedQuerySet` automatically filters every ORM query by `organization_id` unless explicitly run as Super Admin cross-tenant context.
2. **Database layer (defense in depth)**: enable **PostgreSQL Row-Level Security (RLS)** on every tenant-scoped table, with a policy comparing `organization_id` to a session variable (`SET app.current_org_id = '<uuid>'`) set at the start of every request's DB transaction. This means even a raw SQL bug or a bypassed ORM manager cannot leak cross-tenant rows.
3. **Object storage layer**: file/attachment paths are namespaced `orgs/{organization_id}/branches/{branch_id}/...`; signed URLs are scoped and short-lived.

Do **not** use separate databases per tenant or separate schemas per tenant for the initial architecture — it does not scale operationally for a SaaS platform with potentially hundreds of small facilities, and complicates migrations/DHA-wide reporting. Revisit only if a single enterprise tenant contractually requires physical DB isolation (support this as an escape hatch: `Organization.isolation_mode = SHARED | DEDICATED_DB`, default `SHARED`).

## 4.3 Core tenancy models

```python
# apps/tenancy/models.py

class Organization(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=True)
    facility_type = models.CharField(choices=[
        ("GENERAL_HOSPITAL", "General Hospital"),
        ("MENTAL_HEALTH_CCP", "Mental Health / CCP Centre"),
        ("DISPENSARY", "Dispensary / Level 2-3"),
        ("CLINIC", "Outpatient Clinic"),
    ])
    dha_facility_code = models.CharField(max_length=64, blank=True)   # assigned post DHA certification
    sha_provider_code = models.CharField(max_length=64, blank=True)   # SHA provider registration number
    subscription_plan = models.ForeignKey("SubscriptionPlan", ...)
    theme_overrides = models.JSONField(default=dict, blank=True)      # see 03-DESIGN-SYSTEM.md §3.6
    enabled_modules = models.JSONField(default=list)                  # feature flags, see §4.4
    isolation_mode = models.CharField(default="SHARED", choices=[("SHARED","Shared"),("DEDICATED_DB","Dedicated")])
    is_active = models.BooleanField(default=True)
    created_at, updated_at = ...

class Branch(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="branches")
    name = models.CharField(max_length=255)
    facility_level = models.CharField(choices=[("L2","Level 2"),("L3","Level 3"),("L4","Level 4"),("L5","Level 5"),("L6","Level 6")])
    address, county, gps_coordinates = ...
    is_active = models.BooleanField(default=True)

class SubscriptionPlan(models.Model):
    name = models.CharField(max_length=100)
    max_branches, max_staff_seats = models.IntegerField(...)
    included_modules = models.JSONField(default=list)
    price_monthly = models.DecimalField(...)
```

Every clinically/administratively scoped model (Patient, ClinicalEncounter, LabOrder, Invoice, etc.) must include:

```python
organization = models.ForeignKey(Organization, on_delete=models.PROTECT, db_index=True)
branch = models.ForeignKey(Branch, on_delete=models.PROTECT, db_index=True, null=True)
```

## 4.4 Feature flags per tenant type (module toggling)

`Organization.enabled_modules` is a list of module codes (e.g. `["client_registry","triage","lims","ccp_psychotherapy","ccp_sud_rehab"]`). Onboarding wizard (Org Admin, first login) presents a **facility type** choice which pre-selects a sane module bundle:

- `GENERAL_HOSPITAL` bundle → Modules 1–13 standard set (registration, triage, EHR, LIMS, RIS/PACS, pharmacy, IPD, theatre, MCH, billing, insurance, mortuary, sysadmin).
- `MENTAL_HEALTH_CCP` bundle → Modules 1, 2 (adapted MSE), 3 (adapted), 6, 10, 11, 13, **plus** CCP-specific modules: Psychiatric & Biopsychosocial Assessment, Individual/Family/Group Psychotherapy, SUD Rehab Workflows, Supervision Requests, NACADA NDO Report — surgical/theatre/MCH/mortuary modules disabled by default but can be manually enabled.

The frontend sidebar renders only enabled modules (plus a "Soon" badge for modules purchased/planned-but-not-yet-configured, matching the mockup pattern), driven by `GET /api/v1/me/enabled-modules/`.

## 4.5 Provisioning a new Organization (operational flow)

1. Super Admin creates the Organization record (name, facility type, subscription plan) → system generates `slug` and a default Org Admin invite.
2. Org Admin accepts invite → goes through the authentication flow (`05-AUTHENTICATION-FLOW.md`) → lands on a first-run onboarding wizard: confirm facility type, add first Branch, invite initial staff.
3. Module bundle is applied automatically per facility type, adjustable by Super Admin under Subscriptions.
4. DHA/SHA credentials (facility code, provider code, API keys/certificates) are entered under Org Admin → Branch Settings → Compliance tab, stored encrypted (see `09-SECURITY-COMPLIANCE.md`), required before any live SHA claim submission is permitted (sandbox mode works without them).

## 4.6 Cross-tenant safeguards checklist

- [ ] RLS enabled and tested with a negative-path test (attempt to read another org's row) in CI.
- [ ] All Celery tasks accept and log `organization_id`; no global/batch task iterates all tenants without explicit Super-Admin-only justification (e.g., platform-wide subscription billing job).
- [ ] All cache keys are prefixed `org:{organization_id}:...`.
- [ ] All search indices (if OpenSearch used later) are tenant-partitioned.
- [ ] Audit log entries always capture `organization_id`, `branch_id`, `actor_user_id`, `actor_role`.
- [ ] Load testing includes a "noisy neighbor" tenant scenario to confirm no resource starvation across tenants.
