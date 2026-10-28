"""docs/07-CLINICAL-MODULES-SPEC.md §7.4 — QC/validation gate before results publish."""

from apps.accounts.access import has_permission


def can_see_unvalidated_results(user):
    if user.is_superuser:
        return True
    return has_permission(user, "laboratory.results.unvalidated.view")
