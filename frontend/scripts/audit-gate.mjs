// CI dependency gate: fails on any high or critical npm advisory, except those
// listed in audit-exceptions.json — each with a reason and a review date. An
// exception past its review date fails the build, so none is forgotten.
// Usage: npm audit --json | node scripts/audit-gate.mjs
import { readFileSync } from "node:fs";

const BLOCKING = new Set(["high", "critical"]);
const report = JSON.parse(readFileSync(0, "utf8"));
const exceptions = JSON.parse(readFileSync("audit-exceptions.json", "utf8"));
const today = new Date().toISOString().slice(0, 10);

const found = new Map();
for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via === "object" && BLOCKING.has(via.severity)) {
      found.set(via.url, { name, title: via.title, severity: via.severity });
    }
  }
}

let failed = false;
for (const [url, v] of found) {
  const ex = exceptions.find((e) => e.advisory === url);
  if (!ex) {
    console.error(`BLOCKING ${v.severity}: ${v.name} — ${v.title} (${url})`);
    failed = true;
  } else if (ex.review_by < today) {
    console.error(`EXPIRED exception (review by ${ex.review_by}): ${v.name} — ${url}`);
    failed = true;
  } else {
    console.log(`Accepted until ${ex.review_by}: ${v.name} — ${url}. ${ex.reason}`);
  }
}
for (const ex of exceptions) {
  if (!found.has(ex.advisory)) {
    console.log(`Exception no longer needed — remove it: ${ex.advisory}`);
  }
}
if (failed) process.exit(1);
console.log(`No unaccepted high or critical advisories (${found.size} accepted).`);
