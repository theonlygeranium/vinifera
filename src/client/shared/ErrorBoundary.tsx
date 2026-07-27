import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Top-level error boundary that catches render errors and failed lazy
 * imports, preventing a full white-screen crash.  Users see a recoverable
 * fallback with a reload action instead of an unresponsive SPA.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      JSON.stringify({
        componentStack: info.componentStack,
        message: error.message,
        name: "ErrorBoundary",
        stack: error.stack,
      }),
    );
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          style={{
            alignItems: "center",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            height: "100vh",
            justifyContent: "center",
            padding: "2rem",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>
            Something went wrong
          </h1>
          <p style={{ color: "#6b7280", maxWidth: "28rem" }}>
            An unexpected error occurred while loading Vinifera. Reloading the
            page usually resolves the issue.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              backgroundColor: "#4f46e5",
              border: "none",
              borderRadius: "0.375rem",
              color: "#fff",
              cursor: "pointer",
              fontSize: "0.875rem",
              fontWeight: 500,
              padding: "0.5rem 1rem",
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
