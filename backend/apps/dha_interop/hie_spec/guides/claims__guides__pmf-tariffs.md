# PMF Tariffs
The Public Officers Medical Scheme Fund (POMSF), often referred to as PMF, provides civil servants with
medical cover that tops up their standard Social Health Authority (SHA) benefits. Because PMF cover is
priced separately from UHC, the middleware exposes dedicated endpoints for checking a patient's PMF
balance and for resolving the PMF tariff that applies to a given service.
This guide explains how the PMF tariff endpoints fit together and how the resolved tariffs are used when
billing a claim.
## When PMF applies
A patient's scheme eligibility is returned by the eligibility and benefits endpoints. When a patient
qualifies under PMF, claims and preauthorizations can carry the scheme_code value PMF, and the
amounts billed are validated against the patient's PMF cover rather than (or in addition to) UHC.
### PMF and UHC together
A patient may be eligible under both UHC and PMF. PMF cover tops up the standard SHA (UHC) benefits for
eligible services, up to the patient's available PMF cover.
## The PMF endpoints
 | Endpoint | Purpose
 | GET /patients/pomsf-balances | Returns the patient's available POMSF cover for the policy year, so you can confirm how much PMF balance remains before billing.
 | POST /benefits/pomsf-rates | Looks up the health care worker in the health worker registry to derive their speciality, then evaluates the published POMSF rates rule set against the supplied facility and interventions, returning the parsed tariff entries.
 | POST /benefits/pmf-tariffs/resolve | Bundle-aware resolver. Forwards the request to the terminology-service POMSF tariff resolver and returns the tariff for the requested interventions, accounting for bundled services.
See the Claims and Preauths API reference for the full request and response schemas of each endpoint.
## Health care worker (HCW) identification
POST /benefits/pomsf-rates and POST /benefits/pmf-tariffs/resolve can derive the attending
practitioner's speciality from the health worker registry. When you supply the HCW identifier details
(hcw_identifier, hcw_identifier_type and hcw_regulator), the resolver normalises the practitioner's
speciality so the correct speciality-specific tariff is returned. Omit them to resolve against the
facility's default rates.
## How tariffs are used when billing
Resolved tariffs feed the bill-validation rules applied when you add a claim line or create a
preauthorization:
- Tariff ceiling. The amount billed for an intervention must not exceed the resolved tariff (the
applicable KEPH-level tariff, or the overall tariff where a level-specific rate is not defined).
- PMF balance. When the scheme is PMF, the billed amount must be within the patient's remaining
PMF cover plus any applicable ex-gratia allowance, as returned by GET /patients/pomsf-balances.
### Resolve before you bill
Resolve the PMF tariff and confirm the PMF balance before submitting a claim line. Billing above the
resolved tariff or beyond the available PMF cover will be rejected.
- The tariff has to be payable in the first place. Per-diem and case-based packages carry day-count,
length-of-stay and global-period rules that decide whether a resolved tariff can be billed at all. A
correctly resolved tariff billed inside a maternity or surgical global period is still rejected. See
Special Benefit Rules.
## Related guides
- Special Benefit Rules - the day-count and global-period rules that gate whether a resolved tariff is payable.
- Rehabilitation for Drug and Substance Abuse - a POMSF code whose amount must be resolved here rather than read off the matrix.
- Adding a claim line - how billed amounts are validated.
- Normal preauthorizations - PMF financial-limit checks.
- Benefits coverage - confirming PMF eligibility.
- Benefit Matrix - packages, codes, and combination rules.
Last modified on September 28, 2026
