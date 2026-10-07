import type { CarePlanActivity } from "../../../lib/carePathwayApi";

/** Care plan activities in documented order — "Goal N" follows this order. */
export function orderedActivities(activities: CarePlanActivity[]) {
  return [...activities].sort((a, b) => a.created_at.localeCompare(b.created_at));
}
