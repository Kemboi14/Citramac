"""
Each organisation owns its roles.

An organisation starts with its own copy of every standard role in
apps.accounts.catalogue.ORGANISATION_ROLES (legacy ones excepted), made when
the organisation is created. Its Org Admin may rename a copy (except the locked
administrator roles), change its permissions and add custom roles; nothing an
organisation does to its roles reaches any other organisation.

The organization=None rows are only the starting definitions. Their permissions
are what a new organisation's copy starts with.
"""

from django.db import transaction

from apps.tenancy.context import platform_admin_context

from .catalogue import ORGANISATION_ROLES, RESERVED_ROLE_NAMES

LEGACY_KEYS = {key for key, _, _, _, legacy in ORGANISATION_ROLES if legacy}


def _definition(key):
    from .models import Role

    return Role.objects.filter(
        organization__isnull=True, scope=Role.SCOPE_ORG_TEMPLATE, system_key=key
    ).first()


def _copy(organization, definition):
    from .models import Role

    role = Role.objects.filter(organization=organization, system_key=definition.system_key).first()
    if role is not None:
        return role
    # The organisation already made a role with this name: that one becomes its
    # copy, keeping whatever permissions it was given.
    role = Role.objects.filter(
        organization=organization, name__iexact=definition.name, system_key=""
    ).first()
    if role is not None:
        role.system_key = definition.system_key
        role.save(update_fields=["system_key", "updated_at"])
        return role
    role = Role.objects.create(
        organization=organization,
        name=definition.name,
        scope=Role.SCOPE_ORG_TEMPLATE,
        description=definition.description,
        system_key=definition.system_key,
    )
    role.permissions.set(definition.permissions.all())
    return role


@transaction.atomic
def provision_organization_roles(organization):
    """Give the organisation its own copy of each standard role it lacks. Safe to repeat."""
    from .models import Role

    with platform_admin_context():
        definitions = Role.objects.filter(
            organization__isnull=True, scope=Role.SCOPE_ORG_TEMPLATE
        ).exclude(system_key="")
        return [_copy(organization, d) for d in definitions if d.system_key not in LEGACY_KEYS]


def organization_role(organization, key):
    """The organisation's own role for a standard key (made on first use), or None."""
    from .models import Role

    with platform_admin_context():
        role = Role.objects.filter(organization=organization, system_key=key).first()
        if role is not None:
            return role
        definition = _definition(key)
        return _copy(organization, definition) if definition else None


def own_role(organization, role):
    """
    The role as this organisation holds it. A standard definition
    (organization=None) stands for the organisation's own copy of it, so an
    older client that sends a definition's id still lands on the right role.
    """
    from .models import Role

    if role.organization_id is None and role.scope == Role.SCOPE_ORG_TEMPLATE and role.system_key:
        return organization_role(organization, role.system_key)
    return role


def organization_role_named(organization, name):
    """The organisation's active role with this name (case-insensitive), or the
    organisation's copy of the standard role of that name, or None."""
    from .models import Role

    with platform_admin_context():
        role = Role.objects.filter(
            organization=organization, name__iexact=name.strip(), is_active=True
        ).first()
        if role is not None:
            return role
        definition = (
            Role.objects.filter(
                organization__isnull=True, scope=Role.SCOPE_ORG_TEMPLATE, name__iexact=name.strip()
            )
            .exclude(system_key="")
            .first()
        )
        return organization_role(organization, definition.system_key) if definition else None


def name_problem(name, organization_id, exclude_id=None):
    """Why this role name can't be used in the organisation (or platform), or None."""
    from .models import Role

    cleaned = (name or "").strip()
    if not cleaned:
        return "Give the role a name."
    if cleaned.lower() in RESERVED_ROLE_NAMES:
        return f"“{cleaned}” is the name of a built-in administrator role. Choose another name."
    with platform_admin_context():
        clash = Role.objects.filter(organization_id=organization_id, name__iexact=cleaned)
        if organization_id is None:
            clash = clash.filter(scope=Role.SCOPE_PLATFORM)
        if exclude_id is not None:
            clash = clash.exclude(pk=exclude_id)
        if clash.exists():
            return f"There is already a role called “{cleaned}”."
    return None
