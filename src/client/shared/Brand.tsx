import { Grape } from "lucide-react";
import { Link } from "../routes/router";

interface BrandProps {
  compact?: boolean;
  inverse?: boolean;
  homeHref?: string;
}

export function Brand({
  compact = false,
  inverse = false,
  homeHref = "/",
}: BrandProps) {
  return (
    <Link
      to={homeHref}
      className={`brand${compact ? " brand--compact" : ""}${
        inverse ? " brand--inverse" : ""
      }`}
      aria-label="Vinifera home"
    >
      <span className="brand__mark" aria-hidden="true">
        <Grape size={18} strokeWidth={2.2} />
      </span>
      <span className="brand__wordmark">
        <strong>Vinifera</strong>
        {compact ? null : <small>Club Management</small>}
      </span>
    </Link>
  );
}
