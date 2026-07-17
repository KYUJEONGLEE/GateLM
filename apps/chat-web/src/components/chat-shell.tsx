'use client';

import { Badge, Button } from '@gatelm/ui';
import {
  AlertTriangle,
  Building2,
  Check,
  Copy,
  Gauge,
  LoaderCircle,
  LogOut,
  Menu,
  MessageSquareText,
  Pencil,
  Plus,
  Send,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ChatSession } from '@/lib/auth-types';
import { api, ChatApiError, streamApi } from '@/lib/browser-api';
import { copyTextToClipboard } from '@/lib/clipboard.mjs';
import { MarkdownMessage } from '@/components/markdown-message.mjs';
import { getModelBrand } from '@/lib/model-brand.mjs';
import {
  consumeTurnSse,
  isBlockedCode,
  MAX_TENANT_CHAT_OUTPUT_TOKENS,
  safeChatError,
  strongestPolicyState,
  type Conversation,
  type Message,
  type PolicyState,
  type SafeChatError,
} from '@/lib/conversation-contract.mjs';

const CONTEXT_MODE_STORAGE_KEY = 'gatelm.tenant-chat.context-mode';
type ContextMode = 'conversation' | 'single_turn';

export function ChatShell() {
  const router = useRouter();
  const [session, setSession] = useState<ChatSession | null>(null);
  const [conversations, setConversations] = useState<readonly Conversation[]>([]);
  const [conversationCursor, setConversationCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly DisplayMessage[]>([]);
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [composer, setComposer] = useState('');
  const [contextMode, setContextMode] = useState<ContextMode>('conversation');
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [policyState, setPolicyState] = useState<PolicyState>('normal');
  const [error, setError] = useState<SafeChatError | null>(null);
  const [status, setStatus] = useState('GateLM Chat을 준비하고 있습니다.');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const userMessagesByTurnId = useMemo(() => {
    const byTurnId = new Map<string, DisplayMessage>();
    for (const message of messages) {
      if (message.role === 'user') byTurnId.set(message.turnId, message);
    }
    return byTurnId;
  }, [messages]);
  const drawerRef = useRef<HTMLElement>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLOListElement>(null);
  const renameReturnIdRef = useRef<string | null>(null);
  const streamControllerRef = useRef<AbortController | null>(null);
  const activeTurnIdRef = useRef<string | null>(null);
  const newConversationIdRef = useRef<string | null>(null);

  const reportError = useCallback((caught: unknown) => {
    const detail = caught instanceof ChatApiError ? caught.detail : safeChatError({ code: 'CHAT_INTERNAL_ERROR' });
    setError(detail);
    if (isBlockedCode(detail.code)) setPolicyState('blocked');
    setStatus(detail.message);
  }, []);

  const closeDrawer = useCallback((returnFocus: boolean) => {
    setMenuOpen(false);
    if (returnFocus) requestAnimationFrame(() => drawerTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(CONTEXT_MODE_STORAGE_KEY) === 'single_turn') {
        setContextMode('single_turn');
      }
    } catch {
      // Storage can be unavailable in hardened browser modes; the safe default keeps context.
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const value = await api<ChatSession>('/api/tenant-chat/auth/session');
        if (value.state !== 'authenticated') {
          router.replace('/tenants');
          return;
        }
        const page = await api<ConversationPage>('/api/tenant-chat/conversations?limit=20');
        if (!active) return;
        setSession(value);
        setConversations(page.items);
        setConversationCursor(page.nextCursor);
        setSelectedId(page.items[0]?.id ?? null);
        setStatus(page.items.length ? '최근 대화를 불러왔습니다.' : '메시지를 입력해 새 대화를 시작하세요.');
      } catch {
        router.replace('/login');
      } finally {
        if (active) setLoading(false);
      }
    }
    void initialize();
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setMessageCursor(null);
      setPolicyState('normal');
      setError(null);
      return;
    }
    if (newConversationIdRef.current === selectedId) {
      newConversationIdRef.current = null;
      setHistoryLoading(false);
      setError(null);
      return;
    }
    let active = true;
    setHistoryLoading(true);
    setError(null);
    async function loadConversation() {
      try {
        const [conversation, page] = await Promise.all([
          api<Conversation>(`/api/tenant-chat/conversations/${selectedId}`),
          api<MessagePage>(`/api/tenant-chat/conversations/${selectedId}/messages?limit=50`),
        ]);
        if (!active) return;
        setConversations((current) => current.map((item) => item.id === conversation.id ? conversation : item));
        setMessages(page.items);
        setMessageCursor(page.nextCursor);
        setPolicyState('normal');
        setStatus(`${conversation.title} 대화를 불러왔습니다.`);
      } catch (caught) {
        if (active) reportError(caught);
      } finally {
        if (active) setHistoryLoading(false);
      }
    }
    void loadConversation();
    return () => { active = false; };
  }, [reportError, selectedId]);

  useEffect(() => {
    if (!menuOpen) return;
    const focusTimer = window.setTimeout(() => drawerRef.current?.querySelector<HTMLButtonElement>('.mobile-close')?.focus(), 120);
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeDrawer(true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closeDrawer, menuOpen]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, streaming]);

  async function logout() {
    try { await api('/api/tenant-chat/auth/logout', { body: '{}', method: 'POST' }); }
    finally { router.replace('/login'); router.refresh(); }
  }

  async function createConversation(): Promise<Conversation | null> {
    if (streaming || creatingConversation) return null;
    setCreatingConversation(true);
    setError(null);
    try {
      const created = await api<Conversation>('/api/tenant-chat/conversations', {
        body: JSON.stringify({ idempotencyKey: idempotencyKey(), title: '새 대화' }),
        method: 'POST',
      });
      newConversationIdRef.current = created.id;
      setConversations((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setSelectedId(created.id);
      setMessages([]);
      setMessageCursor(null);
      setPolicyState('normal');
      setStatus('새 대화를 만들었습니다. 메시지를 입력하세요.');
      closeDrawer(false);
      requestAnimationFrame(() => composerRef.current?.focus());
      return created;
    } catch (caught) {
      reportError(caught);
      return null;
    } finally {
      setCreatingConversation(false);
    }
  }

  async function loadMoreConversations() {
    if (!conversationCursor) return;
    try {
      const page = await api<ConversationPage>(`/api/tenant-chat/conversations?limit=20&cursor=${encodeURIComponent(conversationCursor)}`);
      setConversations((current) => [...current, ...page.items.filter((item) => !current.some(({ id }) => id === item.id))]);
      setConversationCursor(page.nextCursor);
      setStatus('대화 목록을 더 불러왔습니다.');
    } catch (caught) {
      reportError(caught);
    }
  }

  async function loadMoreMessages() {
    if (!selectedId || !messageCursor) return;
    setHistoryLoading(true);
    try {
      const page = await api<MessagePage>(`/api/tenant-chat/conversations/${selectedId}/messages?limit=50&cursor=${encodeURIComponent(messageCursor)}`);
      setMessages((current) => [...current, ...page.items]);
      setMessageCursor(page.nextCursor);
      setStatus('대화 기록을 더 불러왔습니다.');
    } catch (caught) {
      reportError(caught);
    } finally {
      setHistoryLoading(false);
    }
  }

  function beginRename(conversation: Conversation) {
    renameReturnIdRef.current = conversation.id;
    setDeleteId(null);
    setRenameId(conversation.id);
    setRenameTitle(conversation.title);
  }

  function cancelRename() {
    setRenameId(null);
    restoreRenameFocus();
  }

  async function submitRename(event: FormEvent, conversation: Conversation) {
    event.preventDefault();
    try {
      const renamed = await api<Conversation>(`/api/tenant-chat/conversations/${conversation.id}`, {
        body: JSON.stringify({ expectedVersion: conversation.version, title: renameTitle }),
        method: 'PATCH',
      });
      setConversations((current) => current.map((item) => item.id === renamed.id ? renamed : item));
      setRenameId(null);
      setStatus(`대화 이름을 ${renamed.title}(으)로 변경했습니다.`);
      restoreRenameFocus();
    } catch (caught) {
      reportError(caught);
    }
  }

  async function deleteConversation(conversation: Conversation) {
    try {
      await api(`/api/tenant-chat/conversations/${conversation.id}`, {
        headers: { 'if-match': `"${conversation.version}"` },
        method: 'DELETE',
      });
      const remaining = conversations.filter((item) => item.id !== conversation.id);
      setConversations(remaining);
      setDeleteId(null);
      if (selectedId === conversation.id) setSelectedId(remaining[0]?.id ?? null);
      setStatus('대화를 삭제했습니다.');
    } catch (caught) {
      reportError(caught);
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (streaming || creatingConversation || policyState === 'blocked' || !composer.trim()) return;
    const content = composer;
    const responseStartedAt = performance.now();
    let conversationId = selectedId;
    if (!conversationId) {
      const created = await createConversation();
      if (!created) return;
      conversationId = created.id;
    }
    const optimisticUserId = crypto.randomUUID();
    const draftId = crypto.randomUUID();
    const now = new Date().toISOString();
    const baseSequence = messages.at(-1)?.sequence ?? 0;
    setComposer('');
    setError(null);
    setStreaming(true);
    setStatus('답변을 생성하고 있습니다.');
    setMessages((current) => [
      ...(selectedId ? current : []),
      { id: optimisticUserId, localId: optimisticUserId, turnId: optimisticUserId, role: 'user', content, sequence: baseSequence + 1, createdAt: now },
      { id: draftId, localId: draftId, turnId: draftId, role: 'assistant', content: '', sequence: baseSequence + 2, createdAt: now },
    ]);
    const controller = new AbortController();
    streamControllerRef.current = controller;
    activeTurnIdRef.current = null;
    try {
      const response = await streamApi(`/api/tenant-chat/conversations/${conversationId}/turns`, {
        body: JSON.stringify({
          content,
          contextMode,
          idempotencyKey: idempotencyKey(),
          usageIntent: { cacheStrategy: 'exact', maxOutputTokens: MAX_TENANT_CHAT_OUTPUT_TOKENS, requestedTier: 'auto' },
        }),
        method: 'POST',
        signal: controller.signal,
      });
      const terminal = await consumeTurnSse(response.body, {
        conversationId,
        onAccepted: (accepted) => {
          activeTurnIdRef.current = accepted.turnId;
          setMessages((current) => current.map((message) => message.id === optimisticUserId
            ? { ...message, turnId: accepted.turnId }
            : message));
        },
        onDelta: (delta, deltaEvent) => {
          setMessages((current) => current.map((message) => message.id === draftId
            ? { ...message, turnId: deltaEvent.turnId, content: message.content + delta }
            : message));
        },
      });
      if (terminal.type === 'chat.turn.final') {
        setMessages((current) => current.map((message) => message.id === draftId
          ? {
              ...message,
              id: terminal.messageId ?? message.id,
              turnId: terminal.turnId,
              ...(terminal.cacheOutcome ? { cacheOutcome: terminal.cacheOutcome } : {}),
              ...(terminal.effectiveModelKey ? { effectiveModelKey: terminal.effectiveModelKey } : {}),
              responseDurationMs: performance.now() - responseStartedAt,
            }
          : message));
        if (terminal.quotaState && terminal.budgetState) {
          setPolicyState(strongestPolicyState(terminal.quotaState, terminal.budgetState));
        }
        setStatus('답변 생성을 완료했습니다.');
      } else {
        const detail = terminal.error ?? safeChatError({ code: 'CHAT_INTERNAL_ERROR' });
        if (terminal.type === 'chat.turn.cancelled') {
          setMessages((current) => current.filter((message) => message.id !== draftId || Boolean(message.content)));
          setStatus(detail.message);
        } else {
          setMessages((current) => current.map((message) => message.id === draftId ? { ...message, notice: detail } : message));
          if (isBlockedCode(detail.code)) setPolicyState('blocked');
          setStatus(detail.message);
        }
      }
    } catch (caught) {
      const admitted = activeTurnIdRef.current !== null;
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        setMessages((current) => current.filter((message) =>
          (message.id !== draftId || Boolean(message.content)) && (admitted || message.id !== optimisticUserId)));
        if (!admitted) setComposer(content);
        setStatus('답변 생성을 중지했습니다.');
      } else {
        const detail = caught instanceof ChatApiError ? caught.detail : safeChatError({ code: 'CHAT_INTERNAL_ERROR' });
        if (!admitted) {
          setMessages((current) => current.filter((message) =>
            message.id !== draftId && message.id !== optimisticUserId));
          setComposer(content);
        } else {
          setMessages((current) => current.map((message) =>
            message.id === draftId ? { ...message, notice: detail } : message));
        }
        if (isBlockedCode(detail.code)) setPolicyState('blocked');
        setStatus(detail.message);
      }
    } finally {
      streamControllerRef.current = null;
      activeTurnIdRef.current = null;
      setStreaming(false);
      setStopping(false);
      requestAnimationFrame(() => composerRef.current?.focus());
    }
  }

  async function stopStreaming() {
    if (!streaming || stopping) return;
    setStopping(true);
    setStatus('답변 생성을 중지하고 있습니다.');
    const turn = activeTurnIdRef.current;
    if (!selectedId || !turn) {
      streamControllerRef.current?.abort();
      return;
    }
    try {
      await api(`/api/tenant-chat/conversations/${selectedId}/turns/${turn}/cancel`, { method: 'POST' });
    } catch (caught) {
      reportError(caught);
    } finally {
      streamControllerRef.current?.abort();
    }
  }

  function composerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function changeContextMode(enabled: boolean) {
    const next: ContextMode = enabled ? 'conversation' : 'single_turn';
    setContextMode(next);
    try {
      window.localStorage.setItem(CONTEXT_MODE_STORAGE_KEY, next);
    } catch {
      // The in-memory preference still applies for the current page.
    }
    setStatus(enabled
      ? '다음 요청부터 이전 대화 컨텍스트를 함께 사용합니다.'
      : '다음 요청부터 현재 메시지만 사용합니다. 대화 기록은 그대로 유지됩니다.');
  }

  if (loading || !session?.selectedTenant) return <main className="chat-loading"><LoaderCircle className="spin" aria-hidden /><div role="status">GateLM Chat을 준비하는 중…</div></main>;
  const displayName = session.user.name || session.user.email.split('@')[0];
  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null;
  const policyCopy = policyText(policyState);
  return <main className="chat-shell">
    <p className="sr-only" role="status" aria-live="polite">{status}</p>
    {menuOpen && <button className="mobile-backdrop" aria-label="대화 메뉴 닫기" onClick={() => closeDrawer(true)} />}
    <aside ref={drawerRef} className={`chat-sidebar${menuOpen ? ' is-open' : ''}`} aria-label="대화 탐색" tabIndex={-1}>
      <div className="sidebar-scroll">
        <div className="sidebar-brand-row">
          <div className="brand"><span className="brand-mark"><MessageSquareText size={21} aria-hidden /></span>GateLM Chat</div>
          <Button className="mobile-close" variant="ghost" aria-label="대화 메뉴 닫기" onClick={() => closeDrawer(true)}><X size={20} aria-hidden /></Button>
        </div>
        <Button className="new-conversation" onClick={createConversation} disabled={streaming || creatingConversation}><Plus size={17} aria-hidden />새 대화</Button>
        <div className="conversation-heading"><span>내 대화</span><span>{conversations.length}</span></div>
        <ul className="conversation-list" aria-label="대화 목록">
          {conversations.map((conversation) => <li key={conversation.id} className={conversation.id === selectedId ? 'is-selected' : ''}>
            {renameId === conversation.id ? <form className="rename-form" onSubmit={(event) => submitRename(event, conversation)}>
              <label className="sr-only" htmlFor={`rename-${conversation.id}`}>대화 이름</label>
              <input id={`rename-${conversation.id}`} value={renameTitle} maxLength={120} autoFocus onChange={(event) => setRenameTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') cancelRename(); }} />
              <div><Button type="submit" variant="secondary">저장</Button><Button type="button" variant="ghost" onClick={cancelRename}>취소</Button></div>
            </form> : <>
              <button className="conversation-select" aria-current={conversation.id === selectedId ? 'page' : undefined} onClick={() => { setSelectedId(conversation.id); closeDrawer(false); }}>
                <MessageSquareText size={16} aria-hidden /><span>{conversation.title}</span>
              </button>
              <div className="conversation-actions">
                <button data-rename-for={conversation.id} aria-label={`${conversation.title} 이름 변경`} onClick={() => beginRename(conversation)}><Pencil size={14} aria-hidden /></button>
                <button aria-label={`${conversation.title} 삭제`} onClick={() => { setRenameId(null); setDeleteId(conversation.id); }}><Trash2 size={14} aria-hidden /></button>
              </div>
              {deleteId === conversation.id && <div className="delete-confirm" role="alert">
                <span>이 대화와 기록을 삭제할까요?</span>
                <div><Button variant="secondary" onClick={() => deleteConversation(conversation)}>삭제 확인</Button><Button variant="ghost" onClick={() => setDeleteId(null)}>취소</Button></div>
              </div>}
            </>}
          </li>)}
        </ul>
        {conversationCursor && <Button className="load-more" variant="ghost" onClick={loadMoreConversations}>대화 더 보기</Button>}
      </div>
      <div className="sidebar-account">
        <Badge><Building2 className="badge-leading-icon" size={14} aria-hidden />{session.selectedTenant.name}</Badge>
        <div><div className="account-name">{displayName}</div><div className="account-email">{session.user.email}</div></div>
        <Button variant="ghost" onClick={logout}><LogOut size={17} aria-hidden />로그아웃</Button>
      </div>
    </aside>
    <section className="chat-main">
      <header className="chat-topbar">
        <button ref={drawerTriggerRef} className="g-button g-button--ghost mobile-menu" aria-label="대화 메뉴 열기" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={21} aria-hidden /></button>
        <div className="topbar-title"><strong>{selected?.title ?? 'GateLM Chat'}</strong><span>{session.selectedTenant.name}</span></div>
        <div className="topbar-actions">
          <label className="context-setting" title="끄면 다음 요청은 이전 대화 없이 현재 메시지만 모델과 캐시에 전달됩니다.">
            <input
              aria-label="이전 대화 컨텍스트 유지"
              checked={contextMode === 'conversation'}
              disabled={streaming}
              onChange={(event) => changeContextMode(event.target.checked)}
              type="checkbox"
            />
            <span className="context-switch" aria-hidden="true" />
            <span className="context-setting-copy"><strong>컨텍스트 유지</strong><span>{contextMode === 'conversation' ? '켜짐' : '꺼짐'}</span></span>
          </label>
          <Button variant="secondary" aria-label="새 대화 만들기" onClick={createConversation} disabled={streaming || creatingConversation}><Plus size={17} aria-hidden /><span className="desktop-label">새 대화</span></Button>
        </div>
      </header>
      <div className={`conversation-workspace${selected ? '' : ' is-empty'}`}>
        <div className={`policy-banner policy-${policyState}`} role={policyState === 'blocked' ? 'alert' : 'status'}>
          {policyState === 'normal' ? <ShieldCheck size={18} aria-hidden /> : policyState === 'blocked' ? <AlertTriangle size={18} aria-hidden /> : <Gauge size={18} aria-hidden />}
          <div><strong>{policyCopy.label}</strong><span>{policyCopy.description}</span></div>
        </div>
        {error && <div className="chat-error" role="alert"><AlertTriangle size={18} aria-hidden /><span>{error.message}</span><button aria-label="오류 메시지 닫기" onClick={() => setError(null)}><X size={16} aria-hidden /></button></div>}
        <div className="message-stage">
          {!selected ? <div className="empty-chat"><div className="empty-chat-inner"><div className="empty-icon"><MessageSquareText size={30} aria-hidden /></div><h1>무엇을 함께 해결할까요?</h1><p>메시지를 보내면 새 대화를 만들고 조직의 정책 안에서 안전하게 답변합니다.</p></div></div>
            : messages.length === 0 && !historyLoading ? <div className="empty-chat"><div className="empty-chat-inner"><div className="empty-icon"><MessageSquareText size={30} aria-hidden /></div><h1>대화를 시작해 보세요</h1><p>업무 아이디어, 요약, 초안 작성을 요청할 수 있습니다. 메시지는 암호화된 대화 기록으로 복원됩니다.</p></div></div>
              : <ol ref={logRef} className="message-log" role="log" aria-live="polite" aria-relevant="additions text" aria-busy={streaming || historyLoading}>
                {messages.map((message) => <li key={message.localId ?? message.id} className={`message-row message-${message.role}`}>
                  {message.role === 'user' ? <UserMessage content={message.content} createdAt={message.createdAt} /> : <>
                    <div className="message-avatar" aria-hidden><MessageSquareText size={17} /></div>
                    <article>
                      <span className="message-author">GateLM</span>
                      {message.content
                        ? <MarkdownMessage content={message.content} />
                        : streaming && message === messages.at(-1) && !message.notice
                          ? <p>답변을 작성하고 있습니다…</p>
                          : null}
                      {message.notice && <div className="message-warning" role="alert"><AlertTriangle size={19} aria-hidden /><div><strong>요청을 처리할 수 없습니다.</strong><p>{message.notice.message}</p></div></div>}
                      {message.content && <div className="message-assistant-actions">
                        <MessageCopyButton content={message.content} label="모델 답변" />
                        {message.cacheOutcome === 'hit'
                          ? <div className="message-meta" aria-label="캐시 응답, 모델 호출 없음">캐시 응답 · 모델 호출 없음</div>
                          : message.effectiveModelKey
                            ? <ModelResponseMeta message={message} userMessagesByTurnId={userMessagesByTurnId} />
                            : null}
                      </div>}
                    </article>
                  </>}
                </li>)}
                {historyLoading && <li className="history-loading"><LoaderCircle className="spin" size={18} aria-hidden />대화 기록을 불러오는 중…</li>}
              </ol>}
          {selected && messageCursor && <Button className="history-more" variant="ghost" onClick={loadMoreMessages} disabled={historyLoading}>대화 기록 더 보기</Button>}
        </div>
        <form className="composer-area" onSubmit={sendMessage}>
          <div className={`composer${streaming ? ' is-streaming' : ''}`}>
            <label className="sr-only" htmlFor="chat-composer">메시지 입력</label>
            <textarea ref={composerRef} id="chat-composer" rows={1} maxLength={20000} value={composer} disabled={policyState === 'blocked'} placeholder={policyState === 'blocked' ? '조직 관리자에게 사용 한도를 문의해 주세요' : selected ? '메시지를 입력하세요' : '무엇이든 물어보세요'} onChange={(event) => setComposer(event.target.value)} onKeyDown={composerKeyDown} />
            {streaming ? <Button type="button" className="stop-button" aria-label={stopping ? '답변 생성 중지 중' : '답변 생성 중지'} onClick={stopStreaming} disabled={stopping}><Square size={16} fill="currentColor" aria-hidden /></Button>
              : <Button type="submit" className="send-button" aria-label="메시지 보내기" disabled={creatingConversation || !composer.trim() || policyState === 'blocked'}>{creatingConversation ? <LoaderCircle className="spin" size={18} aria-hidden /> : <Send size={18} aria-hidden />}</Button>}
          </div>
          <p className="composer-note">Enter로 전송 · Shift+Enter로 줄바꿈 · 답변은 확인이 필요할 수 있습니다.</p>
        </form>
      </div>
    </section>
  </main>;

  function restoreRenameFocus() {
    const id = renameReturnIdRef.current;
    if (!id) return;
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`button[data-rename-for="${id}"]`)?.focus();
      renameReturnIdRef.current = null;
    });
  }
}

