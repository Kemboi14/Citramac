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
