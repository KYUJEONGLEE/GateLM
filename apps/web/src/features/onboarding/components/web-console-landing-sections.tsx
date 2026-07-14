"use client";

import { LogIn, Route } from "lucide-react";
import Link from "next/link";
import type { AuthMode, AuthStatus, WebConsoleInitText } from "./web-console-init-view";

export type WebConsoleLandingSectionsProps = {
  authStatus: AuthStatus;
  dashboardTenantId: string | null;
  getDashboardHref: (tenantId?: string) => string;
  onOpenAuthPanel: (mode: AuthMode) => void;
  text: WebConsoleInitText;
};

export function WebConsoleLandingSections({
  authStatus,
  dashboardTenantId,
  getDashboardHref,
  onOpenAuthPanel,
  text
}: WebConsoleLandingSectionsProps) {
  return (
    <>
      <section className="landing-provider-band" aria-label={text.providers.label}>
        <strong>{text.providers.label}</strong>
        <div>
          {text.providers.names.slice(0, 3).map((provider, index) => (
            <span key={provider}>
              <b>{provider}</b>
              {index < 2 ? <i aria-hidden="true">·</i> : null}
            </span>
          ))}
          <em>{text.providers.names[3]}</em>
        </div>
      </section>

      <section className="landing-pillars" id="gateway">
        <div className="landing-content-wrap">
          <h2>{text.features.title}</h2>
          <div className="landing-pillar-grid">
            {text.features.items.map((item, index) => (
              <article className="landing-pillar" key={item.title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-security" id="policies">
        <div className="landing-content-wrap landing-security-inner">
          <div className="landing-security-copy">
            <h2>{text.policies.title}</h2>
            <p>{text.policies.body}</p>
          </div>
          <ul>
            {text.policies.items.map((item) => (
              <li key={item.title}>
                <b aria-hidden="true">✓</b>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.body}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="landing-workflow" id="integrations">
        <div className="landing-content-wrap landing-workflow-inner">
          <div className="landing-workflow-copy">
            <h2>{text.workflow.title}</h2>
            <p>{text.workflow.body}</p>
          </div>
          <ol>
            {text.workflow.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      </section>

      <section className="landing-bottom-cta">
        <div className="landing-content-wrap landing-bottom-cta-inner">
          <h2>{text.bottomCta.title}</h2>
          <p>{text.bottomCta.body}</p>
          {authStatus === "authenticated" && dashboardTenantId ? (
            <Link className="landing-cta" href={getDashboardHref(dashboardTenantId)}>
              <Route aria-hidden="true" size={18} strokeWidth={2.4} />
              <span>{text.actions.dashboard}</span>
            </Link>
          ) : (
            <button className="landing-cta" onClick={() => onOpenAuthPanel("login")} type="button">
              <LogIn aria-hidden="true" size={18} strokeWidth={2.4} />
              <span>{text.bottomCta.action}</span>
            </button>
          )}
          <footer>© 2026 GateLM</footer>
        </div>
      </section>
    </>
  );
}
