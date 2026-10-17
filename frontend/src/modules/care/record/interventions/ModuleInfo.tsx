import type { InterventionAction, InterventionModule } from "../../../../lib/carePathwayApi";
import { Card } from "../../shared/ui";

/** Info tab — wording as the approved v4 mockup (`renderInterventionDrawerTab`). */
export function ModuleInfo({
  module,
  action,
}: {
  module: InterventionModule;
  action: InterventionAction | undefined;
}) {
  return (
    <Card title="About this Psychiatry module" bodyClassName="p-[18px] text-[13px]">
      <p>
        {module.recommended
          ? module.reason
          : "No matching diagnosis, alert, or medication entry was found in this client record."}
      </p>
      <p className="mt-2.5">
        <strong>Care-plan link:</strong>{" "}
        {action?.title ||
          "No matching action in the current care plan; an entry can be saved without a link."}
      </p>
      {action?.goal && (
        <p className="mt-1.5">
          <strong>Plan focus:</strong> {action.goal}
        </p>
      )}
      <p className="mt-2.5">
        <strong>Record types:</strong> {module.options.join(", ")}
      </p>
      <p className="mt-2.5 text-ink-500">
        This is a documentation aid. It does not replace clinical assessment or create a billing
        event.
      </p>
    </Card>
  );
}
