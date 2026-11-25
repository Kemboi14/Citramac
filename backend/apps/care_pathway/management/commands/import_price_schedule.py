import re
import xml.etree.ElementTree as ET
import zipfile
from decimal import Decimal, InvalidOperation
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.care_pathway.models import BillingService
from apps.insurance_claims.models import ServicePayerCode
from apps.tenancy.models import Organization

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
MASS_RE = re.compile(
    r"(\d+(?:\.\d+)?\s*(?:mcg|mg|g|kg|ml|l|iu|%)(?:\s*/\s*\d+(?:\.\d+)?\s*(?:mcg|mg|g|kg|ml|l|iu|%))?"
    r"|\d+\s*(?:tabs?|capsules?|caps?|sachets?|ampoules?|vials?|patch(?:es)?|box(?:es)?|packs?)"
    r"|\d+\s*'\s*s\b)",
    re.I,
)


def _clean(value):
    if value is None:
        return ""
    return str(value).replace("\n", " ").strip()


def _money(value):
    text = _clean(value)
    if not text:
        return None
    upper = text.upper()
    if upper in {"FREE", "TBD"}:
        return None
    if "PLUS MILEAGE" in upper or "PP" in upper.split() or "/KM" in upper:
        return None
    text = text.replace("KES", "").replace(",", "").replace(" ", "")
    text = re.sub(r"[^0-9.\-]", "", text)
    if not text:
        return None
    try:
        return Decimal(text)
    except (InvalidOperation, ValueError):
        return None


def _percent(value):
    text = _clean(value)
    if not text:
        return None
    text = text.replace("%", "").strip()
    try:
        return Decimal(text)
    except (InvalidOperation, ValueError):
        return None


def split_medication(description):
    text = " ".join(_clean(description).split())
    if not text:
        return "", ""
    match = MASS_RE.search(text)
    if not match:
        return text, ""
    name = text[: match.start()].strip(" -/,")
    mass = text[match.start() :].strip(" -/,")
    # Keep a form/pack tail attached to mass when it follows immediately after
    # the numeric strength (e.g. "100mg tabs", "200ml Syrup").
    if name.count("(") > name.count(")"):
        name = name.rstrip(" (")
    if mass.count(")") > mass.count("("):
        mass = mass.rstrip(" )")
    return name or text, mass


def read_xlsx(path):
    with zipfile.ZipFile(path) as z:
        ss = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", NS):
                ss.append(
                    "".join(
                        (t.text or "")
                        for t in si.iter(
                            "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"
                        )
                    )
                )
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        sheets = [
            (
                sh.attrib["name"],
                sh.attrib[
                    "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
                ],
            )
            for sh in wb.findall("m:sheets/m:sheet", NS)
        ]
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        rid = {r.attrib["Id"]: r.attrib["Target"] for r in rels}
        out = {}
        for name, rid0 in sheets:
            target = rid[rid0]
            target = ("xl/" + target) if not target.startswith("/") else target.lstrip("/")
            root = ET.fromstring(z.read(target))
            rows = []
            for row in root.findall(".//m:sheetData/m:row", NS):
                cells = {}
                for c in row.findall("m:c", NS):
                    ref = c.attrib["r"]
                    col = re.match(r"([A-Z]+)", ref).group(1)
                    t = c.attrib.get("t")
                    v = c.find("m:v", NS)
                    val = v.text if v is not None else None
                    if t == "s" and val is not None:
                        val = ss[int(val)]
                    elif t == "inlineStr":
                        is_el = c.find("m:is", NS)
                        val = (
                            "".join(
                                (x.text or "")
                                for x in is_el.iter(
                                    "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"
                                )
                            )
                            if is_el is not None
                            else ""
                        )
                    cells[col] = val
                if any(_clean(v) for v in cells.values()):
                    rows.append(cells)
            out[name] = rows
        return out


