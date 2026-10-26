"""
TenantScopedManager/QuerySet — automatically filters every ORM query on a
tenant-scoped model by organization_id, per docs/04-MULTI-TENANCY.md §4.2.

Fails closed: with no tenant bound and no platform-admin context active, a
query returns nothing rather than everything. `Manager.unscoped()` is the
one sanctioned bypass for code that is explicitly, narrowly cross-tenant
(the pre-auth lookups in apps.accounts, Celery tasks operating on a known
org_id, admin tooling) — pair it with `apps.tenancy.context.platform_admin_context()`
so the database-level RLS bypass matches the ORM-level one.

Branch scope: a model that declares `branch_scope_path` (e.g. "branch" or
"episode__branch") is further narrowed to the branches the request may see
(apps.tenancy.context.get_branch_scope). Rows whose path resolves to no
branch at all — records made before branches were stamped, or not tied to
an episode — stay visible across the organization.
"""

from django.db import models
from django.db.models import Q

from .context import get_branch_scope, get_current_organization_id, is_platform_admin_context


class TenantScopedQuerySet(models.QuerySet):
    def _apply_scope(self):
        if is_platform_admin_context():
            return self
        organization_id = get_current_organization_id()
        if organization_id is None:
            return self.none()
        queryset = self.filter(organization_id=organization_id)
        paths = getattr(self.model, "branch_scope_path", None)
        branch_ids = get_branch_scope()
        if paths and branch_ids is not None:
            visible = Q()
            unbranched = Q()
            for path in paths:
                visible |= Q(**{f"{path}__in": list(branch_ids)})
                unbranched &= Q(**{f"{path}__isnull": True})
            queryset = queryset.filter(visible | unbranched)
        return queryset


class TenantScopedManager(models.Manager):
    def get_queryset(self):
        return TenantScopedQuerySet(self.model, using=self._db)._apply_scope()

    def unscoped(self):
        """Explicit, code-level cross-tenant queryset — see module docstring."""
        return TenantScopedQuerySet(self.model, using=self._db)
