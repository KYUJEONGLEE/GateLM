import Image from "next/image";

type GateLMLogoProps = {
  compact?: boolean;
  surface?: "adaptive" | "light";
};

export function GateLMLogo({ compact = false, surface = "adaptive" }: GateLMLogoProps) {
  return (
    <span
      className="gatelm-logo"
      data-compact={compact || undefined}
      data-surface={surface}
    >
      <span className="gatelm-logo-art" aria-hidden="true">
        <Image
          alt=""
          className="gatelm-logo-image gatelm-logo-image-light"
          height={84}
          priority
          src="/brand/gatelm-mark-light.svg"
          width={104}
        />
        <Image
          alt=""
          className="gatelm-logo-image gatelm-logo-image-dark"
          height={84}
          priority
          src="/brand/gatelm-mark-dark.svg"
          width={104}
        />
        {!compact ? (
          <span className="gatelm-logo-wordmark">
            <span>Gate</span>
            <span>LM</span>
          </span>
        ) : null}
      </span>
    </span>
  );
}
