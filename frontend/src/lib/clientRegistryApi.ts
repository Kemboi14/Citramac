import { apiRequest } from "./apiClient";
import type { PatientDetail } from "./clinicalApi";

// Mirrors `PatientViewSet.client_registry` (backend/apps/client_registry/views.py)
// over apps.dha_interop.registries — DHA's national Client Registry. Nothing the
// registry returns overwrites our record; confirming a match only adds a verified
// Client Registry ID slice. Nothing here touches browser storage (CLAUDE.md §5).

/** DHA's published identification types, offered exactly as given. */
export const IDENTIFICATION_TYPES = [
  "National ID",
  "ClientRegistry ID",
  "Birth Notification",
  "Birth Certificate",
  "Alien ID",
  "Refugee ID",
  "Mandate Number",
] as const;
export type IdentificationType = (typeof IDENTIFICATION_TYPES)[number];

export interface RegistryIdentification {
  identification_type: string;
  identification_number: string;
}

/** The registry's record, as summarised for the clerk to compare with ours. */
export interface ClientRegistryMatch extends RegistryIdentification {
  cr_id: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  /** Non-empty when the registry records the person as deceased. */
  deceased_datetime: string;
  other_identifications: RegistryIdentification[];
  /** How many dependants the registry lists — display only. */
  dependants: number;
  county: string;
  sub_county: string;
}

export interface ClientRegistrySearch {
  searched: RegistryIdentification;
  match: ClientRegistryMatch | null;
}

export interface ClientRegistryConfirmed extends ClientRegistrySearch {
  confirmed: true;
  patient: PatientDetail;
}

/** Search the registry — omit both fields to search with the client's own identifier. */
export function searchClientRegistry(
  accessToken: string,
  patientId: string,
  query: { identification_type?: string; identification_number?: string } = {},
) {
  return apiRequest<ClientRegistrySearch>(`/patients/${patientId}/client-registry/`, {
    method: "POST",
    body: query,
    accessToken,
  });
}

/** The clerk confirmed the match is this client: the server re-fetches it and adds the verified CR ID. */
export function confirmClientRegistryMatch(
  accessToken: string,
  patientId: string,
  match: { cr_id: string } & RegistryIdentification,
) {
  return apiRequest<ClientRegistryConfirmed>(`/patients/${patientId}/client-registry/`, {
    method: "POST",
    body: { confirm: true, ...match },
    accessToken,
  });
}
