"""Finance role gating for billing, claims, pre-authorisation and payments.

Only roles with the finance.manage permission may write. Every other
authenticated member of the organisation — clinicians included — may read.
Checked server-side from the roles held, never from the JWT `role` claim.
"""

from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.accounts.access import has_permission


def is_finance(user):
    return has_permission(user, "finance.manage")


class IsFinanceOrReadOnly(BasePermission):
    message = "Only finance staff can create or change billing, claims and payments."

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        return request.method in SAFE_METHODS or is_finance(request.user)