class Command(BaseCommand):
    help = "Import/sync the price schedule and insurance rates workbook into BillingService/PayerServiceCode."

    def add_arguments(self, parser):
        parser.add_argument(
            "--file",
            default=str(Path.home() / "Downloads/Price Schedule with Insurance Rates.xlsx"),
            help="Path to the price schedule workbook.",
        )
        parser.add_argument("--org", help="Organization slug or id. Defaults to all organizations.")
        parser.add_argument("--all-orgs", action="store_true", help="Import for all organizations.")
        parser.add_argument(
            "--dry-run", action="store_true", help="Parse and report, do not write."
        )
        parser.add_argument(
            "--update-existing",
            action="store_true",
            help="Update existing matched services/rates. Default fills missing fields and creates missing rows.",
        )

    def handle(self, *args, **options):
        path = Path(options["file"]).expanduser()
        if not path.exists():
            raise CommandError(f"Workbook not found: {path}")
        sheets = read_xlsx(path)
        orgs = self._orgs(options)
        if not orgs:
            raise CommandError("No organizations found.")
        for org in orgs:
            self._import_org(
                org, sheets, dry_run=options["dry_run"], update_existing=options["update_existing"]
            )

    def _orgs(self, options):
        qs = Organization.objects.all().order_by("name")
        if options.get("org"):
            val = options["org"]
            org = qs.filter(slug=val).first() or qs.filter(id=val).first()
            if not org:
                raise CommandError(f"Organization not found: {val}")
            return [org]
        return list(qs)

    def _import_org(self, org, sheets, dry_run, update_existing):
        created = updated = skipped = payer_upserts = 0
        with transaction.atomic():
            c, u, s = self._import_out_of_pocket(
                org, sheets.get("Out of pocket", []), dry_run, update_existing
            )
            created += c
            updated += u
            skipped += s
            for payer in ("CIC", "AAR"):
                pc, pu, ps = self._import_payer_sheet(
                    org, payer, sheets.get(payer, []), dry_run, update_existing
                )
                payer_upserts += pc + pu
                skipped += ps
            if dry_run:
                transaction.set_rollback(True)
        self.stdout.write(
            self.style.SUCCESS(
                f"[{org.name}] services created={created} updated={updated} skipped={skipped} payer_rate_upserts={payer_upserts} dry_run={dry_run}"
            )
        )

    def _match_service(self, org, code, name):
        qs = BillingService.objects.filter(organization=org)
        if code:
            by_code = qs.filter(code=code).first()
            if by_code:
                return by_code
        return qs.filter(name__iexact=name).first()

    def _import_out_of_pocket(self, org, rows, dry_run, update_existing):
        created = updated = skipped = 0
        for row in rows[1:]:  # header
            code = _clean(row.get("A"))
            category = _clean(row.get("B"))
            description = _clean(row.get("C"))
            if not category and not description:
                continue
            name = " ".join(description.split()) or code
            cost = _money(row.get("D"))
            markup = _percent(row.get("E"))
            tax = _percent(row.get("F"))
            sales = _money(row.get("G"))
            remarks = _clean(row.get("H"))
            medicine_name = ""
            mass = ""
            if category.strip().lower() == "medication":
                medicine_name, mass = split_medication(description)
                name = " ".join(part for part in [medicine_name, mass] if part) or name
            service = self._match_service(org, code, name)
            defaults = {
                "code": code,
                "category": category,
                "description": description,
                "medicine_name": medicine_name,
                "mass": mass,
                "cost": cost,
                "markup_percent": markup,
                "tax_percent": tax,
                "rate": sales,
                "remarks": remarks,
                "active": True,
            }
            if service is None:
                if not dry_run:
                    BillingService.objects.create(organization=org, name=name, **defaults)
                created += 1
                continue
            changed = False
            for field, value in defaults.items():
                old = getattr(service, field)
                if field == "active":
                    continue
                if update_existing:
                    if old != value:
                        setattr(service, field, value)
                        changed = True
                else:
                    if (old is None or old == "" or old == []) and value not in (None, ""):
                        setattr(service, field, value)
                        changed = True
            # Always sync name for medication rows when we have parsed name/mass.
            if service.is_medication and service.medicine_name:
                new_name = service.display_name
                if service.name != new_name and (update_existing or not service.name):
                    # avoid unique name collision
                    clash = (
                        BillingService.objects.filter(organization=org, name__iexact=new_name)
                        .exclude(pk=service.pk)
                        .exists()
                    )
                    if not clash:
                        service.name = new_name
                        changed = True
            if changed:
                if not dry_run:
                    service.save()
                updated += 1
            else:
                skipped += 1
        return created, updated, skipped

    def _import_payer_sheet(self, org, payer, rows, dry_run, update_existing):
        created = updated = skipped = 0
        for row in rows[1:]:
            service_name = _clean(row.get("B"))
            description = _clean(row.get("C"))
            cost = _money(row.get("D"))
            raw_cost = _clean(row.get("D"))
            if not service_name and not description:
                continue
            lookup_name = description or service_name
            service = BillingService.objects.filter(
                organization=org, name__iexact=lookup_name
            ).first()
            if service is None:
                service = BillingService.objects.filter(
                    organization=org, description__iexact=description
                ).first()
            if service is None:
                # Create a service shell so the payer rate is not lost.
                name = lookup_name
                defaults = {
                    "code": _clean(row.get("A")),
                    "category": service_name,
                    "description": description,
                    "active": True,
                }
                if dry_run:
                    service = None
                else:
                    service, was_created = BillingService.objects.get_or_create(
                        organization=org, name=name, defaults=defaults
                    )
                    if was_created:
                        created += 1
            if service is None:
                skipped += 1
                continue
            if cost is None and raw_cost.upper() not in {"FREE", "TBD"}:
                skipped += 1
                continue
            obj = ServicePayerCode.objects.filter(
                organization=org, service=service, payer=payer
            ).first()
            defaults = {"rate": cost, "payer_code": "", "active": True, "requires_preauth": False}
            if obj is None:
                if not dry_run:
                    ServicePayerCode.objects.create(
                        organization=org, service=service, payer=payer, **defaults
                    )
                created += 1
            else:
                changed = False
                if update_existing or obj.rate is None:
                    if obj.rate != cost:
                        obj.rate = cost
                        changed = True
                if changed:
                    if not dry_run:
                        obj.save(update_fields=["rate"])
                    updated += 1
                else:
                    skipped += 1
        return created, updated, skipped