type ConversationPage = Readonly<{ items: readonly Conversation[]; nextCursor: string | null }>;
type MessagePage = Readonly<{ items: readonly Message[]; nextCursor: string | null }>;
type DisplayMessage = Message & Readonly<{
  cacheOutcome?: 'off' | 'hit' | 'miss';
  localId?: string;
  notice?: SafeChatError;
  responseDurationMs?: number;
}>;

function UserMessage({ content, createdAt }: Readonly<{ content: string; createdAt: string }>) {
  return <article>
    <span className="sr-only">내 메시지</span>
    <p>{content}</p>
    <div className="message-user-actions">
      <MessageTime createdAt={createdAt} />
      <MessageCopyButton content={content} label="내 메시지" />
    </div>
  </article>;
}

function MessageTime({ createdAt }: Readonly<{ createdAt: string }>) {
  const [displayTime, setDisplayTime] = useState('');

  useEffect(() => {
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) {
      setDisplayTime('');
      return;
    }
    setDisplayTime(new Intl.DateTimeFormat('ko-KR', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date));
  }, [createdAt]);

  return <time dateTime={createdAt}>{displayTime}</time>;
}

function MessageCopyButton({ content, label }: Readonly<{ content: string; label: string }>) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
  }, []);

  async function copyMessage() {
    try {
      await copyTextToClipboard(content);
      showTemporaryCopyState('copied');
    } catch {
      showTemporaryCopyState('failed');
    }
  }

  function showTemporaryCopyState(nextState: 'copied' | 'failed') {
    setCopyState(nextState);
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => setCopyState('idle'), 1800);
  }

  const copyLabel = copyState === 'copied'
    ? `${label} 복사됨`
    : copyState === 'failed'
      ? `${label} 복사 실패, 다시 시도`
      : `${label} 복사`;

  return <>
    <button
      aria-label={copyLabel}
      className="message-copy-button"
      data-copy-state={copyState}
      onClick={() => void copyMessage()}
      title={copyLabel}
      type="button"
    >
      {copyState === 'copied' ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
    </button>
    <span className="sr-only" role="status">
      {copyState === 'copied' ? `${label}을 클립보드에 복사했습니다.` : copyState === 'failed' ? `${label}을 복사하지 못했습니다.` : ''}
    </span>
  </>;
}

