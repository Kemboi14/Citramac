"""Facility price schedule workbook → tariff lines and insurer rates
(guide.md 2026-11-26; command `import_price_schedule`).

The workbook has an "Out of pocket" sheet (Code, Service, Description, Cost,
Markup(%), Tax %, Sales Price, Remarks) and one sheet per insurer, named for
the insurer (CIC, AAR: Code, Service, Description, Cost). Each insurer sheet
becomes one of the organisation's own insurers. Owner decisions of 2026-11-26:

- Workbook codes are not identities: the sheet reuses some for different items.
  A code is stored only when exactly one row carries it; a reused code is left
  blank and reported.
- A line is identified by its description (a medication by name + strength).
  When the same description appears under different Service headings (e.g.
  "Individual session" in person, virtual and at 7,500), each is its own line,
  named "<description> — <Service>". The same item listed twice at the same
  price is one line; at different prices it is a conflict, imported for neither,
  and reported for the owner to resolve.
- A row with no Sales Price is imported unpriced (its Cost kept as reference),
  never priced from its Cost.
- An insurer row that names a cash line gets that insurer's rate on it.
  Otherwise it becomes an insurer-only line "<Service> — <Description>" with no
  cash price. "Free" is a rate of 0; "TBD" is left unpriced and reported.

Nothing here touches the database; `plan()` returns what the command applies.
"""

import re
import zipfile
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

from defusedxml import ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
_T = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"
_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"

CASH_SHEET = "Out of pocket"
NAME_MAX = 150  # BillingService.name / ClaimLine.service_name

MASS_RE = re.compile(
    r"(\d+(?:\.\d+)?\s*(?:mcg|mg|g|kg|ml|l|iu|%)(?:\s*/\s*\d+(?:\.\d+)?\s*(?:mcg|mg|g|kg|ml|l|iu|%))?"
    r"|\d+\s*(?:tabs?|capsules?|caps?|sachets?|ampoules?|vials?|patch(?:es)?|box(?:es)?|packs?)"
    r"|\d+\s*'\s*s\b)",
    re.I,
)
# A price cell: an optional "KES", one number with optional thousands
# separators, then optionally a bracketed note ("210,000 (Inclusive of NHIF)").
MONEY_RE = re.compile(r"^(?:KES|KSH|KSHS)?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(\(.*\))?$", re.I)


def clean(value):
    """Cell text on one line, inner whitespace collapsed."""
    if value is None:
        return ""
    return " ".join(str(value).split())


def parse_money(value):
    """(amount, note, problem). A cell that is not exactly one plain amount is
    never guessed at: "1,500 pp", "plus mileage" and the like are problems."""
    text = clean(value)
    if not text:
        return None, "", ""
    upper = text.upper()
    if upper == "FREE":
        return Decimal("0"), "", ""
    if upper == "TBD":
        return None, "", "price to be decided (TBD)"
    match = MONEY_RE.match(text)
    if not match:
        return None, "", f"price not understood: {text!r}"
    try:
        amount = Decimal(match.group(1).replace(",", "") + (match.group(2) or ""))
    except InvalidOperation:
        return None, "", f"price not understood: {text!r}"
    note = (match.group(3) or "").strip("() ")
    return amount, note, ""


def parse_percent(value):
    text = clean(value).replace("%", "")
    if not text:
        return None
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def parse_code(value):
    """Workbook codes arrive as numbers ("12" or "12.0"); stored as "12"."""
    text = clean(value)
    if re.fullmatch(r"\d+\.0+", text):
        text = text.split(".")[0]
    return text


def split_medication(description):
    """("Olanzapine", "5mg") from "Olanzapine 5mg"; (description, "") when no strength."""
    text = clean(description)
    if not text:
        return "", ""
    match = MASS_RE.search(text)
    if not match:
        return text, ""
    name = text[: match.start()].strip(" -/,")
    mass = text[match.start() :].strip(" -/,")
    if name.count("(") > name.count(")"):
        name = name.rstrip(" (")
    if mass.count(")") > mass.count("("):
        mass = mass.rstrip(" )")
    return name or text, mass


