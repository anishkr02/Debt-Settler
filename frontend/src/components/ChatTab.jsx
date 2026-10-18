import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api/client';
import { Send, Lock, MessageSquare, RefreshCw, AlertCircle } from 'lucide-react';

export default function ChatTab({ group, currentUser }) {
  const [messages, setMessages] = useState([]);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [newMsg, setNewMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);

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
    // Scroll to bottom on new messages
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMsg.trim() || isReadOnly) return;
    try {
      setSending(true);
      setError('');
      await api.sendMessage(group.id, newMsg.trim());
      setNewMsg('');
      await fetchChat();
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-cream-50/60 p-4 space-y-3">
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
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
              >
                <span className="text-[10px] text-slate-400 font-semibold mb-0.5 px-1">
                  @{m.sender_username} • {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-xs font-medium shadow-sm ${
                    isMe
                      ? 'bg-brand-600 text-white rounded-tr-none'
                      : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'
                  }`}
                >
                  {m.body}
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
            <input
              type="text"
              placeholder="Type message (e.g. 'Paid on GPay, please confirm!')..."
              value={newMsg}
              onChange={(e) => setNewMsg(e.target.value)}
              disabled={sending}
              className="min-h-[44px] min-w-0 flex-1 px-3.5 text-sm"
            />
            <button
              type="submit"
              disabled={sending || !newMsg.trim()}
              className="primary-btn shrink-0 px-4 text-xs"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
