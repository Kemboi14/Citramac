"""
Who may do what, and at which branch — the request-time view of a tenant
user's RoleAssignments (apps.accounts.models.RoleAssignment).

- visible_branch_ids(user): the branches whose records the user may see, or
  None for every branch (Org Admin, or any organization-wide assignment).
- resolve_working_branch(): the branch the user is working in for this
  request, from the X-Branch-Id header — stamped on new branch-owned records
  and used to narrow both records and roles to that one branch.
- active_roles(user): the roles the user holds at the working branch. Role
  checks on a request path use this, not `user.roles` (the union across every
  branch), so a Nurse at one branch and Cashier at another can only bill at
  the second.

Outside a request (Celery, management commands) there is no working branch
and active_roles() is simply every role held.
"""

from django.db import transaction
from django.db.models import Q
from rest_framework.exceptions import PermissionDenied

from apps.tenancy.context import get_active_branch_id, get_branch_scope, platform_admin_context

ORG_ADMIN_ROLE = "Org Admin"
ALL_BRANCHES = "all"


def is_org_admin_role(role):
    return role.name.strip().lower() == ORG_ADMIN_ROLE.lower()


def _assignments(user):
    """Read regardless of the ambient tenant context — an empty result must
    mean "has none", never "RLS hid them" (which would read as org-wide)."""
    from .models import RoleAssignment

    with platform_admin_context():
        return list(RoleAssignment.all_objects.filter(user=user).select_related("role", "branch"))


def visible_branch_ids(user):
    """Branch ids this user may see, or None for every branch of their organization."""
    if user.is_superuser or not user.organization_id:
        return None
    assignments = _assignments(user)
    if not assignments:
        # An account created outside the assignment flow (fixtures, an old
        # import): its branch_access is all there is to go on.
        with platform_admin_context():
            legacy = {str(b) for b in user.branch_access.values_list("id", flat=True)}
        return legacy or None
    if any(a.branch_id is None or is_org_admin_role(a.role) for a in assignments):
        return None
    return {str(a.branch_id) for a in assignments}


def organization_branches(user):
    from apps.tenancy.models import Branch

    return Branch.all_objects.filter(organization_id=user.organization_id, is_active=True).order_by(
        "name"
    )


def branches_for(user):
    """The active Branch rows this user works at — every branch for an org-wide user."""
    branches = organization_branches(user)
    visible = visible_branch_ids(user)
    if visible is not None:
        branches = branches.filter(id__in=visible)
    return branches


def resolve_working_branch(user, requested):
    """
    (scope, working_branch_id) for this request. `requested` is the
    X-Branch-Id header: a branch id, "all" (org-wide users only), or empty
    for the default — the primary branch, else the only branch they have.
    """
    visible = visible_branch_ids(user)
    allowed = [str(b) for b in branches_for(user).values_list("id", flat=True)]

    if requested and requested != ALL_BRANCHES:
        if requested not in allowed:
            raise PermissionDenied("You don't have access to that branch.")
        return {requested}, requested
    if requested == ALL_BRANCHES:
        if visible is not None:
            raise PermissionDenied("Only an organisation-wide account can work across all branches.")
        return None, None

    default = None
    if user.primary_branch_id and str(user.primary_branch_id) in allowed:
        default = str(user.primary_branch_id)
    elif len(allowed) == 1:
        default = allowed[0]
    if default is not None:
        return (None if visible is None else {default}), default
    return visible, None


def active_roles(user):
    """Roles held at the working branch (every role held, outside a request)."""
    from .models import Role, RoleAssignment

    working = get_active_branch_id()
    if user.is_superuser or not user.organization_id or (
        working is None and get_branch_scope() is None
    ):
        return user.roles.all()
    if not RoleAssignment.all_objects.filter(user=user).exists():
        return user.roles.all()
    at_branch = Q(assignments__branch__isnull=True)
    if working is not None:
        at_branch |= Q(assignments__branch_id=working)
    else:
        at_branch |= Q(assignments__branch_id__in=list(get_branch_scope()))
    return Role.objects.filter(Q(assignments__user=user) & at_branch).distinct()


def has_active_role(user, *names):
    query = Q()
    for name in names:
        query |= Q(name__iexact=name)
    return active_roles(user).filter(query).exists()


def sync_role_cache(user):
    """Keep User.roles / User.branch_access equal to the union of the assignments."""
    assignments = _assignments(user)
    user.roles.set({a.role_id for a in assignments})
    user.branch_access.set({a.branch_id for a in assignments if a.branch_id})


@transaction.atomic
def set_assignments(user, pairs, created_by=None):
    """
    Replace a user's assignments with `pairs` [(Role, Branch|None)]. Org Admin
    is stored organization-wide whatever branch was asked for.
    """
    from .models import RoleAssignment

    wanted = set()
    for role, branch in pairs:
        wanted.add((role.id, None if is_org_admin_role(role) else getattr(branch, "id", None)))

    existing = {(a.role_id, a.branch_id): a for a in _assignments(user)}
    for key, assignment in existing.items():
        if key not in wanted:
            assignment.delete()
    for role_id, branch_id in wanted - set(existing):
        RoleAssignment.objects.create(
            organization_id=user.organization_id,
            user=user,
            role_id=role_id,
            branch_id=branch_id,
            created_by=created_by,
        )
    sync_role_cache(user)
    if user.primary_branch_id and not _may_use_branch(user, user.primary_branch_id):
        user.primary_branch = None
        user.save(update_fields=["primary_branch"])


def _may_use_branch(user, branch_id):
    visible = visible_branch_ids(user)
    return visible is None or str(branch_id) in visible
