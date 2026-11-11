import { AutoResizeTextarea } from "../../shared/AutoResizeTextarea";

/** The intake's schema text field: the system text area bound to a string value. */
export function ListTextarea({
  id,
  rows,
  value,
  onChange,
  required,
  className = "",
}: {
  id?: string;
  rows: number;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  className?: string;
}) {
  return (
    <AutoResizeTextarea
      id={id}
      rows={rows}
      className={className}
      value={value}
      required={required}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
