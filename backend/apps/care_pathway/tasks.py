from celery import shared_task

from apps.tenancy.context import platform_admin_context


@shared_task
def sweep_legal_statuses():
    """LGL-WF-03 (hourly): involuntary statuses inside the review lead time become
    REVIEW_DUE with LEGAL_STATUS_EXPIRING; past maxExpiryAt without a recorded
    decision they become EXPIRED with LEGAL_STATUS_EXPIRED; a risk alert during a
    voluntary notice period prompts clinical review. Cross-tenant, like the other
    beat tasks."""
    from . import legal_status

    with platform_admin_context():
        legal_status.sweep_all()


@shared_task
def translate_psy_answer(note_id, question_key, digest):
    """Psychotherapy note: translate one Kiswahili / Sheng answer into English
    (AI assistance, psy_ai.py). Stored beside the original with provenance."""
    from . import psychotherapy

    psychotherapy.run_translation(note_id, question_key, digest)


@shared_task
def reword_psy_note(note_id, token):
    """Psychotherapy note: reword the organised sections in trauma-informed
    language (AI assistance). Failure leaves the rule-based text, logged."""
    from . import psychotherapy

    psychotherapy.run_reword(note_id, token)
