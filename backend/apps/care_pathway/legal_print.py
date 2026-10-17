"""
Printable statutory forms (LGL-DOC-03): letterhead from the tenant asset
(Organization.logo_url), title block, statute line, numbered parts, filled
dotted-line fields, the FOR OFFICIAL USE ONLY rule, and a footer from the
facility profile with document ID/version and generation time (DOC-GOV-05).

A signed form prints from its frozen snapshot (`rendered`) — never re-rendered
from the current record — so the output is immutable after signing (AT-29). A
draft prints from the live record, watermarked DRAFT. Identity numbers are
always masked on print (LGL-DOC-06); the unmasked value is a separate, logged view.
"""

from django.utils import timezone
from django.utils.html import escape

from . import facility_time, legal_status
from .legal_models import (
    INVOLUNTARY_APPLICATION_TEMPLATE,
    NOTICE_TEMPLATE,
    RECOMMENDATION_TEMPLATE,
    VOLUNTARY_TEMPLATE,
)

CSS = """
body{font-family:"Times New Roman",Georgia,serif;color:#000;background:#fff;margin:0}
.page{max-width:760px;margin:24px auto;padding:32px 40px;position:relative}
.letterhead{text-align:center;border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:14px}
.letterhead img{max-height:80px;max-width:260px}
.org{font-size:18px;font-weight:bold;text-transform:uppercase;margin-top:4px}
.statute{text-align:center;font-weight:bold;font-size:13px;margin:6px 0}
h1{text-align:center;font-size:17px;text-decoration:underline;margin:8px 0 18px}
h2{font-size:14px;margin:18px 0 8px;text-transform:uppercase}
p{font-size:13.5px;line-height:1.7;margin:6px 0}
.dots{border-bottom:1px dotted #000;padding:0 6px;min-width:180px;display:inline-block;font-weight:bold}
.box{display:inline-block;width:12px;height:12px;border:1px solid #000;text-align:center;line-height:12px;font-size:11px;margin-right:6px}
.notice{border:2px solid #000;padding:10px 14px;margin:12px 0}
.official{border-top:3px double #000;margin-top:24px;padding-top:6px}
.official-title{text-align:center;font-weight:bold;letter-spacing:1px}
.narrative{font-size:12px;margin-left:24px;font-style:italic}
.footer{border-top:1px solid #000;margin-top:28px;padding-top:6px;font-size:10.5px;text-align:center;line-height:1.5}
.watermark{position:absolute;top:40%;left:0;right:0;text-align:center;font-size:64px;color:rgba(200,0,0,.15);transform:rotate(-20deg);pointer-events:none}
@media print{.page{margin:0;max-width:none}}
"""


def _dots(value):
    return f'<span class="dots">{escape(value or "") or "&nbsp;" * 30}</span>'


def _box(ticked):
    return f'<span class="box">{"✓" if ticked else "&nbsp;"}</span>'


def _when(iso):
    if not iso:
        return ""
    from datetime import datetime

    return facility_time.local_format(datetime.fromisoformat(iso), "%d/%m/%Y %H:%M")


def _official(ls, r, labels, document_template):
    """FOR OFFICIAL USE ONLY — the admitting officer's decision, from LegalStatus."""
    decided = ls.application_document_id == r.get("_doc_id") and ls.decision in ("ADMITTED", "REJECTED")
    if document_template == RECOMMENDATION_TEMPLATE:
        decided = ls.application_document_id == r.get("_application_id") and ls.decision in ("ADMITTED", "REJECTED")
    decision = ls.decision if decided else ""
    parts = [
        '<div class="official"><div class="official-title">FOR OFFICIAL USE ONLY</div>',
        f'<p>{_box(decision == "ADMITTED")}{escape(labels.get("admitted", "Admitted"))} &nbsp; '
        f'{_box(decision == "REJECTED")}{escape(labels.get("rejected", "Rejected"))}</p>',
    ]
    if document_template == RECOMMENDATION_TEMPLATE:
        parts.append(f'<p><em>{escape(labels.get("decisionMirror", ""))}</em></p>')
    else:
        if decision == "REJECTED":
            parts.append(f"<p>Reason: {_dots(ls.decision_reason)}</p>")
        parts.append(f'<p>{escape(labels.get("admittingOfficerName", ""))}: {_dots(legal_status._name(ls.decision_by) if decided else "")}</p>')
        parts.append(f'<p>{escape(labels.get("admittingOfficerSignature", ""))}: {_dots("Signed electronically" if decided else "")}</p>')
        date_label = labels.get("decisionDateTime") or labels.get("date", "Date")
        parts.append(f"<p>{escape(date_label)}: {_dots(facility_time.local_format(ls.decision_at, '%d/%m/%Y %H:%M') if decided else '')}</p>")
    parts.append("</div>")
    return "".join(parts)


