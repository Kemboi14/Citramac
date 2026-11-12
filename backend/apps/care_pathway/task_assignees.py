"""
Who a triage task can be assigned to: a named member of the organisation's
clinical staff, picked from a drop-down. Every triage task has one, whether
the clinician ticked it in Section N or the signature raised it (owner rule,
2026-11-10: "every task must have an assignee from drop down"). No team and no
free text: a task given to a team or typed as a name has no one who knows
it is theirs.

People are the staff Org Admin already maintains (Staff, Roles & Permissions)
who hold `clinical.care.record`, never a list of our own. With a triage
encounter, only staff who can open its branch are offered, so assigning a task
never shows a client's name to someone outside the branch.
"""

from apps.accounts.access import users_with_permission, visible_branch_ids

CODENAME = "clinical.care.record"


def _branch_id(triage_encounter):
    if triage_encounter is None or not triage_encounter.episode_id:
        return None
    branch = triage_encounter.episode.branch_id
    return str(branch) if branch else None


def people(organization_id, triage_encounter=None):
    """[{"id", "name"}] — the clinical staff a task can be assigned to."""
    return people_at_branch(organization_id, _branch_id(triage_encounter))


def people_at_branch(organization_id, branch_id=None):
    """[{"id", "name"}] — clinical staff who can open `branch_id` (any branch when
    None). Also the care coordinator and care-team pickers (care_team.py)."""
    from .services import user_display

    branch_id = str(branch_id) if branch_id else None
    staff = users_with_permission([CODENAME], organization_id).order_by("first_name", "last_name")
    out = []
    for user in staff:
        visible = visible_branch_ids(user)
        if branch_id is None or visible is None or branch_id in visible:
            out.append({"id": str(user.pk), "name": user_display(user)})
    return out


def resolve(organization_id, triage_encounter, user_id):
    """The {"id", "name"} for `user_id` if they can be assigned, else None."""
    wanted = str(user_id or "").strip()
    if not wanted:
        return None
    return next((p for p in people(organization_id, triage_encounter) if p["id"] == wanted), None)
