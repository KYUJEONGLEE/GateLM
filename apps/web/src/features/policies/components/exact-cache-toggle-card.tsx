"use client";

import { DatabaseZap } from "lucide-react";
import type { ReactNode } from "react";

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

export type ExperimentalFeatureToggleCardProps = {
  badge: string;
  enabled: boolean;
  hint: string;
  icon: ReactNode;
  id: string;
  onEnabledChange: (enabled: boolean) => void;
  title: string;
};

export function ExperimentalFeatureToggleCard({
  badge,
  enabled,
  hint,
  icon,
  id,
  onEnabledChange,
  title
}: ExperimentalFeatureToggleCardProps) {
  return (
    <div className="policy-experimental-card" data-enabled={enabled}>
      <div className="policy-experimental-card-summary">
        <span className="policy-cache-card-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="policy-experimental-card-copy">
          <span className="policy-experimental-card-title">
            <strong>{title}</strong>
            <em>{badge}</em>
          </span>
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
