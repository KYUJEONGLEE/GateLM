"use client";

import { LogIn, Route, ShieldCheck } from "lucide-react";
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
      <section className="landing-provider-band" id="integrations" aria-label={text.providers.label}>
        <strong>{text.providers.label}</strong>
        <div>
          {text.providers.names.map((provider) => (
            <span key={provider}>{provider}</span>
          ))}
        </div>
      </section>

      <section className="landing-summary-band" id="company">
        <div>
          <p>{text.summary.eyebrow}</p>
          <h2>{text.summary.title}</h2>
        </div>
        <p>{text.summary.body}</p>
        <div className="landing-summary-actions">
          {authStatus === "authenticated" ? (
            <>
              {dashboardTenantId ? (
                <Link className="landing-summary-link" href={getDashboardHref(dashboardTenantId)}>
                  <Route aria-hidden="true" size={16} strokeWidth={2.3} />
                  <span>{text.actions.dashboard}</span>
                </Link>
              ) : null}
              <Link className="landing-summary-link" href="/application">
                <ShieldCheck aria-hidden="true" size={16} strokeWidth={2.3} />
                <span>{text.actions.chat}</span>
              </Link>
            </>
          ) : (
            <>
              <button className="landing-summary-link" onClick={() => onOpenAuthPanel("login")} type="button">
                <Route aria-hidden="true" size={16} strokeWidth={2.3} />
                <span>{text.actions.dashboard}</span>
              </button>
              <button className="landing-summary-link" onClick={() => onOpenAuthPanel("login")} type="button">
                <ShieldCheck aria-hidden="true" size={16} strokeWidth={2.3} />
                <span>{text.actions.chat}</span>
              </button>
            </>
          )}
        </div>
      </section>

      <LandingFeatureSection text={text.features} />
      <LandingPolicySection text={text.policies} />
      <LandingWorkflowSection text={text.workflow} />
      <section className="landing-section landing-bottom-cta">
        <div>
          <h2>{text.bottomCta.title}</h2>
          <p>{text.bottomCta.body}</p>
        </div>
        <button className="landing-cta" onClick={() => onOpenAuthPanel("login")} type="button">
          <LogIn aria-hidden="true" size={18} strokeWidth={2.4} />
          <span>{text.bottomCta.action}</span>
        </button>
      </section>
    </>
  );
}

function LandingFeatureSection({
  text
}: {
  text: WebConsoleInitText["features"];
}) {
  return (
    <section className="landing-section" id="gateway">
      <div className="landing-section-heading">
        <h2>{text.title}</h2>
        <p>{text.body}</p>
      </div>
      <div className="landing-feature-grid">
        {text.items.map((item) => (
          <article className="landing-feature-card" key={item.title}>
            <strong>{item.title}</strong>
            <p>{item.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function LandingPolicySection({
  text
}: {
  text: WebConsoleInitText["policies"];
}) {
  return (
    <section className="landing-section landing-policy-showcase" id="policies">
      <div className="landing-section-heading">
        <h2>{text.title}</h2>
        <p>{text.body}</p>
      </div>
      <div className="landing-policy-grid">
        {text.items.map((item) => (
          <article className="landing-policy-card" key={item.title}>
            <span aria-hidden="true" />
            <strong>{item.title}</strong>
            <p>{item.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function LandingWorkflowSection({
  text
}: {
  text: WebConsoleInitText["workflow"];
}) {
  return (
    <section className="landing-section landing-workflow-section">
      <div>
        <h2>{text.title}</h2>
        <p>{text.body}</p>
      </div>
      <ol className="landing-workflow-list">
        {text.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  );
}
