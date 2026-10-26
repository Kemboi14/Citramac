"""Finance role gating for billing, claims, pre-authorisation and payments.

Only members of `settings.FINANCE_ROLES` (default: Billing Clerk,
Cashier/Billing Clerk) may write. Every other authenticated member of the
organisation — clinicians included — may read. Roles are checked server-side
from `user.roles`, never from the JWT `role` claim.
"""

from django.conf import settings
from django.db.models import Q
from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.accounts.access import active_roles


def is_finance(user):
    if not (user and user.is_authenticated) or user.is_superuser:
        return False
    query = Q()
    for name in getattr(settings, "FINANCE_ROLES", []):
        query |= Q(name__iexact=name)
    return bool(query) and active_roles(user).filter(query).exists()


class IsFinanceOrReadOnly(BasePermission):
    message = "Only finance staff can create or change billing, claims and payments."

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        return request.method in SAFE_METHODS or is_finance(request.user)
