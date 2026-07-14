export type TenantChatProviderSetupContext = {
  intent: "tenant-chat-setup";
  returnTo: string;
};

export function getTenantChatProviderSetupContext(input: {
  intent: string | string[] | undefined;
  returnTo: string | string[] | undefined;
  tenantId: string;
}): TenantChatProviderSetupContext | null {
  const expectedReturnTo = getTenantChatReturnPath(input.tenantId);

  if (
    input.intent !== "tenant-chat-setup" ||
    typeof input.returnTo !== "string" ||
    input.returnTo !== expectedReturnTo
  ) {
    return null;
  }

  return { intent: "tenant-chat-setup", returnTo: expectedReturnTo };
}

export function getTenantChatReturnPath(tenantId: string) {
  return `/tenants/${encodeURIComponent(tenantId)}/tenant-chat`;
}

export function getTenantChatProviderCreatedHref(
  context: TenantChatProviderSetupContext,
  providerConnectionId: string
) {
  const search = new URLSearchParams({
    onboarding: "provider-created",
    providerConnectionId
  });
  return `${context.returnTo}?${search.toString()}`;
}
