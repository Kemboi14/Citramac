// Printable statement (INS-08) and invoice for the client record's Billing
// stage. Built with textContent only — no HTML string is ever interpolated.

const PRINT_CSS = `
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; margin: 24px; font-size: 12px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #444; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border-bottom: 1px solid #ccc; padding: 4px 6px; text-align: left; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 3px 12px; margin: 16px 0 0; }
  dt { font-weight: 600; color: #333; }
  dd { margin: 0; }
`;

export interface PrintDocument {
  title: string;
  meta: string[];
  columns: { label: string; numeric?: boolean }[];
  rows: string[][];
  summary: [string, string][];
}

export function printDocument(content: PrintDocument) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!win || !doc) {
    iframe.remove();
    return;
  }
  doc.title = content.title;
  const style = doc.createElement("style");
  style.textContent = PRINT_CSS;
  doc.head.append(style);

  const h1 = doc.createElement("h1");
  h1.textContent = content.title;
  const meta = doc.createElement("div");
  meta.className = "meta";
  meta.textContent = content.meta.filter(Boolean).join(" · ");
  doc.body.append(h1, meta);

  const table = doc.createElement("table");
  const head = doc.createElement("tr");
  for (const column of content.columns) {
    const th = doc.createElement("th");
    th.textContent = column.label;
    if (column.numeric) th.className = "num";
    head.append(th);
  }
  table.append(head);
  if (content.rows.length === 0) {
    const tr = doc.createElement("tr");
    const td = doc.createElement("td");
    td.colSpan = content.columns.length;
    td.textContent = "No billable services documented";
    tr.append(td);
    table.append(tr);
  }
  for (const row of content.rows) {
    const tr = doc.createElement("tr");
    row.forEach((cell, index) => {
      const td = doc.createElement("td");
      td.textContent = cell;
      // eslint-disable-next-line security/detect-object-injection -- index from forEach.
      if (content.columns[index]?.numeric) td.className = "num";
      tr.append(td);
    });
    table.append(tr);
  }
  doc.body.append(table);

  const dl = doc.createElement("dl");
  for (const [label, value] of content.summary) {
    const dt = doc.createElement("dt");
    dt.textContent = label;
    const dd = doc.createElement("dd");
    dd.textContent = value;
    dl.append(dt, dd);
  }
  doc.body.append(dl);

  const cleanup = () => window.setTimeout(() => iframe.remove(), 500);
  win.addEventListener("afterprint", cleanup, { once: true });
  win.focus();
  win.print();
  window.setTimeout(() => {
    if (document.body.contains(iframe)) cleanup();
  }, 60_000);
}
