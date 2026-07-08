import { Alert, AlertDescription } from "@/components/ui/alert";
import type { RuntimePolicyModel } from "@/lib/control-plane/runtime-policy-types";

import { formatEnabled } from "../runtime-policy-editor-controls";
import type { RuntimePolicyEditorText } from "../runtime-policy-editor";

type StreamingPolicyPanelProps = {
  runtimeSnapshot: RuntimePolicyModel["runtimeSnapshot"];
  text: RuntimePolicyEditorText;
};

export function StreamingPolicyPanel({
  runtimeSnapshot,
  text
}: StreamingPolicyPanelProps) {
  return (
    <article className="console-panel policy-editor-panel">
      <div className="panel-heading">
        <h3>{text.streaming}</h3>
      </div>
      {runtimeSnapshot.loadError ? (
        <Alert variant="warning">
          <AlertDescription>{runtimeSnapshot.loadError}</AlertDescription>
        </Alert>
      ) : null}
      {runtimeSnapshot.snapshot ? (
        <dl className="policy-summary-list">
          <div>
            <dt>{text.enabled}</dt>
            <dd>
              {formatEnabled(
                runtimeSnapshot.snapshot.policies?.streaming?.enabled
              )}
            </dd>
          </div>
          <div>
            <dt>thin slice</dt>
            <dd>
              {formatEnabled(
                runtimeSnapshot.snapshot.policies?.streaming?.thinSliceOnly
              )}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="project-muted">{text.streamingUnavailable}</p>
      )}
      <p className="project-muted">{text.streamingNote}</p>
    </article>
  );
}
