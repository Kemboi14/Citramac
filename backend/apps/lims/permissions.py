"""docs/07-CLINICAL-MODULES-SPEC.md §7.4 — QC/validation gate before results publish."""


def can_see_unvalidated_results(user):
    if user.is_superuser:
        return True
    return user.roles.filter(name__in=["Lab Technician", "Auditor"]).exists()
