import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ClientSearchBox } from "../clinical/ClientSearchBox";
import { usePatientContext } from "../clinical/usePatientContext";
import { clientRecordPath } from "../modules/care/shared/recordRoutes";

/**
 * The clinical workspace's topbar search: find a client from anywhere and open
 * their record. Ctrl+K (⌘K on a Mac) jumps to it from any screen.
 */
export function GlobalClientSearch() {
  const navigate = useNavigate();
  const { selectPatient } = usePatientContext();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <ClientSearchBox
      tone="brand"
      inputRef={inputRef}
      label="Search clients"
      placeholder="Search clients…  Ctrl+K"
      onChoose={(client) => {
        selectPatient(client.id, client.name || "Temporary client");
        navigate(clientRecordPath(client.id, "snapshot"));
      }}
    />
  );
}
