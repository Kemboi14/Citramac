import { AuthFlowController } from "./AuthFlowController";

/** docs/05-AUTHENTICATION-FLOW.md §5.3 — reuses the same step components as activation. */
export function ForgotPasswordPage() {
  return <AuthFlowController flowType="RESET" />;
}
