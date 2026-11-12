"""
Who is looking after a client (owner decisions 2026-11-12).

Two things, both organisational data, never clinical content:

- **Care coordinator** — FHIR R4 ``EpisodeOfCare.careManager`` on the open
  episode (``EpisodeOfCare.care_manager``). Set by clinical staff
  (``clinical.care.record``). It opens nothing extra: it names who coordinates,
  puts the client on that person's caseload, and is the responsible clinician on
  the banner unless the client is admitted under a consultant.
- **Care team** — FHIR R4 ``CareTeam.participant`` (member, role, period), the
  open episode's ``EpisodeOfCare.team``. Stored as
  ``mhp_program.CareTeamMembership``. A member sees the client's full MHP
  content (``has_full_mhp_access``), so only the Org Admin or a holder of
  ``clinical.care_team.assign`` adds or ends a member, and nobody adds
  themselves. A member is ended, never deleted.

People are chosen from the organisation's clinical staff who can open the
episode's branch (task_assignees.people_at_branch), the same drop-down as triage
tasks. Every change is audited: the episode and membership rows by the model
audit signals, and one ``CARE_TEAM_*`` event naming who, what and why.

VERIFY: SNOMED CT codes for ``CareTeam.participant.role``. Until confirmed the
role is a local code (``ROLE_CHOICES``) with its display text; nothing is emitted.
"""

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.access import has_permission, is_org_admin
from apps.mhp_program.models import CareTeamMembership
from apps.sysadmin_audit.audit import write_event
from apps.sysadmin_audit.models import AuditLogEntry

from . import services, task_assignees
from .services import StateConflict, user_display

CARE = "clinical.care.record"
ASSIGN = "clinical.care_team.assign"
ROLE_LABELS = dict(CareTeamMembership.ROLE_CHOICES)
OPEN_TASK_STATUSES = ("INITIATED", "PENDING")


def can_set_coordinator(user):
    return has_permission(user, CARE) or is_org_admin(user)


def can_assign_team(user):
    return has_permission(user, ASSIGN) or is_org_admin(user)


def require_team_assigner(user):
    if not can_assign_team(user):
        raise PermissionDenied(
            "Only the Org Admin or staff allowed to assign care teams can change a "
            "client's care team."
        )


def _audit(patient, event, detail):
    write_event(
        patient.organization_id,
        AuditLogEntry.ACTION_UPDATE,
        "client_registry.patient",
        patient.id,
        {"event": event, **detail},
    )


def _open_episode(patient):
    episode = services.open_episode_for(patient)
    if episode is None:
        raise StateConflict("This client has no open episode of care.")
    return episode


def _staff(patient, episode):
    return task_assignees.people_at_branch(patient.organization_id, episode.branch_id)


def _pick(patient, episode, user_id, field):
    wanted = str(user_id or "").strip()
    person = next((p for p in _staff(patient, episode) if p["id"] == wanted), None)
    if person is None:
        raise ValidationError({field: "Choose a member of the clinical staff from the list."})
    return person


def active_members(patient):
    return (
        CareTeamMembership.objects.filter(patient=patient, ended_at__isnull=True)
        .select_related("user", "assigned_by")
        .order_by("assigned_at")
    )


def _member_row(membership):
    return {
        "id": str(membership.id),
        "user_id": str(membership.user_id),
        "name": user_display(membership.user),
        "role": membership.role,
        "role_label": membership.get_role_display(),
        "assigned_at": membership.assigned_at.isoformat(),
        "assigned_by": user_display(membership.assigned_by),
    }


def care_team_for(user, patient):
    """The care coordinator and team, with the choices this user may make."""
    episode = services.open_episode_for(patient)
    coordinator = episode.care_manager if episode else None
    may_coordinate = bool(episode) and can_set_coordinator(user)
    may_assign = bool(episode) and can_assign_team(user)
    return {
        "episode_id": str(episode.id) if episode else None,
        "coordinator": (
            {"id": str(coordinator.pk), "name": user_display(coordinator)} if coordinator else None
        ),
        "members": [_member_row(m) for m in active_members(patient)],
        "roles": [{"code": c, "display": d} for c, d in CareTeamMembership.ROLE_CHOICES],
        "can_set_coordinator": may_coordinate,
        "can_assign_team": may_assign,
        "current_user_id": str(user.pk),
        "staff": _staff(patient, episode) if episode and (may_coordinate or may_assign) else [],
    }


