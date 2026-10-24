import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api/client';
import { Send, Lock, MessageSquare, RefreshCw, AlertCircle, Reply, X } from 'lucide-react';
import { formatTime } from '../lib/dates';

const IS_COARSE_POINTER = window.matchMedia('(pointer: coarse)').matches;

export default function ChatTab({ group, currentUser, onRead }) {
  const [messages, setMessages] = useState([]);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [newMsg, setNewMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [highlightId, setHighlightId] = useState(null);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const lastMarkedReadId = useRef(0);
  const lastNewestMessageId = useRef(null);
  const scrollAfterSend = useRef(false);
  const nearBottom = useRef(false);
  const highlightTimeout = useRef(null);

  const fetchChat = useCallback(async () => {
    try {
      const data = await api.listMessages(group.id);
      setMessages(data.messages || []);
      setIsReadOnly(!!data.is_read_only);
      setError('');
    } catch (err) {
      setError(err.message || 'Could not load group messages');
    } finally {
      setLoading(false);
    }
  }, [group.id]);

  useEffect(() => {
    const newestMessageId = messages.reduce((newest, message) => Math.max(newest, message.id), 0);
    if (newestMessageId <= lastMarkedReadId.current) return;

    lastMarkedReadId.current = newestMessageId;
    api.markChatRead(group.id)
      .then(() => onRead?.())
      .catch((err) => {
        lastMarkedReadId.current = newestMessageId - 1;
        setError(err.message || 'Could not mark chat as read');
      });
  }, [messages, group.id, onRead]);

  useEffect(() => {
    let active = true;
    const loadChat = async () => {
      try {
        const data = await api.listMessages(group.id);
        if (active) {
          setMessages(data.messages || []);
          setIsReadOnly(!!data.is_read_only);
          setError('');
        }
      } catch (err) {
        if (active) setError(err.message || 'Could not load group messages');
      } finally {
        if (active) setLoading(false);
      }
    };
    loadChat();
    // 3-second polling for active group chat
    const interval = setInterval(loadChat, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [group.id]);

  useEffect(() => {
    if (loading) return;
    const newestMessageId = messages.reduce((newest, message) => Math.max(newest, message.id), 0);
    const firstLoad = lastNewestMessageId.current === null;
    const newestChanged = newestMessageId !== lastNewestMessageId.current;
    lastNewestMessageId.current = newestMessageId;

    if (firstLoad || scrollAfterSend.current || (newestChanged && nearBottom.current)) {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        nearBottom.current = true;
      }
    }
    scrollAfterSend.current = false;
  }, [messages, loading]);

  useEffect(() => () => clearTimeout(highlightTimeout.current), []);

  const jumpToOriginal = (id) => {
    if (!messages.some((message) => message.id === id)) return;
    document.getElementById(`chat-msg-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightId(id);
    clearTimeout(highlightTimeout.current);
    highlightTimeout.current = setTimeout(() => setHighlightId(null), 1200);
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMsg.trim() || isReadOnly) return;
    try {
      setSending(true);
      setError('');
      await api.sendMessage(group.id, newMsg.trim(), replyTo ? replyTo.id : null);
      scrollAfterSend.current = true;
      setReplyTo(null);
      setNewMsg('');
      await fetchChat();
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.focus();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-[min(600px,72vh)] min-h-[420px] flex-col overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-soft">
      {/* Chat Header */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-cream-50 p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-800 font-bold">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div>
            <p className="eyebrow mb-1">DEBT-SETTLE</p>
            <h3 className="font-bold text-sm text-ink-900">Group Coordination Chat</h3>
            <span className="text-[11px] text-slate-400 font-medium">
              Visible to all {group.members.length} members
            </span>
          </div>
        </div>

        {isReadOnly ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 bg-slate-200/80 px-2.5 py-1 rounded-full">
            <Lock className="w-3 h-3" /> Read-Only
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
            ● Active
          </span>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-50 border-b border-red-200 text-red-700 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Message Stream */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const element = e.currentTarget;
          nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
        }}
        className="flex-1 overflow-y-auto bg-cream-50/60 p-4 space-y-3"
      >
        {loading && messages.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-brand-600" />
            <span className="text-xs font-semibold">Loading messages...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="py-16 text-center space-y-2 text-slate-400">
            <MessageSquare className="w-8 h-8 mx-auto text-slate-300" />
            <p className="text-xs font-medium">No messages yet. Send a message to coordinate with group members!</p>
          </div>
        ) : (
          messages.map((m) => {
            const isMe = m.sender_username === currentUser.username;
            return (
              <div
                key={m.id}
                id={`chat-msg-${m.id}`}
                className={`group flex flex-col ${isMe ? 'items-end' : 'items-start'} ${
                  highlightId === m.id ? 'rounded-xl ring-2 ring-brand-400 ring-offset-2 transition' : ''
                }`}
              >
                <span className="text-[10px] text-slate-400 font-semibold mb-0.5 px-1">
                  @{m.sender_username} • {formatTime(m.created_at)}
                </span>
                <div className="flex items-end gap-1">
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-xs font-medium shadow-sm whitespace-pre-wrap break-words ${
                      isMe
                        ? 'bg-brand-600 text-white rounded-tr-none'
                        : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'
                    }`}
                  >
                    {m.reply_to && (
                      <button
                        type="button"
                        onClick={() => jumpToOriginal(m.reply_to.id)}
                        className={`mb-2 block w-full rounded-lg border-l-2 border-brand-400 px-2 py-1 text-left ${
                          isMe ? 'bg-brand-700/60 text-white' : 'bg-slate-50 text-slate-700'
                        }`}
                      >
                        <span className="block font-bold">@{m.reply_to.sender_username}</span>
                        <span className="line-clamp-2">{m.reply_to.body}</span>
                      </button>
                    )}
                    {m.body}
                  </div>
                  <button
                    type="button"
                    aria-label="Reply"
                    title="Reply"
                    onClick={() => {
                      setReplyTo(m);
                      textareaRef.current?.focus();
                    }}
                    className={`min-h-0 h-7 w-7 rounded-full p-1 text-slate-500 hover:bg-slate-200 ${
                      IS_COARSE_POINTER ? 'opacity-60' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                    }`}
                  >
                    <Reply className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input or Closed Notice */}
      <div className="border-t border-slate-100 bg-white p-3">
        {isReadOnly ? (
          <div className="p-3 bg-cream-50 rounded-xl border border-slate-200 text-center text-xs text-slate-500 font-medium flex items-center justify-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-slate-400" />
            <span>Chat is closed. All debts are settled and group is read-only.</span>
          </div>
        ) : (
          <form onSubmit={handleSendMessage} className="flex gap-2">
            <div className="min-w-0 flex-1">
              {replyTo && (
                <div className="mb-2 flex items-center justify-between gap-2 border-l-2 border-brand-500 bg-cream-50 px-2.5 py-1.5">
                  <div className="min-w-0 text-xs">
                    <p className="font-bold text-ink-900">Replying to @{replyTo.sender_username}</p>
                    <p className="truncate text-slate-500">{replyTo.body}</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Cancel reply"
                    onClick={() => setReplyTo(null)}
                    className="min-h-0 h-7 w-7 shrink-0 rounded-full p-1 text-slate-500 hover:bg-slate-200"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
              <textarea
                ref={textareaRef}
                rows={1}
                placeholder={IS_COARSE_POINTER ? 'Message' : "Type a message (e.g. 'Paid on GPay, please confirm!')"}
                aria-label="Message"
                value={newMsg}
                onChange={(e) => {
                  setNewMsg(e.target.value);
                  e.currentTarget.style.height = 'auto';
                  e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 120)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && !IS_COARSE_POINTER && replyTo) {
                    setReplyTo(null);
                  }
                  if (e.key === 'Enter' && !e.shiftKey && !IS_COARSE_POINTER && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    handleSendMessage(e);
                  }
                }}
                disabled={sending}
                className="min-h-[44px] max-h-[120px] w-full resize-none overflow-y-auto px-3.5 py-3 text-sm"
              />
              {!IS_COARSE_POINTER && (
                <p className="pt-1 text-[10px] text-slate-400">Enter to send, Shift+Enter for a new line</p>
              )}
            </div>
            <button
              type="submit"
              disabled={sending || !newMsg.trim()}
              className="primary-btn shrink-0 px-4 text-xs"
              aria-label={IS_COARSE_POINTER ? 'Send message' : undefined}
            >
              <Send className="w-3.5 h-3.5" />
              {!IS_COARSE_POINTER && <span>Send</span>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
