"""Who may make a clinical record (2026-11-08).

Most clinical writes checked only `require_current_licence`, which blocks an
expired licence but lets through anyone with no licence requirement at all
(front desk, billing). These record or change clinical content, so they need
the role permission the catalogue already defines for it.
"""

import functools

from rest_framework.exceptions import PermissionDenied

from apps.accounts.access import has_permission

CARE = "clinical.care.record"
PRESCRIBE = "clinical.medication.prescribe"

MESSAGES = {
    CARE: "Only clinical staff can record this.",
    PRESCRIBE: "Only a prescriber can record this.",
}


def require(user, codename=CARE):
    """`codename` is one permission, or a tuple of which any one is enough."""
    codenames = codename if isinstance(codename, tuple) else (codename,)
    if user.is_superuser or any(has_permission(user, c) for c in codenames):
        return
    raise PermissionDenied(MESSAGES.get(codename, "You don't have permission to do this."))


def clinical_only(codename=CARE):
    """Decorator for an APIView method: the requester must hold `codename`."""

    def wrap(method):
        @functools.wraps(method)
        def inner(self, request, *args, **kwargs):
            require(request.user, codename)
            return method(self, request, *args, **kwargs)

        return inner

    return wrap
