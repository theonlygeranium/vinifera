import { Grape } from "lucide-react";

export function LoadingScreen({ label = "Loading" }: { label?: string }) {
  return (
    <main className="loading-screen" aria-busy="true">
      <span className="loading-screen__mark" aria-hidden="true">
        <Grape size={24} />
      </span>
      <span role="status" aria-live="polite">
        {label}…
      </span>
    </main>
  );
}