def fit_name(text):
    """A line name within BillingService.name; the full text stays in description."""
    if len(text) <= NAME_MAX:
        return text
    cut = text[: NAME_MAX - 1].rsplit(" ", 1)[0].rstrip(" ,;-—")
    return cut + "…"


def read_xlsx(path):
    """{sheet name: [{column letter: cell text}]} for every non-empty row."""
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", NS):
                shared.append("".join((t.text or "") for t in si.iter(_T)))
        workbook = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        targets = {r.attrib["Id"]: r.attrib["Target"] for r in rels}
        out = {}
        for sheet in workbook.findall("m:sheets/m:sheet", NS):
            target = targets[sheet.attrib[_REL]]
            target = target.lstrip("/") if target.startswith("/") else "xl/" + target
            root = ET.fromstring(z.read(target))
            rows = []
            for row in root.findall(".//m:sheetData/m:row", NS):
                cells = {}
                for c in row.findall("m:c", NS):
                    col = re.match(r"([A-Z]+)", c.attrib["r"]).group(1)
                    kind = c.attrib.get("t")
                    v = c.find("m:v", NS)
                    val = v.text if v is not None else None
                    if kind == "s" and val is not None:
                        val = shared[int(val)]
                    elif kind == "inlineStr":
                        inline = c.find("m:is", NS)
                        val = (
                            "".join((t.text or "") for t in inline.iter(_T))
                            if inline is not None
                            else ""
                        )
                    cells[col] = val
                if any(clean(v) for v in cells.values()):
                    rows.append(cells)
            out[sheet.attrib["name"]] = rows
        return out


@dataclass
class Line:
    """One tariff line to create or fill (BillingService)."""

    name: str
    category: str
    description: str
    code: str = ""
    medicine_name: str = ""
    mass: str = ""
    cost: Decimal | None = None
    markup_percent: Decimal | None = None
    tax_percent: Decimal | None = None
    rate: Decimal | None = None
    remarks: str = ""
    rows: list = field(default_factory=list)  # workbook row numbers, for reports


@dataclass
class InsurerRate:
    payer: str
    line_name: str
    rate: Decimal
    row: int


@dataclass
class Plan:
    lines: list = field(default_factory=list)
    insurer_rates: list = field(default_factory=list)
    issues: list = field(default_factory=list)  # (sheet, row, message)


def _out_of_pocket(rows, plan):
    parsed = []
    for number, row in enumerate(rows[1:], start=2):  # row 1 is the header
        category = clean(row.get("B"))
        description = clean(row.get("C"))
        if not category and not description:
            continue
        medicine_name = mass = ""
        base = description or category
        if category.lower() == "medication":
            medicine_name, mass = split_medication(description)
            base = " ".join(p for p in (medicine_name, mass) if p) or base
        cost, _, cost_problem = parse_money(row.get("D"))
        sales, sales_note, sales_problem = parse_money(row.get("G"))
        if cost_problem and clean(row.get("D")):
            plan.issues.append(("Out of pocket", number, f"Cost {cost_problem}"))
        if sales_problem:
            plan.issues.append(("Out of pocket", number, f"Sales Price {sales_problem}"))
        elif sales is None:
            plan.issues.append(
                ("Out of pocket", number, f"{base}: no Sales Price — imported unpriced")
            )
        remarks = "; ".join(p for p in (clean(row.get("H")), sales_note) if p)
        parsed.append(
            {
                "row": number,
                "code": parse_code(row.get("A")),
                "category": category,
                "description": description,
                "base": base,
                "medicine_name": medicine_name,
                "mass": mass,
                "cost": cost,
                "markup": parse_percent(row.get("E")),
                "tax": parse_percent(row.get("F")),
                "rate": sales,
                "remarks": remarks,
            }
        )

    code_count = {}
    for p in parsed:
        if p["code"]:
            code_count.setdefault(p["code"], []).append(p["row"])
    for code, numbers in code_count.items():
        if len(numbers) > 1:
            plan.issues.append(
                (
                    "Out of pocket",
                    numbers[0],
                    f"Code {code} is used on rows {', '.join(map(str, numbers))} for "
                    "different items — stored on none of them",
                )
            )

    categories_by_base = {}
    for p in parsed:
        categories_by_base.setdefault(p["base"].lower(), set()).add(p["category"].lower())

    by_name = {}
    for p in parsed:
        name = p["base"]
        if len(categories_by_base[name.lower()]) > 1 and p["category"]:
            name = f"{name} — {p['category']}"
        by_name.setdefault(fit_name(name).lower(), []).append((fit_name(name), p))

    for group in by_name.values():
        name, first = group[0]
        prices = {p["rate"] for _, p in group}
        numbers = [p["row"] for _, p in group]
        if len(prices) > 1:
            shown = ", ".join(
                f"row {p['row']}: {p['rate'] if p['rate'] is not None else 'no price'}"
                for _, p in group
            )
            plan.issues.append(
                (
                    "Out of pocket",
                    numbers[0],
                    f"{name} is listed at different prices ({shown}) — not imported; "
                    "set its price on the Service Tariff page",
                )
            )
            continue
        if len(group) > 1:
            plan.issues.append(
                (
                    "Out of pocket",
                    numbers[0],
                    f"{name} is listed {len(group)} times at the same price (rows "
                    f"{', '.join(map(str, numbers))}) — imported once",
                )
            )
        code = first["code"] if len(code_count.get(first["code"], [])) == 1 else ""
        plan.lines.append(
            Line(
                name=name,
                category=first["category"],
                description=first["description"],
                code=code if len(group) == 1 else "",
                medicine_name=first["medicine_name"],
                mass=first["mass"],
                cost=first["cost"],
                markup_percent=first["markup"],
                tax_percent=first["tax"],
                rate=first["rate"],
                remarks=first["remarks"],
                rows=numbers,
            )
        )


