import Image from "next/image";
import type { ProviderConnectionRecord } from "@/lib/control-plane/provider-connections-types";

type ProviderFamilyIconProps = {
  className: string;
  family: string;
  size?: number;
};

export function ProviderFamilyIcon({ className, family, size = 28 }: ProviderFamilyIconProps) {
  const iconSrc = getProviderFamilyIconSrc(family);

  return (
    <span className={className} data-family={family}>
      {iconSrc ? (
        <Image alt="" aria-hidden="true" height={size} src={iconSrc} width={size} />
      ) : (
        getProviderFamilyInitial(family)
      )}
    </span>
  );
}

export function getProviderConnectionFamily(provider: ProviderConnectionRecord) {
  const configuredFamily = getProviderConfigString(provider.providerConfig, "providerFamily", "");

  if (configuredFamily) {
    return configuredFamily;
  }

  return getProviderFamilyFromKey(provider.provider, provider.baseUrl);
}

export function getProviderFamilyFromKey(providerKey: string, baseUrl = "") {
  const normalizedProvider = providerKey.toLowerCase();
  const normalizedBaseUrl = baseUrl.toLowerCase();

  if (
    normalizedProvider.includes("gemini") ||
    normalizedBaseUrl.includes("generativelanguage.googleapis.com")
  ) {
    return "gemini";
  }

  if (
    normalizedProvider.includes("claude") ||
    normalizedProvider.includes("anthropic") ||
    normalizedBaseUrl.includes("anthropic.com")
  ) {
    return "claude";
  }

  if (normalizedProvider === "mock") {
    return "mock";
  }

  if (normalizedProvider === "new-provider") {
    return "new-provider";
  }

  return "openai";
}

export function getProviderFamilyInitial(providerFamily: string) {
  if (providerFamily === "claude") {
    return "AI";
  }

  if (providerFamily === "mock") {
    return "M";
  }

  if (providerFamily === "new-provider") {
    return "+";
  }

  return providerFamily.slice(0, 2).toUpperCase();
}

export function getProviderFamilyIconSrc(providerFamily: string) {
  if (providerFamily === "openai") {
    return "/openai-streamline.png";
  }

  if (providerFamily === "claude") {
    return "/claude-provider-icon.svg";
  }

  if (providerFamily === "gemini") {
    return "/gemini-provider-icon.webp";
  }

  return null;
}

function getProviderConfigString(
  providerConfig: Record<string, unknown> | null,
  key: string,
  fallback: string
) {
  const value = providerConfig?.[key];

  return typeof value === "string" ? value : fallback;
}
