"use client";

import { DatabaseZap } from "lucide-react";

import { Switch } from "@/components/ui/switch";

export type ExactCacheToggleCardProps = {
  enabled: boolean;
  hint: string;
  id: string;
  onEnabledChange: (enabled: boolean) => void;
  title: string;
};

export function ExactCacheToggleCard({
  enabled,
  hint,
  id,
  onEnabledChange,
  title
}: ExactCacheToggleCardProps) {
  return (
    <div className="policy-cache-card" data-enabled={enabled}>
      <div className="policy-cache-card-summary">
        <span className="policy-cache-card-icon" aria-hidden="true">
          <DatabaseZap size={19} />
        </span>
        <span className="policy-cache-card-copy">
          <strong>{title}</strong>
          <small>{hint}</small>
        </span>
        <Switch
          aria-label={title}
          checked={enabled}
          id={id}
          onCheckedChange={onEnabledChange}
        />
      </div>
    </div>
  );
}
