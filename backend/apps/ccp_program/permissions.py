"""docs/07-CLINICAL-MODULES-SPEC.md §7.14.7 — elevated privacy tier for CCP records."""

from .models import CareTeamMembership


def has_full_ccp_access(user, patient):
    """
    True if `user` may see full session/assessment content for `patient`:
    a superuser, an assigned care-team member (therapist/supervisor) for
    that specific patient, or an Org Admin (logged access, per §7.14.7 —
    audit logging of the *view* itself is handled generically by
    apps.sysadmin_audit's signal-based audit trail on every read... note
    read/VIEW auditing beyond writes is a documented Phase 7 hardening item,
    see docs/09-SECURITY-COMPLIANCE.md §9.4's "sensitive record views" line).
    Everyone else in the org gets only "an active care episode exists."
    """
    if user.is_superuser:
        return True
    if user.roles.filter(name="Org Admin").exists():
        return True
    return CareTeamMembership.objects.filter(patient=patient, user=user).exists()
