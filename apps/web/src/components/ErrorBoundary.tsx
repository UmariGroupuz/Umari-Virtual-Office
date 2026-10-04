// React error boundary (CR-5): a render/lazy-load failure below it shows a visible fallback with Retry
// instead of blanking the page. `reset` remounts the children.
import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: (props: { error: Error; reset: () => void }) => ReactNode;
  /** Called before the boundary remounts its children (e.g. to re-create a failed lazy import). */
  onReset?: () => void;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  attempt: number;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  reset = (): void => {
    this.props.onReset?.();
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  };

  override render(): ReactNode {
    if (this.state.error)
      return this.props.fallback({ error: this.state.error, reset: this.reset });
    // A new key remounts the subtree after Retry.
    return <BoundaryChildren key={this.state.attempt}>{this.props.children}</BoundaryChildren>;
  }
}

function BoundaryChildren({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
