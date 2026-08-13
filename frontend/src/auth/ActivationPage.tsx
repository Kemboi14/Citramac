import { useSearchParams } from "react-router-dom";
import { AuthFlowController } from "./AuthFlowController";

/** Entry point for the activation link — ?token=<activation_token>, per docs/04-MULTI-TENANCY.md §4.5. */
export function ActivationPage() {
  const [searchParams] = useSearchParams();
  const activationToken = searchParams.get("token") ?? undefined;
  return <AuthFlowController flowType="ACTIVATION" activationToken={activationToken} />;
}
