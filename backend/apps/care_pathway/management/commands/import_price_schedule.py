"""Load the facility's price schedule workbook into one organisation's tariff
(guide.md 2026-11-26; parsing and rules in apps.care_pathway.price_schedule).

    python manage.py import_price_schedule --file "Price Schedule with Insurance Rates.xlsx" \
        --org <slug> --dry-run
    python manage.py import_price_schedule --file ... --org <slug>

Without --update-existing, a tariff line that already exists keeps every value
it has (an Org Admin may have set it on the Service Tariff page); only blanks
are filled. With it, the workbook's values replace the line's. Every row the
workbook could not take as written is listed, on a dry run too.
"""

import uuid
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.care_pathway import price_schedule
from apps.care_pathway.models import BillingService, ServiceCatalogueItem
from apps.insurance_claims.models import Insurer, ServicePayerCode
from apps.tenancy.context import clear_tenant_context, platform_admin_context, set_tenant_context
from apps.tenancy.models import Organization

LINE_FIELDS = (
    "code",
    "category",
    "description",
    "medicine_name",
    "mass",
    "cost",
    "markup_percent",
    "tax_percent",
    "rate",
    "remarks",
)


class Command(BaseCommand):
    help = (
        "Import a price schedule workbook (Out of pocket + one sheet per insurer) into one "
        "organisation's own tariff and insurers."
    )

    def add_arguments(self, parser):
        parser.add_argument("--file", required=True, help="Path to the .xlsx workbook.")
        parser.add_argument("--org", required=True, help="Organisation slug or id.")
        parser.add_argument("--dry-run", action="store_true", help="Report only; change nothing.")
        parser.add_argument(
            "--update-existing",
            action="store_true",
            help="Replace values on lines that already exist (default: fill blanks only).",
        )

    def handle(self, *args, **options):
        path = Path(options["file"]).expanduser()
        if not path.exists():
            raise CommandError(f"Workbook not found: {path}")
        with platform_admin_context():
            org = Organization.objects.filter(slug=options["org"]).first()
            if org is None:
                try:
                    org = Organization.objects.filter(pk=uuid.UUID(options["org"])).first()
                except ValueError:
                    org = None
        if org is None:
            raise CommandError(f"Organisation not found: {options['org']}")

        plan = price_schedule.plan(price_schedule.read_xlsx(path))
        set_tenant_context(organization_id=org.id)
        try:
            counts = self._apply(org, plan, options["dry_run"], options["update_existing"])
        finally:
            clear_tenant_context()

        for sheet, row, message in plan.issues:
            where = f"{sheet} row {row}" if row else sheet
            self.stdout.write(self.style.WARNING(f"  {where}: {message}"))
        self.stdout.write(
            self.style.SUCCESS(
                f"[{org.name}] lines created={counts['created']} filled/updated={counts['updated']} "
                f"unchanged={counts['unchanged']} insurers added={counts['insurers']} "
                f"insurer rates set={counts['rates']} "
                f"insurer rates kept={counts['rates_kept']} rows to review={len(plan.issues)}"
                + (" — DRY RUN, nothing saved" if options["dry_run"] else "")
            )
        )

    def _apply(self, org, plan, dry_run, update_existing):
        counts = dict(created=0, updated=0, unchanged=0, rates=0, rates_kept=0, insurers=0)
        services = {}
        catalogue = {i.name.lower(): i for i in ServiceCatalogueItem.objects.all()}
        with transaction.atomic():
            for line in plan.lines:
                service = BillingService.objects.filter(name__iexact=line.name).first()
                values = {f: getattr(line, f) for f in LINE_FIELDS}
                if values["code"] and (
                    BillingService.objects.filter(code=values["code"])
                    .exclude(pk=getattr(service, "pk", None))
                    .exists()
                ):
                    # Another line already holds this code; leave it with that one.
                    values["code"] = ""
                if service is None:
                    service = BillingService.objects.create(
                        organization=org,
                        name=line.name,
                        active=True,
                        catalogue_item=catalogue.get(line.name.lower()),
                        **values,
                    )
                    counts["created"] += 1
                else:
                    changed = []
                    for name, value in values.items():
                        old = getattr(service, name)
                        blank = old is None or old == ""
                        if value in (None, "") or old == value:
                            continue
                        if update_existing or blank:
                            setattr(service, name, value)
                            changed.append(name)
                    match = catalogue.get(line.name.lower())
                    if service.catalogue_item_id is None and match is not None:
                        service.catalogue_item = match
                        changed.append("catalogue_item")
                    if changed:
                        service.save(update_fields=[*changed, "updated_at"])
                        counts["updated"] += 1
                    else:
                        counts["unchanged"] += 1
                services[line.name.lower()] = service

            insurers = {}
            for entry in plan.insurer_rates:
                service = services[entry.line_name.lower()]
                insurer = insurers.get(entry.payer.lower())
                if insurer is None:
                    insurer = Insurer.objects.filter(name__iexact=entry.payer).first()
                    if insurer is None:
                        insurer = Insurer.objects.create(organization=org, name=entry.payer)
                        counts["insurers"] += 1
                    insurers[entry.payer.lower()] = insurer
                row = ServicePayerCode.objects.filter(service=service, insurer=insurer).first()
                if row is None:
                    ServicePayerCode.objects.create(
                        organization=org,
                        service=service,
                        payer="INSURER",
                        insurer=insurer,
                        payer_code="",
                        rate=entry.rate,
                        active=True,
                    )
                    counts["rates"] += 1
                elif row.rate is None or (update_existing and row.rate != entry.rate):
                    row.rate = entry.rate
                    row.save(update_fields=["rate", "updated_at"])
                    counts["rates"] += 1
                else:
                    counts["rates_kept"] += 1
            if dry_run:
                transaction.set_rollback(True)
        return counts
