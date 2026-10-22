import type { InterventionModule } from "../../../../lib/carePathwayApi";
import { priceText } from "./rates";

/** Info tab (v4 `appendModuleInfo`): the module note, what's inside, and the
 * billing facts — all from the catalogue and the facility's configuration. */
export function ModuleInfo({ module }: { module: InterventionModule }) {
  return (
    <>
      {module.note && <ModuleNote note={module.note} />}
      {module.options.length > 0 && (
        <details open className="mt-2 text-[12.5px] text-ink-500">
          <summary className="flex min-h-[32px] cursor-pointer items-center font-semibold">
            What’s inside ({module.options.length})
          </summary>
          <ul className="mt-1 list-disc pl-5">
            {module.options.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="mt-3 rounded-[9px] border border-surface-border bg-surface-bg p-3 text-[13px]">
        <h5 className="mb-2 text-xs font-bold uppercase tracking-[.4px] text-ink-500">
          Module information
        </h5>
        <div>
          {module.rate !== null && module.billing_service
            ? `${priceText(module).replace(" / ", " per ")}`
            : priceText(module)}
          {module.sha_code && ` · SHA ${module.sha_code}`}
          {module.preauth && (
            <span className="text-priority-orange"> · pre-authorisation required</span>
          )}
        </div>
        {module.billing_service && !module.sha_code && (
          <div className="mt-2 text-xs text-ink-500">
            No SHA code is configured for this service — set it in Billing before claiming.
          </div>
        )}
        {module.charged_by && (
          <div className="mt-2 text-xs text-ink-500">Charged when {module.charged_by}.</div>
        )}
      </div>
    </>
  );
}

export function ModuleNote({ note }: { note: string }) {
  return (
    <div className="mb-1 mt-3 rounded-lg border border-surface-border bg-surface-bg px-[11px] py-[9px] text-[13px] text-ink-700">
      {note}
    </div>
  );
}
