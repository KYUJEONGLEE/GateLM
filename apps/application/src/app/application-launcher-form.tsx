"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CustomerDemoChatProfile } from "@/lib/gateway/customer-demo-client";

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
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const selectedProfile = useMemo(
    () => chatProfiles.find((profile) => profile.id === selectedProfileId),
    [chatProfiles, selectedProfileId]
  );
  const canStartChat = name.trim().length > 0 && selectedProfile?.configured === true;

  function startChat() {
    if (!canStartChat || !selectedProfile) {
      return;
    }

    router.push(`/chat?profile=${encodeURIComponent(selectedProfile.id)}&name=${encodeURIComponent(name.trim())}`);
  }

  return (
    <section className="application-launcher-form" aria-label={text.chatStart}>
      <label className="application-launcher-field">
        <span>{text.nameLabel}</span>
        <input
          autoComplete="name"
          onChange={(event) => setName(event.target.value)}
          placeholder={text.namePlaceholder}
          type="text"
          value={name}
        />
      </label>

      <label className="customer-chat-profile-picker application-launcher-profile-picker">
        <span>{text.profileLabel}</span>
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
      </label>

      <div className="application-launcher-actions">
        <button
          className="application-launcher-button application-launcher-button-primary"
          disabled={!canStartChat}
          onClick={startChat}
          type="button"
        >
          {text.chatStart}
        </button>
        <Link
          className="application-launcher-button application-launcher-button-secondary"
          href="/settings"
        >
          {text.settings}
        </Link>
      </div>
    </section>
  );
}
