import { useEffect, useState } from "react";
import { useAuth } from "../../../auth/useAuth";
import { getDocumentCatalogue, type Catalogue } from "../../../lib/documentsApi";

// The full catalogue (categories, data-class names, recipient labels), loaded
// once per page session and held in memory only — never browser storage.
let cache: Catalogue | null = null;

export function useDocCatalogue() {
  const { accessToken } = useAuth();
  const [catalogue, setCatalogue] = useState<Catalogue | null>(cache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cache || !accessToken) return;
    let cancelled = false;
    getDocumentCatalogue(accessToken)
      .then((data) => {
        cache = data;
        if (!cancelled) setCatalogue(data);
      })
      .catch(() => !cancelled && setError("Couldn't load the document catalogue."));
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const className = (code: string) =>
    catalogue?.data_classes.find((c) => c.code === code)?.name ?? code;
  const recipientLabel = (code: string) =>
    Object.entries(catalogue?.recipient_types ?? {}).find(([c]) => c === code)?.[1] ?? code;
  return { catalogue, error, className, recipientLabel };
}
