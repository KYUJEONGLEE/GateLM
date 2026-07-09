"use client";

import {
  ArrowUp,
  Bot,
  Info,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Settings as SettingsIcon
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { Button } from "@/components/ui/button";
import {
  FixtureGatewayChatClient,
  RouteGatewayChatClient,
  type CustomerDemoExchange,
  type CustomerDemoModel
} from "@/lib/gateway/customer-demo-client";
import type { Locale } from "@/lib/i18n/locale";
import { MarkdownMessage } from "./markdown-message";

type CustomerDemoAppProps = {
  locale: Locale;
  model: CustomerDemoModel;
  userName?: string;
};

type LocalChatMessage = {
  body: string;
  generatedByModel?: string | null;
  id: string;
  side: "incoming" | "outgoing";
};

type ConsoleTheme = "dark" | "light";

const customerDemoText: Record<
  Locale,
  {
    actions: {
      loading: string;
      newChat: string;
      replay: string;
      send: string;
    };
    appName: string;
    chatPreview: string;
    disclaimer: string;
    emptyState: {
      subtitle: string;
      title: string;
    };
    error: string;
    inputPlaceholder: string;
    language: string;
    sidebar: {
      application: string;
      contextMemory?: string;
      contextOff?: string;
      contextOn?: string;
      current: string;
      dark: string;
      language: string;
      light: string;
      newConversation: string;
      openSidebar: string;
      profile: string;
      profileMissing: string;
      profileReady: string;
      settings: string;
      closeSidebar: string;
      theme: string;
      user: string;
    };
    title: string;
  }
> = {
  en: {
    actions: {
      loading: "Processing...",
      newChat: "New chat",
      replay: "Send again",
      send: "Send"
    },
    appName: "Gateway Chat",
    chatPreview: "conversation",
    disclaimer: "AI can make mistakes. Verify important information.",
    emptyState: {
      subtitle: "Start a new conversation through the selected project Gateway API.",
      title: "What can I help with?"
    },
    error: "Unable to load this request state.",
    inputPlaceholder: "Type a message for this project",
    language: "Console language",
    sidebar: {
      application: "Application",
      contextMemory: "Context memory",
      contextOff: "Off",
      contextOn: "On",
      current: "Current conversation",
      dark: "Dark",
      language: "Language",
      light: "Light",
      newConversation: "New conversation",
      openSidebar: "Open sidebar",
      profile: "Project profile",
      profileMissing: "Gateway API key missing",
      profileReady: "Gateway API connected",
      settings: "User settings",
      closeSidebar: "Close sidebar",
      theme: "Theme",
      user: "User"
    },
    title: "Acme Support"
  },
  ko: {
    actions: {
      loading: "처리 중...",
      newChat: "새 채팅",
      replay: "다시 전송",
      send: "전송"
    },
    appName: "Gateway Chat",
    chatPreview: "대화",
    disclaimer: "AI는 실수할 수 있습니다. 중요한 정보는 다시 확인하세요.",
    emptyState: {
      subtitle: "선택한 프로젝트 Gateway API로 새 대화를 시작하세요.",
      title: "무엇을 도와드릴까요?"
    },
    error: "요청 상태를 불러오지 못했습니다.",
    inputPlaceholder: "이 프로젝트로 보낼 메시지 입력",
    language: "콘솔 언어",
    sidebar: {
      application: "Application",
      current: "현재 대화",
      dark: "다크",
      language: "언어",
      light: "라이트",
      newConversation: "새 대화",
      openSidebar: "좌측탭 열기",
      profile: "프로젝트 프로필",
      profileMissing: "Gateway API Key 누락",
      profileReady: "Gateway API 연결됨",
      settings: "사용자 설정",
      closeSidebar: "좌측탭 닫기",
      theme: "테마",
      user: "User"
    },
    title: "Acme Support"
  }
};

const themeStorageKey = "gatelm_console_theme";
const defaultContextRetentionEnabled = true;

export function CustomerDemoApp({ locale, model, userName }: CustomerDemoAppProps) {
  const client = useMemo(() => {
    if (model.integrationMode === "gateway") {
      return new RouteGatewayChatClient(
        model.tenantId,
        model.surface,
        model.selectedChatProfileId,
        userName
      );
    }

    return new FixtureGatewayChatClient(model.scenarios);
  }, [model.integrationMode, model.scenarios, model.selectedChatProfileId, model.surface, model.tenantId, userName]);
  const [, setExchange] = useState<CustomerDemoExchange>(() => buildInitialExchange(model));
  const [isLoading, setIsLoading] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isUserSettingsOpen, setIsUserSettingsOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [contextRetentionEnabled, setContextRetentionEnabled] = useState(defaultContextRetentionEnabled);
  const [messages, setMessages] = useState<LocalChatMessage[]>([]);
  const [theme, setTheme] = useState<ConsoleTheme>("light");
  const requestInFlight = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const hasScenarios = model.scenarios.length > 0;
  const text = customerDemoText[locale];
  const chatProfiles = model.chatProfiles ?? [];
  const selectedProfile =
    chatProfiles.find((profile) => profile.id === model.selectedChatProfileId)
    ?? chatProfiles.find((profile) => profile.isDefault)
    ?? chatProfiles[0];
  const selectedProfileId = model.selectedChatProfileId ?? selectedProfile?.id ?? "";
  const appDisplayName = model.selectedChatProfileLabel ?? selectedProfile?.label ?? text.appName;
  const profileStatus = selectedProfile?.configured
    ? text.sidebar.profileReady
    : (selectedProfile?.disabledReason ?? model.applicationChatProfileLoadError ?? text.sidebar.profileMissing);
  const isSelectedProfileConfigured =
    model.integrationMode !== "gateway" || selectedProfile?.configured === true;
  const canStreamApplicationChat =
    model.integrationMode === "gateway" && (model.applicationChatStreamingEnabled ?? true);
  const canSendMessage = hasScenarios && isSelectedProfileConfigured;
  const userDisplayName = userName ?? text.sidebar.user;
  const firstUserMessage = messages.find((message) => message.side === "outgoing");
  const currentConversationTitle = firstUserMessage?.body ?? text.sidebar.newConversation;
  const currentConversationAuthor = messages.length > 0 ? text.chatPreview : appDisplayName;

  useEffect(() => {
    const initialTheme = readStoredTheme() ?? readDocumentTheme();
    setTheme(initialTheme);
    applyTheme(initialTheme);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mobileQuery = window.matchMedia("(max-width: 760px)");
    const syncSidebarState = () => setIsSidebarOpen(!mobileQuery.matches);

    syncSidebarState();
    mobileQuery.addEventListener("change", syncSidebarState);

    return () => mobileQuery.removeEventListener("change", syncSidebarState);
  }, []);

  useEffect(() => {
    const thread = threadRef.current;

    if (!thread) {
      return;
    }

    thread.scrollTo({
      top: thread.scrollHeight,
      behavior: "smooth"
    });
  }, [messages, isLoading]);

  useEffect(() => {
    const input = inputRef.current;

    if (!input) {
      return;
    }

    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }, [inputValue]);

  const startNewChat = useCallback(async () => {
    if (requestInFlight.current || !isSelectedProfileConfigured) {
      return;
    }

    requestInFlight.current = true;
    setIsLoading(true);

    try {
      if (contextRetentionEnabled) {
        const conversation = await client.createConversation({
          contextRetentionEnabled
        });

        setConversationId(conversation.id);
        setContextRetentionEnabled(conversation.contextRetentionEnabled);
      } else {
        setConversationId(null);
      }
      setExchange(buildInitialExchange(model));
      setInputValue("");
      setLoadError(null);
      setMessages([]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : text.error);
    } finally {
      requestInFlight.current = false;
      setIsLoading(false);
    }
  }, [client, contextRetentionEnabled, isSelectedProfileConfigured, model, text.error]);

  const toggleSidebar = useCallback(() => {
    setIsUserSettingsOpen(false);
    setIsSidebarOpen((current) => !current);
  }, []);

  function selectTheme(nextTheme: ConsoleTheme) {
    setTheme(nextTheme);
    applyTheme(nextTheme);
    writeStoredTheme(nextTheme);
  }

  function selectProfile(nextProfileId: string) {
    if (!nextProfileId || nextProfileId === selectedProfileId || typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set("profile", nextProfileId);
    window.location.assign(`${url.pathname}${url.search}${url.hash}`);
  }

  const updateContextRetention = useCallback((enabled: boolean) => {
    const previousValue = contextRetentionEnabled;

    setContextRetentionEnabled(enabled);
    setLoadError(null);

    if (!conversationId) {
      return;
    }

    void client
      .updateConversation(conversationId, {
        contextRetentionEnabled: enabled
      })
      .then((conversation) => {
        setConversationId(conversation.id);
        setContextRetentionEnabled(conversation.contextRetentionEnabled);
      })
      .catch((error) => {
        setContextRetentionEnabled(previousValue);
        setLoadError(error instanceof Error ? error.message : text.error);
      });
  }, [client, contextRetentionEnabled, conversationId, text.error]);

  const sendUserMessage = useCallback(async (
    options: { stream?: boolean } = {}
  ) => {
    if (requestInFlight.current) {
      return;
    }

    const message = inputValue.trim();
    const streamRequested = canStreamApplicationChat && (options.stream ?? true);

    if (!message) {
      return;
    }

    const scenario = model.scenarios.find((item) => item.scenarioId === "safe");

    requestInFlight.current = true;
    setIsLoading(true);
    setInputValue("");
    setLoadError(null);
    setMessages((current) => [
      ...current,
      {
        body: message,
        id: `user-${Date.now()}`,
        side: "outgoing"
      }
    ]);

    try {
      if (scenario && model.integrationMode === "gateway") {
        setExchange(buildPendingExchange(model, scenario, { stream: streamRequested }));
      }

      const assistantMessageId = `assistant-${Date.now()}`;
      let streamedAssistantMessage = "";
      const nextExchange = streamRequested
        ? await client.sendChatCompletionStream(
            "safe",
            {
              contextRetentionEnabled,
              conversationId,
              message,
              stream: true
            },
            {
              onDelta: (content) => {
                streamedAssistantMessage += content;
                setMessages((current) => {
                  if (current.some((item) => item.id === assistantMessageId)) {
                    return current.map((item) =>
                      item.id === assistantMessageId
                        ? {
                            ...item,
                            body: streamedAssistantMessage
                          }
                        : item
                    );
                  }

                  return [
                    ...current,
                    {
                      body: streamedAssistantMessage,
                      id: assistantMessageId,
                      side: "incoming"
                    }
                  ];
                });
              }
            }
          )
        : await client.sendChatCompletion("safe", {
            contextRetentionEnabled,
            conversationId,
            message,
            stream: false
          });

      setExchange(nextExchange);
      setConversationId(nextExchange.conversationId ?? conversationId);
      setContextRetentionEnabled(nextExchange.contextRetentionEnabled);
      setMessages((current) => {
        const generatedByModel = getGeneratedByModel(nextExchange);

        if (streamedAssistantMessage && current.some((item) => item.id === assistantMessageId)) {
          return current.map((item) =>
            item.id === assistantMessageId
              ? {
                  ...item,
                  generatedByModel
                }
              : item
          );
        }

        return [
          ...current,
          {
            body: nextExchange.assistantMessage,
            generatedByModel,
            id: assistantMessageId,
            side: "incoming"
          }
        ];
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : text.error;

      setLoadError(errorMessage);
      setMessages((current) => [
        ...current,
        {
          body: errorMessage,
          id: `assistant-error-${Date.now()}`,
          side: "incoming"
        }
      ]);
    } finally {
      requestInFlight.current = false;
      setIsLoading(false);
      window.requestAnimationFrame(() => {
        inputRef.current?.focus({ preventScroll: true });
      });
    }
  }, [canStreamApplicationChat, client, contextRetentionEnabled, conversationId, inputValue, model, text.error]);

  return (
    <main className="customer-demo-shell customer-chat-shell" data-sidebar-open={isSidebarOpen}>
      <button
        aria-expanded={isSidebarOpen}
        aria-label={isSidebarOpen ? text.sidebar.closeSidebar : text.sidebar.openSidebar}
        className="customer-chat-sidebar-toggle"
        onClick={toggleSidebar}
        title={isSidebarOpen ? text.sidebar.closeSidebar : text.sidebar.openSidebar}
        type="button"
      >
        {isSidebarOpen ? (
          <PanelLeftClose aria-hidden="true" size={18} strokeWidth={2.2} />
        ) : (
          <PanelLeftOpen aria-hidden="true" size={18} strokeWidth={2.2} />
        )}
      </button>
      <aside className="customer-chat-sidebar" aria-label="Application navigation">
        <section className="customer-chat-sidebar-history" aria-label={text.sidebar.current}>
          <span>{text.sidebar.application}</span>
          <div className="customer-chat-sidebar-card">
            <strong>{appDisplayName}</strong>
            <small>{profileStatus}</small>
          </div>

          {chatProfiles.length > 1 ? (
            <label className="customer-chat-profile-picker">
              <span>{text.sidebar.profile}</span>
              <select
                onChange={(event) => selectProfile(event.target.value)}
                value={selectedProfileId}
              >
                {chatProfiles.map((profile) => (
                  <option disabled={!profile.configured} key={profile.id} value={profile.id}>
                    {profile.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <button
            className="customer-chat-new-button"
            disabled={isLoading || !isSelectedProfileConfigured}
            onClick={() => void startNewChat()}
            type="button"
          >
            <MessageSquarePlus size={16} strokeWidth={2} />
            {text.actions.newChat}
          </button>

          <span>{text.sidebar.current}</span>
          <div className="customer-chat-sidebar-card">
            <strong>{currentConversationTitle}</strong>
            <small>{currentConversationAuthor}</small>
          </div>
        </section>

        <div className="customer-chat-user-wrap">
          {isUserSettingsOpen ? (
            <div className="customer-chat-settings-popover" aria-label={text.sidebar.settings}>
              <div className="customer-chat-settings-row">
                <span>{text.sidebar.language}</span>
                <LanguageSwitcher ariaLabel={text.language} locale={locale} />
              </div>
              <div className="customer-chat-settings-row">
                <span>{text.sidebar.theme}</span>
                <div className="theme-segmented-control" data-density="compact">
                  <button
                    data-active={theme === "light"}
                    onClick={() => selectTheme("light")}
                    type="button"
                  >
                    {text.sidebar.light}
                  </button>
                  <button
                    data-active={theme === "dark"}
                    onClick={() => selectTheme("dark")}
                    type="button"
                  >
                    {text.sidebar.dark}
                  </button>
                </div>
              </div>
              <div className="customer-chat-settings-row">
                <span>{text.sidebar.contextMemory ?? "Context memory"}</span>
                <label className="customer-chat-context-toggle">
                  <input
                    aria-disabled={isLoading}
                    checked={contextRetentionEnabled}
                    onChange={(event) => {
                      if (isLoading) {
                        return;
                      }

                      updateContextRetention(event.target.checked);
                    }}
                    type="checkbox"
                  />
                  <span>
                    {contextRetentionEnabled
                      ? (text.sidebar.contextOn ?? "On")
                      : (text.sidebar.contextOff ?? "Off")}
                  </span>
                </label>
              </div>
            </div>
          ) : null}
          <div className="customer-chat-user-card">
            <strong>{userDisplayName}</strong>
            <button
              aria-expanded={isUserSettingsOpen}
              aria-label={text.sidebar.settings}
              className="customer-chat-settings-button"
              data-open={isUserSettingsOpen}
              onClick={() => setIsUserSettingsOpen((current) => !current)}
              title={text.sidebar.settings}
              type="button"
            >
              <SettingsIcon aria-hidden="true" size={16} strokeWidth={2.3} />
            </button>
          </div>
        </div>
      </aside>

      <section className="customer-chat-main" aria-busy={isLoading}>
        <section className="customer-chat-content" aria-label="Application chat">
          <div className="customer-chat-thread" aria-label={text.chatPreview} ref={threadRef}>
            {loadError ? <p className="customer-demo-error">{loadError}</p> : null}
            {messages.length === 0 && !isLoading ? (
              <div className="customer-chat-empty-state">
                <h1>{text.emptyState.title}</h1>
                <p>{text.emptyState.subtitle}</p>
              </div>
            ) : null}
            {messages.map((message) => (
              <article
                className="customer-chat-message"
                data-side={message.side}
                key={message.id}
              >
                {message.side === "incoming" ? (
                  <span className="customer-chat-avatar" aria-hidden="true">
                    <Bot size={18} strokeWidth={2} />
                  </span>
                ) : null}
                <div className="customer-chat-message-body">
                  {message.side === "incoming" ? (
                    <MarkdownMessage content={message.body} />
                  ) : (
                    <p>{message.body}</p>
                  )}
                  {message.side === "incoming" && message.generatedByModel ? (
                    <span className="customer-chat-generated-by">
                      <Info aria-hidden="true" size={16} strokeWidth={2} />
                      {formatGeneratedByModel(message.generatedByModel, locale)}
                    </span>
                  ) : null}
                </div>
              </article>
            ))}
            {isLoading ? (
              <div className="customer-chat-typing" aria-label={text.actions.loading}>
                <span />
                <span />
                <span />
              </div>
            ) : null}
          </div>

          <form
            className="customer-chat-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void sendUserMessage();
            }}
          >
            <label className="customer-chat-input">
              <textarea
                aria-label={text.inputPlaceholder}
                disabled={!canSendMessage}
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
                    return;
                  }

                  event.preventDefault();
                  void sendUserMessage();
                }}
                placeholder={text.inputPlaceholder}
                ref={inputRef}
                rows={1}
                value={inputValue}
              />
            </label>
            <Button
              className="customer-chat-send-button"
              disabled={isLoading || !canSendMessage || inputValue.trim().length === 0}
              type="submit"
            >
              <ArrowUp size={19} strokeWidth={2.6} />
              <span>
                {isLoading
                  ? text.actions.loading
                  : model.integrationMode === "gateway"
                    ? text.actions.send
                    : text.actions.replay}
              </span>
            </Button>
          </form>
        </section>
        <p className="customer-chat-disclaimer">{text.disclaimer}</p>
      </section>
    </main>
  );
}

function readDocumentTheme(): ConsoleTheme {
  if (typeof document === "undefined") {
    return "light";
  }

  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme: ConsoleTheme) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme;
}

function readStoredTheme(): ConsoleTheme | null {
  if (typeof window === "undefined") {
    return null;
  }

  const storedValue = window.localStorage.getItem(themeStorageKey);

  return storedValue === "dark" || storedValue === "light" ? storedValue : null;
}

function writeStoredTheme(theme: ConsoleTheme) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(themeStorageKey, theme);
}

function formatGeneratedByModel(modelName: string, locale: Locale) {
  const displayName = formatModelDisplayName(modelName, locale);

  return locale === "ko" ? `${displayName}로 생성됨` : `Generated with ${displayName}`;
}

function getGeneratedByModel(exchange: CustomerDemoExchange) {
  return firstDisplayableModel(
    getResponseHeader(exchange, "X-GateLM-Routed-Model"),
    getNestedString(exchange.response.body, ["gate_lm", "selectedModel"]),
    getNestedString(exchange.response.body, ["gate_lm", "routedModel"]),
    getNestedString(exchange.response.body, ["model"]),
    exchange.request.body.model
  );
}

function getResponseHeader(exchange: CustomerDemoExchange, name: string) {
  const targetName = name.toLowerCase();

  return exchange.response.headers.find((header) => header.name.toLowerCase() === targetName)?.value;
}

function firstDisplayableModel(...values: Array<string | undefined>) {
  for (const value of values) {
    const normalized = normalizeModelName(value);

    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function normalizeModelName(value: string | undefined) {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  const unavailableValues = new Set([
    "auto",
    "n/a",
    "none",
    "not-routed",
    "not-set",
    "null",
    "pending",
    "unknown"
  ]);

  return unavailableValues.has(normalized.toLowerCase()) ? null : normalized;
}

function getNestedString(value: unknown, path: string[]) {
  let current: unknown = value;

  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[key];
  }

  return typeof current === "string" ? current : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatModelDisplayName(modelName: string, locale: Locale) {
  const normalized = stripModelNamespace(modelName);
  const lowerName = normalized.toLowerCase();

  if (lowerName.startsWith("mock-")) {
    return locale === "ko" ? "데모 모델" : "Demo model";
  }

  if (lowerName.startsWith("gpt")) {
    const versionName = normalized
      .replace(/^gpt[-_]?/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\bturbo\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    return versionName ? `GPT-${versionName}` : "GPT";
  }

  return normalized
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function stripModelNamespace(modelName: string) {
  const withoutProviderPrefix = modelName
    .trim()
    .replace(/^(openai|anthropic|google|gemini|mock)[:/]/i, "");
  const segments = withoutProviderPrefix.split(/[:/]/).map((segment) => segment.trim()).filter(Boolean);

  return segments.at(-1) ?? withoutProviderPrefix;
}

function buildInitialExchange(model: CustomerDemoModel): CustomerDemoExchange {
  const base = model.scenarios[0] ?? buildEmptyExchange(model);

  if (model.integrationMode !== "gateway") {
    return base;
  }

  return buildPendingExchange(model, base);
}

function buildPendingExchange(
  model: CustomerDemoModel,
  scenario: CustomerDemoExchange,
  options: { stream?: boolean } = {}
): CustomerDemoExchange {
  const streamRequested = options.stream === true;

  return {
    ...scenario,
    assistantMessage: "Ready to send.",
    cacheStatus: "pending",
    contextRetentionEnabled: false,
    conversationId: null,
    httpStatus: 0,
    latencyMs: 0,
    providerCall: "skipped",
    request: {
      ...scenario.request,
      body: {
        ...scenario.request.body,
        stream: streamRequested
      }
    },
    requestId: "pending-live-request",
    requestLogHref: `/tenants/${model.tenantId}/request-logs`,
    response: {
      body: {
        status: "pending"
      },
      headers: [],
      statusCode: 0
    },
    status: "pending",
    streaming: {
      completed: null,
      contentType: null,
      chunkCount: null,
      requested: streamRequested
    },
    title: scenario.title
  };
}

function buildEmptyExchange(model: CustomerDemoModel): CustomerDemoExchange {
  return {
    assistantMessage: "No customer demo scenario is configured.",
    cacheStatus: "not-configured",
    contextRetentionEnabled: false,
    conversationId: null,
    description: "Customer demo scenarios are not available for this tenant application.",
    detectedTypes: [],
    httpStatus: 0,
    latencyMs: 0,
    maskingAction: "none",
    providerCall: "skipped",
    request: {
      endpoint: "/v1/chat/completions",
      method: "POST",
      headers: [
        {
          name: "Authorization",
          value: "Bearer <redacted>"
        },
        {
          name: "Content-Type",
          value: "application/json"
        }
      ],
      body: {
        model: "auto",
        messages: [
          {
            role: "system",
            content: "You are a helpful customer support assistant."
          },
          {
            role: "user",
            content: "No customer demo scenario is configured."
          }
        ],
        max_tokens: 128,
        temperature: 0.2,
        stream: false,
        metadata: {
          source: "web-customer-demo"
        },
        gate_lm: {
          cache: {
            mode: "auto"
          },
          routing: {
            mode: "auto"
          },
          responseMetadata: true
        }
      }
    },
    requestId: "not-configured",
    requestLogHref: `/tenants/${model.tenantId}/request-logs`,
    response: {
      body: {
        status: "not-configured"
      },
      headers: [],
      statusCode: 0
    },
    scenarioId: "safe",
    status: "not-configured",
    streaming: {
      completed: null,
      contentType: null,
      chunkCount: null,
      requested: false
    },
    title: "No scenario configured"
  };
}
