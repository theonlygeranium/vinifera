import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  hint?: string;
  error?: string;
}

export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  hint,
  error,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const descriptionId = hint || error ? `${id}-description` : undefined;

  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <div className="password-control">
        <input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          required
          minLength={12}
          aria-invalid={Boolean(error)}
          aria-describedby={descriptionId}
        />
        <button
          type="button"
          className="password-control__toggle"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </div>
      {hint || error ? (
        <p
          id={descriptionId}
          className={error ? "field-message field-message--error" : "field-message"}
        >
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}
