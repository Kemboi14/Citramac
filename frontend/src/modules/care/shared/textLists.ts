// Bulleted / numbered list editing for plain-text clinical fields (first used in the intake).

export type ListKind = "bullet" | "numbered";
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
