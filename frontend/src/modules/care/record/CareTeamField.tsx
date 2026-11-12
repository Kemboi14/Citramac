import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import { ApiError } from "../../../lib/apiClient";
import {
  addCareTeamMember,
  endCareTeamMember,
  getClientCareTeam,
  setCareCoordinator,
  type ClientCareTeam,
} from "../../../lib/carePathwayApi";

const DT = "text-[11px] font-semibold uppercase tracking-wide text-ink-500";
const SELECT =
  "rounded-[8px] border border-surface-border bg-surface-card px-2 py-1 text-[13px] disabled:opacity-60";

/**
 * Who looks after the client on the open episode: the care coordinator
 * (EpisodeOfCare.careManager — clinical staff set it) and the care team
 * (CareTeam.participant — a member sees the client's full mental-health content,
 * so only the Org Admin or an assigner adds or ends one, never for themselves).
 * People come from the organisation's clinical staff for the episode's branch.
 */
export function CareTeamField({
  patientId,
  onChanged,
}: {
  patientId: string;
  onChanged: () => void;
}) {
  const { accessToken } = useAuth();
  const [team, setTeam] = useState<ClientCareTeam | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [newMember, setNewMember] = useState({ user: "", role: "" });

  useEffect(() => {
    if (!accessToken) return;
    let live = true;
    getClientCareTeam(accessToken, patientId)
      .then((data) => live && setTeam(data))
      .catch((err) => {
        if (live)
          setError(err instanceof ApiError ? err.message : "The care team could not be loaded.");
      });
    return () => {
      live = false;
    };
  }, [accessToken, patientId]);

  const run = useCallback(
    (call: () => Promise<ClientCareTeam>, fallback: string, after?: () => void) => {
      setSaving(true);
      setError("");
      call()
        .then((data) => {
          setTeam(data);
          after?.();
          onChanged();
        })
        .catch((err) => setError(err instanceof ApiError ? err.message : fallback))
        .finally(() => setSaving(false));
    },
    [onChanged],
  );

  if (!team) {
    return error ? <p className="text-[12px] text-priority-red">{error}</p> : null;
  }
  const open = team.episode_id !== null;
  const memberChoices = team.staff.filter((p) => p.id !== team.current_user_id);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className={DT}>Care coordinator</div>
        <div className="mt-1 text-[13px] text-ink-900">
          {open && team.can_set_coordinator && accessToken ? (
            <select
              aria-label="Care coordinator"
              className={SELECT}
              value={team.coordinator?.id ?? ""}
              disabled={saving}
              onChange={(e) =>
                run(
                  () => setCareCoordinator(accessToken, patientId, e.target.value || null),
                  "The care coordinator could not be saved.",
                )
              }
            >
              <option value="">Not assigned</option>
              {team.coordinator && !team.staff.some((p) => p.id === team.coordinator?.id) && (
                <option value={team.coordinator.id}>{team.coordinator.name}</option>
              )}
              {team.staff.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            (team.coordinator?.name ?? <span className="text-ink-400">Not assigned</span>)
          )}
        </div>
      </div>

      <div>
        <div className={DT}>Care team</div>
        {team.members.length === 0 ? (
          <p className="mt-1 text-[13px] text-ink-400">No one is on the care team.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {team.members.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center gap-x-2 text-[13px] text-ink-900"
              >
                <span className="font-semibold">{m.name}</span>
                <span className="text-ink-500">{m.role_label}</span>
                {m.assigned_by && (
                  <span className="text-[12px] text-ink-400">added by {m.assigned_by}</span>
                )}
                {team.can_assign_team && accessToken && (
                  <button
                    type="button"
                    disabled={saving}
                    className="text-[12px] font-semibold text-brand-green hover:underline disabled:opacity-60"
                    onClick={() =>
                      run(
                        () => endCareTeamMember(accessToken, patientId, m.id),
                        "This member could not be removed.",
                      )
                    }
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {open && team.can_assign_team && accessToken && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              aria-label="Care team member"
              className={SELECT}
              value={newMember.user}
              disabled={saving}
              onChange={(e) => setNewMember((m) => ({ ...m, user: e.target.value }))}
            >
              <option value="">Choose staff…</option>
              {memberChoices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Care team role"
              className={SELECT}
              value={newMember.role}
              disabled={saving}
              onChange={(e) => setNewMember((m) => ({ ...m, role: e.target.value }))}
            >
              <option value="">Role…</option>
              {team.roles.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.display}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={saving || !newMember.user || !newMember.role}
              className="rounded-[8px] bg-brand-green px-3 py-1 text-[13px] font-semibold text-white disabled:opacity-50"
              onClick={() =>
                run(
                  () => addCareTeamMember(accessToken, patientId, newMember.user, newMember.role),
                  "The member could not be added.",
                  () => setNewMember({ user: "", role: "" }),
                )
              }
            >
              Add to team
            </button>
          </div>
        )}
        {open && team.can_assign_team && (
          <p className="mt-1 text-[12px] text-ink-400">
            A care-team member sees this client&rsquo;s full mental-health record.
          </p>
        )}
      </div>
      {error && <p className="text-[12px] text-priority-red">{error}</p>}
    </div>
  );
}
