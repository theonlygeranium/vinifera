import type { ReactNode } from "react";
import { MemberBrand } from "../member/MemberBranding";

interface AuthLayoutProps {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
  surface?: "staff" | "member";
}

export function AuthLayout({
  title,
  description,
  children,
  footer,
  surface = "staff",
}: AuthLayoutProps) {
  return (
    <main className={`auth-page auth-page--${surface}`}>
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-card__brand">
          {surface === "member" ? (
            <MemberBrand homeHref="/portal" />
          ) : (
            <MemberBrand homeHref="/app" />
          )}
        </div>
        <header className="auth-card__header">
          <h1 id="auth-title">{title}</h1>
          <p>{description}</p>
        </header>
        {children}
        {footer ? <footer className="auth-card__footer">{footer}</footer> : null}
      </section>
      <p className="auth-page__security">
        Secure access protected by encrypted, server-managed sessions.
      </p>
    </main>
  );
}