def _signature_line(doc, label):
    if doc.status != "SIGNED":
        return f"<p>{escape(label)}: {_dots('')}</p>"
    how = "e-signature, witnessed by " + legal_status._name(doc.captured_by) if doc.signature_method == "ELECTRONIC" else "wet signature (scan on file)"
    return f"<p>{escape(label)}: {_dots(f'{doc.signer_name} — {how}')}</p>"


def render(doc, user):
    ls = doc.legal_status
    r = dict(doc.rendered) if doc.status == "SIGNED" and doc.rendered else legal_status.render_snapshot(doc)
    r["_doc_id"], r["_application_id"] = doc.pk, doc.application_id
    facility, labels, client = r["facility"], r.get("labels", {}), r["client"]
    body = []
    if doc.status != "SIGNED":
        body.append('<div class="watermark">DRAFT</div>')
    logo = f'<img src="{escape(facility["logo_url"])}" alt="">' if facility.get("logo_url") else ""
    body.append(f'<div class="letterhead">{logo}<div class="org">{escape(facility.get("name") or facility.get("organization", ""))}</div></div>')
    if r.get("statuteLine"):
        body.append(f'<div class="statute">{escape(r["statuteLine"])}</div>')
    body.append(f"<h1>{escape(r['title'])}</h1>")
    if doc.supersedes_id:
        body.append(f'<p><strong>Amended version {doc.version}.</strong> Reason: {escape(doc.amendment_reason)}</p>')

    if doc.template_id == VOLUNTARY_TEMPLATE:
        body.append(f"<p>{escape(r['explanatoryText'])}</p>")
        body.append(f'<div class="notice"><strong>{escape(r["noticeHeading"])}</strong><p>“{escape(r["noticeText"])}”</p>'
                    f'<p><em>({escape(r["noticePurpose"])})</em></p>'
                    f'<p>{_box(bool(doc.content.get("notice_acknowledged_at")))}{escape(r["noticeAcknowledgement"])} '
                    f'{escape(_when(doc.content.get("notice_acknowledged_at")))}</p></div>')
        body.append(f"<p>{escape(r['declaration'])}</p>")
        body.append(_signature_line(doc, labels.get("applicantSignature", "")))
        body.append(f'<p>{escape(labels.get("applicantSignatureDate", "Date"))}: {_dots(facility_time.local_format(doc.signed_at, "%d/%m/%Y %H:%M"))}</p>')
        body.append(_official(ls, r, labels, doc.template_id))
    elif doc.template_id == INVOLUNTARY_APPLICATION_TEMPLATE:
        parts = r["parts"]
        body.append(f"<h2>{escape(parts['A'])}</h2>")
        body.append(f"<p>1. {escape(labels['clientFullName'])}: {_dots(client['full_name'])}</p>")
        id_value = legal_status.mask(doc.patient.national_id or doc.patient.passport_number)
        body.append(f"<p>2. {escape(labels['clientIdNumber'])}: {_dots(id_value)}</p>")
        g = client.get("gender_form")
        body.append(f"<p>3. {escape(labels['clientGender'])}: {_box(g == 'MALE')}{escape(labels['genderMale'])} "
                    f"{_box(g == 'FEMALE')}{escape(labels['genderFemale'])} {_box(g == 'OTHER')}{escape(labels['genderOther'])} "
                    f"{_dots(client.get('gender_other_detail'))}</p>")
        body.append(f"<p>4. {escape(labels['clientIs'])}:</p>")
        for a in r["assertions"]:
            body.append(f"<p style='margin-left:24px'>{_box(a['ticked'])}{escape(a['text'])}</p>")
        if r.get("otherDescription"):
            body.append(f"<p style='margin-left:24px'>{_dots(r['otherDescription'])}</p>")
        ap = r.get("applicant") or {}
        body.append(f"<h2>{escape(parts['B'])}</h2>")
        body.append(f"<p>1. {escape(labels['applicantFullName'])}: {_dots(ap.get('name'))}</p>")
        person = doc.signer_related_person or (
            doc.patient.emergency_contacts.filter(pk=doc.content.get("applicant_related_person_id")).first()
            if doc.content.get("applicant_related_person_id") else None)
        body.append(f"<p>2. {escape(labels['applicantIdNumber'])}: {_dots(legal_status.mask(person.id_number) if person else '')}</p>")
        body.append(f"<p>3. {escape(labels['applicantAddress'])}: {_dots(ap.get('address'))}</p>")
        body.append(f"<p>4. {escape(labels['applicantPhone'])}: {_dots(ap.get('phone'))}</p>")
        rel = " — ".join(x for x in (ap.get("relationship"), ap.get("relationship_detail")) if x)
        body.append(f"<p>5. {escape(labels['applicantRelationship'])}: {_dots(rel)}</p>")
        body.append(f"<h2>{escape(parts['D'])}</h2><p>{escape(r['declaration'])}</p>")
        body.append(_signature_line(doc, labels["applicantSignature"]))
        body.append(f"<p>{escape(labels['date'])}: {_dots(facility_time.local_format(doc.signed_at, '%d/%m/%Y %H:%M'))}</p>")
        body.append(_official(ls, r, labels, doc.template_id))
    elif doc.template_id == RECOMMENDATION_TEMPLATE:
        body.append(f"<p>{escape(r['intro'])}</p>")
        for decl in r["declarations"]:
            lead = f"{escape(decl['lead'])}: " if decl.get("lead") else ""
            if decl.get("text"):
                body.append(f"<p>{decl['number']}. {lead}{escape(decl['text'])}</p>")
            else:
                body.append(f"<p>{decl['number']}.</p>")
            for gr in decl.get("grounds") or []:
                body.append(f"<p style='margin-left:24px'>{_box(gr['affirmed'])}({escape(gr['code'])}) {escape(gr['text'])}</p>")
                if gr.get("narrative"):
                    body.append(f"<p class='narrative'>{escape(labels.get('groundNarrative', ''))}: {escape(gr['narrative'])}</p>")
        cred = r.get("credential") or {}
        body.append(_signature_line(doc, labels["signature"]))
        body.append(f"<p>{escape(labels['qualifications'])}: {_dots(cred.get('qualifications'))}</p>")
        reg = cred.get("registration_number", "")
        if cred.get("registration_verified_at"):
            reg += f" (verified {_when(cred['registration_verified_at'])[:10]})"
        body.append(f"<p>{escape(labels['registration'])}: {_dots(reg)}</p>")
        body.append(f"<p>{escape(labels['date'])}: {_dots(facility_time.local_format(doc.signed_at, '%d/%m/%Y'))}</p>")
        body.append(_official(ls, r, labels, doc.template_id))
    elif doc.template_id == NOTICE_TEMPLATE:
        body.append(f'<div class="notice"><strong>{escape(r["noticeHeading"])}</strong><p>“{escape(r["noticeText"])}”</p></div>')
        body.append(f"<p>{escape(labels['clientStatement'])}: {_dots(r.get('statement') or 'Written notice on file (scan)')}</p>")
        body.append(f"<p>{escape(labels['givenAt'])}: {_dots(_when(r.get('givenAt')))}</p>")
        body.append(f"<p>{escape(labels['givenTo'])}: {_dots(r.get('givenTo'))}</p>")
        body.append(_signature_line(doc, labels["signature"]))

    footer_lines = [facility.get("name") or facility.get("organization", ""), facility.get("address", ""),
                    " · ".join(x for x in (facility.get("phone"), facility.get("email"), facility.get("website")) if x)]
    generated = facility_time.local_format(timezone.now(), "%Y-%m-%d %H:%M")
    status = "Signed" if doc.status == "SIGNED" else "DRAFT — not signed"
    footer_lines.append(f"Document {doc.document_number} · version {doc.version} · {status} · config {r.get('configVersion', '')} · generated {generated} by {legal_status._name(user)}")
    body.append('<div class="footer">' + "<br>".join(escape(x) for x in footer_lines if x) + "</div>")
    return (f"<!doctype html><html><head><meta charset='utf-8'><title>{escape(r['title'])}</title>"
            f"<style>{CSS}</style></head><body><div class='page'>{''.join(body)}</div></body></html>")
