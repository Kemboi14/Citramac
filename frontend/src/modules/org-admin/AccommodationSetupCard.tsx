import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  ROOM_CLASS_OPTIONS,
  createAccommodationType,
  createRoom,
  listAccommodationTypes,
  listRooms,
  updateAccommodationType,
  updateRoom,
  type AccommodationType,
  type Room,
  type RoomClass,
} from "../../lib/ipdApi";
import { StatusPill } from "../care/shared/ui";
import { allPages } from "./allPages";

const CARD_CLASS = "rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm";
const FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green";
const SMALL_FIELD_CLASS =
  "rounded-sm border border-surface-border bg-surface-card px-2 py-1 text-sm text-ink-900 outline-none focus:border-brand-green";
const LABEL_CLASS = "flex flex-col gap-1.5 text-sm font-medium text-ink-700";
const BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-md bg-brand-green px-4 py-2 text-sm font-semibold text-on-primary shadow-sm hover:bg-brand-green-dark disabled:opacity-60 transition-colors duration-150";
const TH = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-500";
const TD = "px-3 py-2 text-sm text-ink-700";

/**
 * Org Admin — accommodation types and the rooms of the selected ward.
 * Each type's class (private room / shared room / ward bay / unclassified) is
 * how CITRAMAC's subscription counts a room of that type; a room is counted
 * by its own type. A room with no type, or a type with no class, is shown as
 * Unclassified on the Subscription page and not charged. Bed-day prices are
 * set on the Service Tariff page, not here.
 */