function ModelResponseMeta({
  message,
  userMessagesByTurnId,
}: Readonly<{
  message: DisplayMessage;
  userMessagesByTurnId: ReadonlyMap<string, DisplayMessage>;
}>) {
  const metaText = modelResponseMetaText(message, userMessagesByTurnId);
  const brand = getModelBrand(message.effectiveModelKey);

  return <div className="message-meta message-model-meta" aria-label={`응답 ${metaText}`}>
    {brand && <span className="message-model-logo" data-brand={brand.key} aria-hidden="true">
      <Image alt="" height={16} src={brand.logoSrc} width={16} />
    </span>}
    <span>{metaText}</span>
  </div>;
}

function idempotencyKey(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

function modelResponseMetaText(
  message: DisplayMessage,
  userMessagesByTurnId: ReadonlyMap<string, DisplayMessage>,
): string {
  const durationMs = message.responseDurationMs ?? persistedResponseDurationMs(message, userMessagesByTurnId);
  const duration = durationMs === undefined
    ? ''
    : ` · ${Math.max(1, Math.round(durationMs / 1000))}s 소요`;
  return `${message.effectiveModelKey ?? ''}로 생성됨${duration}`;
}

function persistedResponseDurationMs(
  message: DisplayMessage,
  userMessagesByTurnId: ReadonlyMap<string, DisplayMessage>,
): number | undefined {
  const userMessage = userMessagesByTurnId.get(message.turnId);
  if (!userMessage) return undefined;
  const durationMs = Date.parse(message.createdAt) - Date.parse(userMessage.createdAt);
  return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : undefined;
}

function policyText(state: PolicyState): Readonly<{ label: string; description: string }> {
  if (state === 'warning') return { label: '사용량 주의', description: '조직 사용량이 기준에 가까워지고 있습니다.' };
  if (state === 'economy') return { label: '절약 모드', description: '비용을 아끼도록 경제적인 실행 경로를 사용합니다.' };
  if (state === 'blocked') return { label: '사용 한도 도달', description: '새 요청이 차단되었습니다. 조직 관리자에게 문의해 주세요.' };
  return { label: '정상 모드', description: '조직 정책과 사용 한도 안에서 실행 중입니다.' };
}
