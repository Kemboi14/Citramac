"""
Printable statutory forms (LGL-DOC-03) in the shared document layout
(apps.documents.printing): letterhead with the tenant's logo, title block, statute
line, numbered parts, filled dotted-line fields, the FOR OFFICIAL USE ONLY rule,
and on every page the document ID/version and page number (DOC-GOV-05).

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
    decided = ls.application_document_id == r.get("_doc_id") and ls.decision in (
        "ADMITTED",
        "REJECTED",
    )
    if document_template == RECOMMENDATION_TEMPLATE:
        decided = ls.application_document_id == r.get("_application_id") and ls.decision in (
            "ADMITTED",
            "REJECTED",
        )
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
        parts.append(
            f'<p>{escape(labels.get("admittingOfficerName", ""))}: {_dots(legal_status._name(ls.decision_by) if decided else "")}</p>'
        )
        parts.append(
            f'<p>{escape(labels.get("admittingOfficerSignature", ""))}: {_dots("Signed electronically" if decided else "")}</p>'
        )
        date_label = labels.get("decisionDateTime") or labels.get("date", "Date")
        parts.append(
            f"<p>{escape(date_label)}: {_dots(facility_time.local_format(ls.decision_at, '%d/%m/%Y %H:%M') if decided else '')}</p>"
        )
    parts.append("</div>")
    return "".join(parts)


def _signature_line(doc, label):
    if doc.status != "SIGNED":
        return f"<p>{escape(label)}: {_dots('')}</p>"
    how = (
        "e-signature, witnessed by " + legal_status._name(doc.captured_by)
        if doc.signature_method == "ELECTRONIC"
        else "wet signature (scan on file)"
    )
    return f"<p>{escape(label)}: {_dots(f'{doc.signer_name} — {how}')}</p>"


def render(doc, user):
    ls = doc.legal_status
    r = (
        dict(doc.rendered)
        if doc.status == "SIGNED" and doc.rendered
        else legal_status.render_snapshot(doc)
    )
    r["_doc_id"], r["_application_id"] = doc.pk, doc.application_id
    facility, labels, client = r["facility"], r.get("labels", {}), r["client"]
    body = []
    if r.get("statuteLine"):
        body.append(f'<div class="statute">{escape(r["statuteLine"])}</div>')
    if doc.supersedes_id:
        body.append(
            f"<p><strong>Amended version {doc.version}.</strong> Reason: {escape(doc.amendment_reason)}</p>"
        )

    if doc.template_id == VOLUNTARY_TEMPLATE:
        body.append(f"<p>{escape(r['explanatoryText'])}</p>")
        body.append(
            f'<div class="notice"><strong>{escape(r["noticeHeading"])}</strong><p>“{escape(r["noticeText"])}”</p>'
            f'<p><em>({escape(r["noticePurpose"])})</em></p>'
            f'<p>{_box(bool(doc.content.get("notice_acknowledged_at")))}{escape(r["noticeAcknowledgement"])} '
            f'{escape(_when(doc.content.get("notice_acknowledged_at")))}</p></div>'
        )
        body.append(f"<p>{escape(r['declaration'])}</p>")
        body.append(_signature_line(doc, labels.get("applicantSignature", "")))
        body.append(
            f'<p>{escape(labels.get("applicantSignatureDate", "Date"))}: {_dots(facility_time.local_format(doc.signed_at, "%d/%m/%Y %H:%M"))}</p>'
        )
        body.append(_official(ls, r, labels, doc.template_id))
    elif doc.template_id == INVOLUNTARY_APPLICATION_TEMPLATE:
        parts = r["parts"]
        body.append(f"<h2>{escape(parts['A'])}</h2>")
        body.append(f"<p>1. {escape(labels['clientFullName'])}: {_dots(client['full_name'])}</p>")
        id_value = legal_status.mask(doc.patient.national_id or doc.patient.passport_number)
        body.append(f"<p>2. {escape(labels['clientIdNumber'])}: {_dots(id_value)}</p>")
        g = client.get("gender_form")
        body.append(
            f"<p>3. {escape(labels['clientGender'])}: {_box(g == 'MALE')}{escape(labels['genderMale'])} "
            f"{_box(g == 'FEMALE')}{escape(labels['genderFemale'])} {_box(g == 'OTHER')}{escape(labels['genderOther'])} "
            f"{_dots(client.get('gender_other_detail'))}</p>"
        )
        body.append(f"<p>4. {escape(labels['clientIs'])}:</p>")
        for a in r["assertions"]:
            body.append(f"<p style='margin-left:24px'>{_box(a['ticked'])}{escape(a['text'])}</p>")
        if r.get("otherDescription"):
            body.append(f"<p style='margin-left:24px'>{_dots(r['otherDescription'])}</p>")
        ap = r.get("applicant") or {}
        body.append(f"<h2>{escape(parts['B'])}</h2>")
        body.append(f"<p>1. {escape(labels['applicantFullName'])}: {_dots(ap.get('name'))}</p>")
        person = doc.signer_related_person or (
            doc.patient.emergency_contacts.filter(
                pk=doc.content.get("applicant_related_person_id")
            ).first()
            if doc.content.get("applicant_related_person_id")
            else None
        )
        body.append(
            f"<p>2. {escape(labels['applicantIdNumber'])}: {_dots(legal_status.mask(person.id_number) if person else '')}</p>"
        )
        body.append(f"<p>3. {escape(labels['applicantAddress'])}: {_dots(ap.get('address'))}</p>")
        body.append(f"<p>4. {escape(labels['applicantPhone'])}: {_dots(ap.get('phone'))}</p>")
        rel = " — ".join(x for x in (ap.get("relationship"), ap.get("relationship_detail")) if x)
        body.append(f"<p>5. {escape(labels['applicantRelationship'])}: {_dots(rel)}</p>")
        body.append(f"<h2>{escape(parts['D'])}</h2><p>{escape(r['declaration'])}</p>")
        body.append(_signature_line(doc, labels["applicantSignature"]))
        body.append(
            f"<p>{escape(labels['date'])}: {_dots(facility_time.local_format(doc.signed_at, '%d/%m/%Y %H:%M'))}</p>"
        )
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
                body.append(
                    f"<p style='margin-left:24px'>{_box(gr['affirmed'])}({escape(gr['code'])}) {escape(gr['text'])}</p>"
                )
                if gr.get("narrative"):
                    body.append(
                        f"<p class='narrative'>{escape(labels.get('groundNarrative', ''))}: {escape(gr['narrative'])}</p>"
                    )
        cred = r.get("credential") or {}
        body.append(_signature_line(doc, labels["signature"]))
        body.append(
            f"<p>{escape(labels['qualifications'])}: {_dots(cred.get('qualifications'))}</p>"
        )
        reg = cred.get("registration_number", "")
        if cred.get("registration_verified_at"):
            reg += f" (verified {_when(cred['registration_verified_at'])[:10]})"
        body.append(f"<p>{escape(labels['registration'])}: {_dots(reg)}</p>")
        body.append(
            f"<p>{escape(labels['date'])}: {_dots(facility_time.local_format(doc.signed_at, '%d/%m/%Y'))}</p>"
        )
        body.append(_official(ls, r, labels, doc.template_id))
    elif doc.template_id == NOTICE_TEMPLATE:
        body.append(
            f'<div class="notice"><strong>{escape(r["noticeHeading"])}</strong><p>“{escape(r["noticeText"])}”</p></div>'
        )
        body.append(
            f"<p>{escape(labels['clientStatement'])}: {_dots(r.get('statement') or 'Written notice on file (scan)')}</p>"
        )
        body.append(f"<p>{escape(labels['givenAt'])}: {_dots(_when(r.get('givenAt')))}</p>")
        body.append(f"<p>{escape(labels['givenTo'])}: {_dots(r.get('givenTo'))}</p>")
        body.append(_signature_line(doc, labels["signature"]))

    from django.utils.safestring import mark_safe

    from apps.documents import printing

    signed = doc.status == "SIGNED"
    episode = ls.episode if ls and ls.episode_id else None
    branch = episode.branch if episode and episode.branch_id else None
    organization = doc.patient.organization
    context = {
        "title": r["title"],
        "letterhead": printing.letterhead(
            organization, branch or printing.default_branch(organization), facility
        ),
        "meta": [
            ("Document no.", f"{doc.document_number} v{doc.version}"),
            ("Date", facility_time.local_format(doc.signed_at or timezone.now(), "%d %b %Y")),
            ("Status", "Signed" if signed else "Draft — not signed"),
        ],
        "watermark": "" if signed else "Draft — not signed",
        "watermark_short": "DRAFT",
        # Every value in `body` went through escape() above; the parts are fixed markup.
        "form_body": mark_safe("".join(body)),  # nosec B308 B703 — escaped above
        "config_version": r.get("configVersion", ""),
        "printed_by": legal_status._name(user),
    }
    return printing.render("documents/print/legal_form.html", context)
