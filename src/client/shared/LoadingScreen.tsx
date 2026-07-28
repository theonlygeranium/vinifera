import { Grape } from "lucide-react";

export function LoadingScreen({ label = "Loading" }: { label?: string }) {
  return (
    <main className="loading-screen">
      <span
        className="loading-screen__mark"
        aria-busy="true"
        aria-label={`${label} in progress`}
      >
        <Grape size={24} aria-hidden="true" />
      </span>
      <span role="status" aria-live="polite">
        {label}…
      </span>
    </main>
  );
}
