"""
Section N tasks reach the person or team they were given to, in the topbar
bell (apps.notifications). A person is told directly; a team is each member
who holds that clinical role and can see the client's branch, so a branch they
cannot open never shows them the client's name. Whoever registered the tasks is
not told about their own action.

In-app only: no email or SMS, because the notice names the client and the
actions (apps.notifications.dispatch content rule).
"""

from apps.accounts.access import users_with_permission, visible_branch_ids
from apps.notifications.dispatch import notify
from apps.notifications.models import Notification

CODENAME = "clinical.care.record"


def recipients(te, *, assignee_id=None, team=""):
    staff = users_with_permission([CODENAME], te.organization_id)
    if assignee_id:
        return list(staff.filter(pk=assignee_id))
    if not team:
        return []
    branch_id = str(te.episode.branch_id) if te.episode_id and te.episode.branch_id else None
    out = []
    for user in staff.filter(roles__name=team):
        visible = visible_branch_ids(user)
        if visible is None or branch_id is None or branch_id in visible:
            out.append(user)
    return out


def tasks_assigned(te, tasks, by, *, assignee_id=None, team=""):
    """Tell the owner of newly registered triage tasks. Returns how many were told."""
    if not tasks:
        return 0
    people = [u for u in recipients(te, assignee_id=assignee_id, team=team) if u.pk != by.pk]
    if not people:
        return 0
    from .services import user_display

    actions = ", ".join(t.action_label for t in tasks)
    to = "you" if assignee_id else f"the {team} team"
    title = (
        f"Triage task assigned to {to}"
        if len(tasks) == 1
        else f"{len(tasks)} triage tasks assigned to {to}"
    )
    return notify(
        people,
        category=Notification.CATEGORY_CARE_TASK,
        title=title,
        body=f"{te.patient.get_full_name()}: {actions}. Assigned by {user_display(by)}.",
        dedupe_key=f"care-task:{tasks[0].pk}",
        organization_id=te.organization_id,
        link=f"/clinical/triage/{te.pk}",
    )
