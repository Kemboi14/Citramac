import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Changing this clears a caught error — e.g. the route path, so navigating away recovers. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/**
 * Without a boundary, one component throwing during render unmounts the whole
 * React tree and leaves only the page background — what a Super Admin saw
 * after the subscription banner crashed on an empty API body. This contains
 * a crash to the region it wraps and says so, rather than failing silently.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled render error", error, info.componentStack);
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        className="mx-auto my-8 flex max-w-lg flex-col items-center gap-3 rounded-lg border border-surface-border bg-surface-card px-6 py-8 text-center shadow-sm"
      >
        <AlertTriangle className="h-6 w-6 text-status-red" />
        <h2 className="font-display text-lg font-bold text-ink-900">
          Something went wrong on this page
        </h2>
        <p className="text-sm text-ink-500">
          Nothing you saved has been lost. Reload to try again — if this keeps happening, tell your
          administrator what you were doing.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-sm bg-brand-green px-4 py-2 text-sm font-semibold text-on-primary hover:bg-brand-green-dark"
        >
          Reload
        </button>
      </div>
    );
  }
}
