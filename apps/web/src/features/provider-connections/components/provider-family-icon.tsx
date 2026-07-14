import { Cpu, Gauge, Wind } from "lucide-react";
import Image from "next/image";

export {
  getProviderConnectionFamily,
  getProviderFamilyFromKey
} from "@/lib/control-plane/provider-display";

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
        getProviderFamilySymbol(family, size) ?? getProviderFamilyInitial(family)
      )}
    </span>
  );
}

function getProviderFamilySymbol(providerFamily: string, size: number) {
  if (providerFamily === "groq") {
    return <Gauge aria-hidden="true" size={size} strokeWidth={1.8} />;
  }

  if (providerFamily === "cerebras") {
    return <Cpu aria-hidden="true" size={size} strokeWidth={1.8} />;
  }

  if (providerFamily === "mistral") {
    return <Wind aria-hidden="true" size={size} strokeWidth={1.8} />;
  }

  return null;
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
