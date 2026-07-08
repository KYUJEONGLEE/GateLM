"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CustomerDemoChatProfile } from "@/lib/gateway/customer-demo-client";
import { Briefcase, ChevronDown, MessageCircle, Settings, User } from "lucide-react";

type ApplicationLauncherFormProps = {
  chatProfiles: CustomerDemoChatProfile[];
  text: {
    chatStart: string;
    nameLabel: string;
    namePlaceholder: string;
    profileLabel: string;
    profileMissing: string;
    profilePlaceholder: string;
    settings: string;
  };
};

export function ApplicationLauncherForm({
  chatProfiles,
  text
}: ApplicationLauncherFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState(() =>
    getDefaultLauncherProfileId(chatProfiles)
  );
  const selectedProfile = useMemo(
    () => chatProfiles.find((profile) => profile.id === selectedProfileId),
    [chatProfiles, selectedProfileId]
  );
  const trimmedName = name.trim();
  const canStartChat = trimmedName.length > 0 && selectedProfile?.configured === true;

  function startChat() {
    if (!canStartChat || !selectedProfile) {
      return;
    }

    const searchParams = new URLSearchParams({
      name: trimmedName,
      profile: selectedProfile.id
    });

    router.push(`/chat?${searchParams.toString()}`);
  }

  return (
    <section className="application-launcher-form" aria-label={text.chatStart}>
      <label className="application-launcher-field">
        <span className="application-launcher-label">{text.nameLabel}</span>
        <span className="application-launcher-control">
          <span className="application-launcher-control-icon" aria-hidden="true">
            <User size={27} strokeWidth={2.1} />
          </span>
          <input
            autoComplete="name"
            onChange={(event) => setName(event.target.value)}
            placeholder={text.namePlaceholder}
            type="text"
            value={name}
          />
        </span>
      </label>

      <label className="customer-chat-profile-picker application-launcher-profile-picker">
        <span className="application-launcher-label">{text.profileLabel}</span>
        <span className="application-launcher-control application-launcher-select-control">
          <span className="application-launcher-control-icon" aria-hidden="true">
            <Briefcase size={25} strokeWidth={2.2} />
          </span>
          <select
            onChange={(event) => setSelectedProfileId(event.target.value)}
            value={selectedProfileId}
          >
            <option disabled value="">
              {text.profilePlaceholder}
            </option>
            {chatProfiles.map((profile) => (
              <option disabled={!profile.configured} key={profile.id} value={profile.id}>
                {profile.configured
                  ? profile.label
                  : `${profile.label} (${profile.disabledReason ?? text.profileMissing})`}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="application-launcher-select-chevron"
            size={24}
            strokeWidth={2.5}
          />
        </span>
      </label>

      <div className="application-launcher-actions">
        <button
          className="application-launcher-button application-launcher-button-primary"
          disabled={!canStartChat}
          onClick={startChat}
          type="button"
        >
          <MessageCircle size={25} strokeWidth={2.4} aria-hidden="true" />
          {text.chatStart}
        </button>
        <Link
          className="application-launcher-button application-launcher-button-secondary"
          href="/settings"
        >
          <Settings size={27} strokeWidth={2.2} aria-hidden="true" />
          {text.settings}
        </Link>
      </div>
    </section>
  );
}

function getDefaultLauncherProfileId(chatProfiles: CustomerDemoChatProfile[]) {
  const defaultProfile =
    chatProfiles.find((profile) => profile.isDefault && profile.configured)
    ?? chatProfiles.find((profile) => profile.configured);

  return defaultProfile?.id ?? "";
}