@transaction.atomic
def set_coordinator(user, patient, user_id):
    """Name (or clear, with an empty id) the open episode's care coordinator."""
    if not can_set_coordinator(user):
        raise PermissionDenied("Only clinical staff can set a client's care coordinator.")
    episode = _open_episode(patient)
    person = _pick(patient, episode, user_id, "coordinator") if user_id else None
    new_id = person["id"] if person else None
    old_id = str(episode.care_manager_id) if episode.care_manager_id else None
    if new_id != old_id:
        episode.care_manager_id = new_id
        episode.save(update_fields=["care_manager", "updated_at"])
        _audit(
            patient,
            "CARE_COORDINATOR_SET",
            {"episode": str(episode.id), "from": old_id, "to": new_id},
        )
    return episode


@transaction.atomic
def add_member(user, patient, user_id, role):
    require_team_assigner(user)
    episode = _open_episode(patient)
    if role not in ROLE_LABELS:
        raise ValidationError({"role": "Choose the member's role from the list."})
    person = _pick(patient, episode, user_id, "user")
    if person["id"] == str(user.pk) and not is_org_admin(user):
        raise PermissionDenied("You can't add yourself to a client's care team.")
    if active_members(patient).filter(user_id=person["id"], role=role).exists():
        raise ValidationError({"user": f"{person['name']} is already on the team in that role."})
    membership = CareTeamMembership.objects.create(
        organization_id=patient.organization_id,
        patient=patient,
        user_id=person["id"],
        role=role,
        assigned_by=user,
    )
    _audit(
        patient,
        "CARE_TEAM_MEMBER_ADDED",
        {"membership": str(membership.id), "member": person["id"], "role": role},
    )
    return membership


@transaction.atomic
def end_member(user, patient, membership_id):
    require_team_assigner(user)
    membership = (
        active_members(patient).select_for_update(of=("self",)).filter(pk=membership_id).first()
    )
    if membership is None:
        raise ValidationError({"membership": "This person is no longer on the client's team."})
    membership.ended_at = timezone.now()
    membership.ended_by = user
    membership.save(update_fields=["ended_at", "ended_by"])
    _audit(
        patient,
        "CARE_TEAM_MEMBER_ENDED",
        {
            "membership": str(membership.id),
            "member": str(membership.user_id),
            "role": membership.role,
        },
    )
    return membership


def banner_summary(patient, episode, admission):
    """Responsible clinician, care team and open tasks for the safety banner.

    The responsible clinician is the consultant while the client is admitted
    under one, else the open episode's care coordinator, else the registered
    doctor. The team is the active care team, else an admission's team name."""
    from .models import CareTask

    open_episode = episode if episode and not episode.period_end else None
    if admission and admission.consultant_id:
        clinician, clinician_role = admission.consultant, "Consultant"
    elif open_episode and open_episode.care_manager_id:
        clinician, clinician_role = open_episode.care_manager, "Care coordinator"
    elif patient.doctor_id:
        clinician, clinician_role = patient.doctor, "Registered doctor"
    else:
        clinician, clinician_role = None, ""
    members = [
        {"name": user_display(m.user), "role_label": m.get_role_display()}
        for m in active_members(patient)
    ]
    team = ", ".join(f"{m['name']} ({m['role_label']})" for m in members) or (
        admission.primary_care_team if admission else ""
    )
    return {
        "clinician": user_display(clinician) or "Unassigned",
        "clinician_role": clinician_role,
        "team": team,
        "care_team": members,
        "open_tasks": CareTask.objects.filter(
            patient=patient, status__in=OPEN_TASK_STATUSES
        ).count(),
    }