export function AccommodationSetupCard({
  wardId,
  wardName,
}: {
  wardId: string | null;
  wardName: string | null;
}) {
  const { accessToken } = useAuth();
  const [types, setTypes] = useState<AccommodationType[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newType, setNewType] = useState("");
  const [newRoom, setNewRoom] = useState<{ name: string; type: string }>({ name: "", type: "" });

  const loadTypes = async () => {
    if (!accessToken) return;
    const res = await listAccommodationTypes(accessToken);
    setTypes(res.results);
  };

  const loadRooms = async (ward: string) => {
    if (!accessToken) return;
    const res = await allPages((page) => listRooms(accessToken, ward, page));
    setRooms(res.results);
  };

  useEffect(() => {
    if (!accessToken) return;
    void Promise.resolve()
      .then(() => loadTypes())
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't load accommodation types."),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || !wardId) {
      // Local-state reset on selection change, not an external sync.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRooms([]);
      return;
    }
    loadRooms(wardId).catch((err) =>
      setError(err instanceof ApiError ? err.message : "Couldn't load rooms."),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, wardId]);

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const setClass = (kind: AccommodationType, roomClass: RoomClass) =>
    run(async () => {
      if (!accessToken) return;
      const updated = await updateAccommodationType(accessToken, kind.id, {
        room_class: roomClass,
      });
      setTypes((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    }, "Couldn't change the class.");

  const addType = (event: React.FormEvent) => {
    event.preventDefault();
    const name = newType.trim();
    if (!name) return;
    void run(async () => {
      if (!accessToken) return;
      await createAccommodationType(accessToken, name);
      setNewType("");
      await loadTypes();
    }, "Couldn't add the accommodation type.");
  };

  const setRoomType = (room: Room, typeId: string) =>
    run(async () => {
      if (!accessToken || !wardId) return;
      await updateRoom(accessToken, room.id, { accommodation_type: typeId || null });
      await Promise.all([loadRooms(wardId), loadTypes()]);
    }, "Couldn't change the room's type.");

  const addRoom = (event: React.FormEvent) => {
    event.preventDefault();
    const name = newRoom.name.trim();
    if (!name || !wardId) return;
    void run(async () => {
      if (!accessToken) return;
      await createRoom(accessToken, {
        ward: wardId,
        name,
        accommodation_type: newRoom.type || null,
      });
      setNewRoom({ name: "", type: "" });
      await Promise.all([loadRooms(wardId), loadTypes()]);
    }, "Couldn't add the room.");
  };

  const activeTypes = types.filter((t) => t.active);
  const typeById = new Map(types.map((t) => [t.id, t]));

  return (
    <div className={CARD_CLASS}>
      <h2 className="mb-1 font-display text-base font-semibold text-ink-900">
        Accommodation types and rooms
      </h2>
      <p className="mb-4 text-sm text-ink-500">
        The class of each type is how your CITRAMAC subscription counts its rooms. A room with no
        type, or whose type has no class, is listed as Unclassified on the Subscription page and is
        not charged. Bed-day prices are set on the Service Tariff page.
      </p>

      {error && (
        <p className="mb-4 rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
          {error}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-surface-border">
            <tr>
              <th className={TH}>Type</th>
              <th className={TH}>Subscription class</th>
              <th className={`${TH} text-right`}>Rooms</th>
              <th className={`${TH} text-right`}>Beds</th>
              <th className={TH}>Bed-day rate</th>
            </tr>
          </thead>
          <tbody>
            {types.map((kind) => (
              <tr key={kind.id} className="border-b border-surface-border last:border-0">
                <td className={TD}>
                  <span className="font-medium text-ink-900">{kind.name}</span>
                  {!kind.active && (
                    <StatusPill tone="neutral" className="ml-2">
                      Retired
                    </StatusPill>
                  )}
                </td>
                <td className={TD}>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className={SMALL_FIELD_CLASS}
                      aria-label={`Subscription class for ${kind.name}`}
                      value={kind.room_class}
                      disabled={busy}
                      onChange={(e) => void setClass(kind, e.target.value as RoomClass)}
                    >
                      {ROOM_CLASS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {kind.room_class === "" && <StatusPill tone="warning">Unclassified</StatusPill>}
                  </div>
                </td>
                <td className={`${TD} text-right`}>{kind.room_count}</td>
                <td className={`${TD} text-right`}>{kind.bed_count}</td>
                <td className={TD}>
                  {kind.rate === null ? "No rate configured" : `KES ${kind.rate}`}
                </td>
              </tr>
            ))}
            {types.length === 0 && (
              <tr>
                <td colSpan={5} className={`${TD} text-ink-500`}>
                  No accommodation types yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form onSubmit={addType} className="mt-4 flex flex-wrap items-end gap-3">
        <label className={LABEL_CLASS}>
          New accommodation type
          <input
            className={FIELD_CLASS}
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            placeholder="e.g. Private suite"
          />
        </label>
        <button type="submit" disabled={busy || !newType.trim()} className={BUTTON_CLASS}>
          <Plus size={14} />
          Add type
        </button>
      </form>

      <div className="mt-6 border-t border-surface-border pt-4">
        <h3 className="mb-3 font-display text-sm font-semibold text-ink-900">
          Rooms{wardName ? ` in ${wardName}` : ""}
        </h3>
        {!wardId ? (
          <p className="text-sm text-ink-500">Select a ward to see its rooms.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-surface-border">
                  <tr>
                    <th className={TH}>Room</th>
                    <th className={TH}>Accommodation type</th>
                    <th className={TH}>Counted as</th>
                    <th className={`${TH} text-right`}>Beds</th>
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((room) => {
                    const kind = room.accommodation_type
                      ? typeById.get(room.accommodation_type)
                      : undefined;
                    return (
                      <tr key={room.id} className="border-b border-surface-border last:border-0">
                        <td className={`${TD} font-medium text-ink-900`}>{room.name}</td>
                        <td className={TD}>
                          <select
                            className={SMALL_FIELD_CLASS}
                            aria-label={`Accommodation type for room ${room.name}`}
                            value={room.accommodation_type ?? ""}
                            disabled={busy}
                            onChange={(e) => void setRoomType(room, e.target.value)}
                          >
                            <option value="">No type</option>
                            {types
                              .filter((t) => t.active || t.id === room.accommodation_type)
                              .map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td className={TD}>
                          {kind && kind.room_class !== "" ? (
                            kind.room_class_label
                          ) : (
                            <StatusPill tone="warning">Unclassified</StatusPill>
                          )}
                        </td>
                        <td className={`${TD} text-right`}>{room.bed_count}</td>
                      </tr>
                    );
                  })}
                  {rooms.length === 0 && (
                    <tr>
                      <td colSpan={4} className={`${TD} text-ink-500`}>
                        No rooms in this ward. Beds can also sit directly in the ward.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <form onSubmit={addRoom} className="mt-4 flex flex-wrap items-end gap-3">
              <label className={LABEL_CLASS}>
                New room
                <input
                  className={FIELD_CLASS}
                  value={newRoom.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setNewRoom((prev) => ({ ...prev, name }));
                  }}
                  placeholder="e.g. Room 4"
                />
              </label>
              <label className={LABEL_CLASS}>
                Accommodation type
                <select
                  className={FIELD_CLASS}
                  value={newRoom.type}
                  onChange={(e) => {
                    const type = e.target.value;
                    setNewRoom((prev) => ({ ...prev, type }));
                  }}
                >
                  <option value="">No type</option>
                  {activeTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={busy || !newRoom.name.trim()}
                className={BUTTON_CLASS}
              >
                <Plus size={14} />
                Add room
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
