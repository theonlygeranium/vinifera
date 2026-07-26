import { Grape } from "lucide-react";

export function LoadingScreen({ label = "Loading" }: { label?: string }) {
  return (
    <main className="loading-screen" aria-busy="true" aria-live="polite">
      <span className="loading-screen__mark" aria-hidden="true">
        <Grape size={24} />
      </span>
      <span>{label}…</span>
    </main>
  );
}
