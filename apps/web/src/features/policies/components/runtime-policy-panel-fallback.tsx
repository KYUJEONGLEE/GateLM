import { Button } from "@/components/ui/button";

import type { RuntimePolicyEditorText } from "./runtime-policy-editor-types";

type PolicyPanelFallbackProps = {
  className?: string;
  heading: string;
  lineCount?: number;
  wide?: boolean;
};

type PolicyPanelFallbackGroupProps = {
  panels: PolicyPanelFallbackProps[];
};

type PolicyDetailModalFallbackProps = {
  onClose: () => void;
  text: RuntimePolicyEditorText;
};

export function PolicyPanelFallback({
  className = "",
  heading,
  lineCount = 3,
  wide = false
}: PolicyPanelFallbackProps) {
  const classes = [
    "console-panel",
    "policy-editor-panel",
    "policy-panel-loading",
    wide ? "wide-panel" : "",
    className
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article aria-busy="true" className={classes} data-loading-panel="true">
      <div className="panel-heading">
        <h3>{heading}</h3>
      </div>
      <div className="policy-panel-skeleton" aria-hidden="true">
        {Array.from({ length: lineCount }, (_, index) => (
          <span
            className="policy-panel-skeleton-line"
            data-size={index === lineCount - 1 ? "short" : "full"}
            key={index}
          />
        ))}
      </div>
    </article>
  );
}

export function PolicyPanelFallbackGroup({ panels }: PolicyPanelFallbackGroupProps) {
  return (
    <>
      {panels.map((panel) => (
        <PolicyPanelFallback key={`${panel.heading}-${panel.className ?? ""}`} {...panel} />
      ))}
    </>
  );
}

export function PolicyDetailModalFallback({ onClose, text }: PolicyDetailModalFallbackProps) {
  return (
    <section
      aria-busy="true"
      aria-labelledby="policy-detail-title"
      aria-modal="true"
      className="modal-panel policy-detail-modal"
      onClick={(event) => event.stopPropagation()}
      role="dialog"
    >
      <div className="panel-heading">
        <h3 id="policy-detail-title">{text.policyDetails}</h3>
        <Button onClick={onClose} type="button" variant="outline">
          {text.close}
        </Button>
      </div>

      <div className="policy-detail-layout">
        <PolicyPanelFallback heading={text.runtimeSnapshot} />
        <PolicyPanelFallback heading={text.providerCatalog} />
        <PolicyPanelFallback heading={text.history} wide />
      </div>
    </section>
  );
}
