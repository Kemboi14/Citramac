import { ChevronDown, List, ListOrdered } from "lucide-react";
import { useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from "react";
import { AutoResizeTextarea } from "../../shared/AutoResizeTextarea";
import { BTN_GHOST, INPUT } from "../../shared/styles";

type ListKind = "bullet" | "numbered";
type ListMarker = { indent: string; marker: string; spacing: string; kind: ListKind };

function listMarker(line: string): ListMarker | null {
  const match = line.match(/^([ \t]*)([•*-]|\d+\.)([ \t]+)/);
  if (!match) return null;
  return {
    indent: match[1],
    marker: match[2],
    spacing: match[3],
    kind: /^\d/.test(match[2]) ? "numbered" : "bullet",
  };
}

export function continueListOnEnter(value: string, start: number, end: number) {
  if (start !== end) return null;
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const lineEndIndex = value.indexOf("\n", start);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const line = value.slice(lineStart, lineEnd);
  const marker = listMarker(line);
  if (!marker) return null;

  const markerEnd = lineStart + marker.indent.length + marker.marker.length + marker.spacing.length;
  const lineContent = line.slice(markerEnd - lineStart);
  if (!lineContent.trim()) {
    const nextValue = value.slice(0, lineStart) + marker.indent + value.slice(lineEnd);
    const caret = lineStart + marker.indent.length;
    return { value: nextValue, selectionStart: caret, selectionEnd: caret };
  }

  const nextMarker =
    marker.kind === "numbered" ? `${Number.parseInt(marker.marker, 10) + 1}.` : marker.marker;
  const insertion = `\n${marker.indent}${nextMarker} `;
  const nextValue = value.slice(0, start) + insertion + value.slice(end);
  const caret = start + insertion.length;
  return { value: nextValue, selectionStart: caret, selectionEnd: caret };
}

export function formatSelectedLines(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  kind: ListKind,
) {
  const blockStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
  const lastSelected = selectionEnd > selectionStart ? selectionEnd - 1 : selectionStart;
  const nextNewline = value.indexOf("\n", lastSelected);
  const blockEnd = nextNewline === -1 ? value.length : nextNewline;
  const lines = value.slice(blockStart, blockEnd).split("\n");
  const nonEmpty = lines.filter((line) => line.trim());
  const removeList =
    nonEmpty.length > 0 && nonEmpty.every((line) => listMarker(line)?.kind === kind);
  let number = 0;
  const formatted = lines
    .map((line) => {
      if (!line.trim()) return line;
      const indent = line.match(/^[ \t]*/)?.[0] ?? "";
      const body = line.slice(indent.length).replace(/^(?:[•*-]|\d+\.)[ \t]+/, "");
      if (removeList) return `${indent}${body}`;
      number += 1;
      return `${indent}${kind === "bullet" ? "•" : `${number}.`} ${body}`;
    })
    .join("\n");
  const nextValue = `${value.slice(0, blockStart)}${formatted}${value.slice(blockEnd)}`;
  if (selectionStart === selectionEnd) {
    const indentLength = lines[0].match(/^[ \t]*/)?.[0].length ?? 0;
    const caret = blockStart + indentLength + (removeList ? 0 : kind === "bullet" ? 2 : 3);
    return { value: nextValue, selectionStart: caret, selectionEnd: caret };
  }
  return {
    value: nextValue,
    selectionStart: blockStart,
    selectionEnd: blockStart + formatted.length,
  };
}

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [active, setActive] = useState(false);

  function applyList(kind: ListKind) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const result = formatSelectedLines(value, textarea.selectionStart, textarea.selectionEnd, kind);
    onChange(result.value);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  }

  const keepSelection = (event: MouseEvent<HTMLButtonElement>) => event.preventDefault();
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setActive(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    const textarea = event.currentTarget;
    const result = continueListOnEnter(value, textarea.selectionStart, textarea.selectionEnd);
    if (!result) return;
    event.preventDefault();
    onChange(result.value);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  };

  return (
    <div
      className="flex w-full max-w-4xl flex-col items-start gap-1"
      onFocusCapture={() => setActive(true)}
      onBlurCapture={handleBlur}
    >
      {active && (
        <div role="toolbar" aria-label="Text list formatting" className="flex items-center gap-1">
          <button
            type="button"
            className={`${BTN_GHOST} !min-h-8 !gap-1 !px-2 !py-1`}
            aria-label="Toggle bulleted list"
            title="Toggle bulleted list"
            onMouseDown={keepSelection}
            onClick={() => applyList("bullet")}
          >
            <List aria-hidden="true" className="h-4 w-4" />
            <ChevronDown aria-hidden="true" className="h-3 w-3" />
          </button>
          <button
            type="button"
            className={`${BTN_GHOST} !min-h-8 !gap-1 !px-2 !py-1`}
            aria-label="Toggle numbered list"
            title="Toggle numbered list"
            onMouseDown={keepSelection}
            onClick={() => applyList("numbered")}
          >
            <ListOrdered aria-hidden="true" className="h-4 w-4" />
            <ChevronDown aria-hidden="true" className="h-3 w-3" />
          </button>
        </div>
      )}
      <AutoResizeTextarea
        ref={textareaRef}
        id={id}
        rows={rows}
        className={`${INPUT} !rounded-none w-full max-w-4xl resize-y ${className}`}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
