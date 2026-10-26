"""docs/07-CLINICAL-MODULES-SPEC.md §7.4 — QC/validation gate before results publish."""

from apps.accounts.access import active_roles


def can_see_unvalidated_results(user):
    if user.is_superuser:
        return True
    return active_roles(user).filter(name__in=["Lab Technician", "Auditor"]).exists()
