# CITRAMAC HMIS — Copilot standing instructions

> **Read `CLAUDE.md` at the repo root first, every session.** It is the binding
> specification for this codebase. Where anything here or in a mockup disagrees
> with it, `CLAUDE.md` wins.

## What you are building

A cloud-native, multi-tenant information system for mental health and addiction
treatment facilities. Its data contract is **FHIR R4, version 4.0.1** — not R4B,
not R5. "v4" in a mockup's name is a design revision, never a FHIR version.

## Ground rules

1. **FHIR R4 4.0.1 is what the clinical data is.** Every clinical feature names its
   R4 resource, profile, terminology binding and where it hangs off
   `EpisodeOfCare` *before* any code is written, and waits for the owner's
   confirmation (`CLAUDE.md` §3, §7).
2. **Never invent codes, canonical URLs, identifier systems or statute
   citations.** Mark them `VERIFY:` with what is needed and where to get it
   (`CLAUDE.md` §6).
3. **Mockups set layout, not the data model.** A field a mockup shows that has
   no R4 home is raised with the owner, never stored in a repurposed element or
   a private table (`CLAUDE.md` §5).
4. **Multi-tenancy is structural.** Every table, query, cache key, Celery task,
   file path and audit entry is scoped to an organization; Postgres RLS enforces it.
5. **SHA integration is API-native** — never a portal workaround.
6. **Account activation is multi-step** (identify → confirm email → OTP → set
   password, see `frontend/src/auth/AuthFlowController.tsx`). Do not collapse it
   into a single form.
7. **Every change is production-minded:** reversible migrations, no hard-coded
   secrets, tests included, and the CI FHIR conformance gate kept green.
8. Ask the owner before destructive database operations, rotating secrets or
   applying Terraform to a real account.
