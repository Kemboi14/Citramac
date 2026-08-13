"""
Thread-local request context for audit attribution — same pattern as
apps.tenancy.context, and for the same reason: model signals (where audit
entries actually get written, see signals.py) have no access to the current
HttpRequest, so the actor/source_ip/request_id have to be stashed somewhere
signal handlers can reach them.
"""

import threading

_state = threading.local()


def set_audit_request_meta(source_ip=None, request_id=None):
    _state.source_ip = source_ip
    _state.request_id = request_id


def set_audit_actor(user):
    _state.actor_user_id = str(user.pk) if user is not None else None
    _state.actor_role = _describe_role(user)
    _state.actor_branch_id = (
        str(user.primary_branch_id) if getattr(user, "primary_branch_id", None) else None
    )


def get_audit_context():
    return {
        "actor_user_id": getattr(_state, "actor_user_id", None),
        "actor_role": getattr(_state, "actor_role", ""),
        "actor_branch_id": getattr(_state, "actor_branch_id", None),
        "source_ip": getattr(_state, "source_ip", None),
        "request_id": getattr(_state, "request_id", ""),
    }


def clear_audit_context():
    for attr in ("actor_user_id", "actor_role", "actor_branch_id", "source_ip", "request_id"):
        if hasattr(_state, attr):
            delattr(_state, attr)


def _describe_role(user):
    if user is None or not getattr(user, "is_authenticated", False):
        return ""
    if user.is_superuser:
        return "Super Admin"
    role_names = list(user.roles.values_list("name", flat=True)[:1])
    return role_names[0] if role_names else ""