def _insurer(payer, rows, plan):
    known = {line.name.lower(): line for line in plan.lines}
    by_description = {}
    for line in plan.lines:
        if line.description:
            by_description.setdefault(line.description.lower(), []).append(line)
    seen = {}
    for number, row in enumerate(rows[1:], start=2):
        service = clean(row.get("B"))
        description = clean(row.get("C"))
        if not service and not description:
            continue
        rate, note, problem = parse_money(row.get("D"))
        label = description or service
        if problem:
            plan.issues.append((payer, number, f"{label}: {problem} — no {payer} rate set"))
            continue
        if rate is None:
            plan.issues.append((payer, number, f"{label}: no price — no {payer} rate set"))
            continue
        target = known.get(description.lower())
        if target is None and len(by_description.get(description.lower(), [])) == 1:
            target = by_description[description.lower()][0]
        if target is None:
            full = f"{service} — {description}" if service and description else label
            name = fit_name(full)
            target = known.get(name.lower())
            if target is None:
                target = Line(
                    name=name,
                    category=service,
                    description=full if len(full) > NAME_MAX else description,
                    remarks="",
                    rows=[],
                )
                plan.lines.append(target)
                known[name.lower()] = target
            remark = f"{payer} tariff" + (f" ({note})" if note else "")
            target.remarks = "; ".join(p for p in (target.remarks, remark) if p)
        previous = seen.get(target.name.lower())
        if previous is not None:
            if previous.rate != rate:
                plan.issues.append(
                    (
                        payer,
                        number,
                        f"{target.name} has two {payer} rates (rows {previous.row}, {number}: "
                        f"{previous.rate}, {rate}) — no {payer} rate set",
                    )
                )
                if previous in plan.insurer_rates:
                    plan.insurer_rates.remove(previous)
            continue
        entry = InsurerRate(payer=payer, line_name=target.name, rate=rate, row=number)
        seen[target.name.lower()] = entry
        plan.insurer_rates.append(entry)


def plan(sheets):
    """What the workbook asks for, and every row it could not take as written."""
    result = Plan()
    if "Out of pocket" not in sheets:
        result.issues.append(("Out of pocket", 0, "sheet not found"))
    _out_of_pocket(sheets.get("Out of pocket", []), result)
    # Every other sheet is one insurer's rates, named by the sheet (CIC, AAR, …).
    for payer, rows in sheets.items():
        if payer != CASH_SHEET and " ".join(payer.split()):
            _insurer(" ".join(payer.split()), rows, result)
    return result
