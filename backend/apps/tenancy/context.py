"""
Thread-local tenant context + the Postgres session variables the Row-Level
Security policies key off. See docs/04-MULTI-TENANCY.md §4.2 — isolation is
enforced at the application layer (TenantScopedManager, via the thread-local
here) AND the database layer (RLS policies, via the Postgres GUCs set here)
so a bug in one layer alone can't leak cross-tenant rows.
"""

import threading
from contextlib import contextmanager

from django.db import connection

_state = threading.local()


def get_current_organization_id():
    return getattr(_state, "organization_id", None)


def is_platform_admin_context():
    return getattr(_state, "is_platform_admin", False)


def _set_db_session_vars(organization_id, is_platform_admin):
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT set_config('app.current_org_id', %s, false), "
            "set_config('app.is_platform_admin', %s, false)",
            [
                str(organization_id) if organization_id else "",
                "true" if is_platform_admin else "false",
            ],
        )


def set_tenant_context(organization_id=None, is_platform_admin=False):
    """Bind the current thread + DB session to a tenant (or platform-admin/no tenant)."""
    _state.organization_id = organization_id
    _state.is_platform_admin = is_platform_admin
    _set_db_session_vars(organization_id, is_platform_admin)


def clear_tenant_context():
    set_tenant_context(organization_id=None, is_platform_admin=False)
    clear_branch_scope()


# ── Branch scope (within one organization) ──
#
# Set per request by apps.accounts.authentication from the user's role
# assignments and the branch they are working in (X-Branch-Id). `None` means
# every branch of the organization — Org Admin, an org-wide assignment, and
# every non-request caller (Celery, management commands). Kept apart from
# set_tenant_context() so platform_admin_context() leaves it untouched.


def get_branch_scope():
    """Branch ids this request may see, or None for every branch."""
    return getattr(_state, "branch_ids", None)


def get_active_branch_id():
    """The branch this request is working in — stamped on new branch-owned records."""
    return getattr(_state, "active_branch_id", None)


def set_branch_scope(branch_ids, active_branch_id=None):
    _state.branch_ids = frozenset(str(b) for b in branch_ids) if branch_ids is not None else None
    _state.active_branch_id = str(active_branch_id) if active_branch_id else None


def clear_branch_scope():
    set_branch_scope(None, None)


@contextmanager
def platform_admin_context():
    """
    Narrow, explicit escape hatch for legitimate cross-tenant DB access:
    the pre-authentication steps of the auth flow (looking up a User by
    email/activation token, before their organization is known) and
    Super-Admin-only platform operations. Bypasses tenant scoping at both
    the ORM layer and the RLS layer for its duration, then restores
    whatever context was active before it.
    """
    previous_org = get_current_organization_id()
    previous_admin = is_platform_admin_context()
    set_tenant_context(organization_id=None, is_platform_admin=True)
    try:
        yield
    finally:
        set_tenant_context(organization_id=previous_org, is_platform_admin=previous_admin)
