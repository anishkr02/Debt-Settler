import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';
import {
  ChevronRight, Users, RefreshCw, AlertCircle,
  AtSign, Link2, Mail, Search, Copy, Check, X,
  ChevronLeft, Plus,
} from 'lucide-react';

// ─── tiny shared input style ─────────────────────────────────────────────────
const INPUT =
  'w-full px-4 py-3 border border-slate-300 rounded-2xl text-sm bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-olive-primary placeholder:text-slate-400';

// ─── Step 1: Group details ────────────────────────────────────────────────────
function StepGroupDetails({ onNext, defaultUpi }) {
  const [name, setName] = useState('');
  const [upi, setUpi] = useState(defaultUpi || '');
  const nameRef = useRef(null);
  useEffect(() => { nameRef.current?.focus(); }, []);

  return (
    <div className="flex flex-col h-full">
      <h2 className="text-3xl font-black text-slate-900 leading-tight mb-1">
        Create your<br />group
      </h2>
      <p className="text-sm text-slate-500 mb-8">
        Name it anything — Goa Trip, Flat 402, Hostel Mess.
      </p>

      <div className="space-y-5 flex-1">
        <div>
          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
            Group name
          </label>
          <input
            ref={nameRef}
            className={INPUT}
            placeholder="Weekend in Goa"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
            Your UPI ID <span className="normal-case font-normal text-slate-400">(optional)</span>
          </label>
          <input
            className={INPUT}
            placeholder="name@upi"
            value={upi}
            onChange={(e) => setUpi(e.target.value)}
          />
          <p className="text-[11px] text-slate-400 mt-1.5">
            UPI IDs are only used to create payment links. Keep them accurate.
          </p>
        </div>
      </div>

      <button
        onClick={() => onNext(name.trim(), upi.trim())}
        disabled={!name.trim()}
        className="mt-8 w-full py-4 rounded-2xl bg-olive-primary hover:bg-olive-700
                   text-white font-bold text-base transition disabled:opacity-40 active:scale-[0.99]"
      >
        Next →
      </button>
    </div>
  );
}

// ─── Step 2: Invite members ───────────────────────────────────────────────────
function StepInviteMembers({ groupId, joinLinkUrl, onDone }) {
  const [method, setMethod] = useState('username');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [email, setEmail] = useState('');
  const [link, setLink] = useState(joinLinkUrl || '');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState([]); // list of {label, msg}
  const [successes, setSuccesses] = useState([]);

  // Auto-generate join link when tab is opened
  useEffect(() => {
    if (method === 'join_link' && !link) generateLink();
  }, [method]); // eslint-disable-line

  const generateLink = async () => {
    try {
      setLoading(true);
      const data = await api.inviteMember(groupId, { method: 'join_link' });
      const url = `${window.location.origin}/#join=${data.join_token}`;
      setLink(url);
    } catch (e) {
      addError('Join link', e.message);
    } finally {
      setLoading(false);
    }
  };

  const addError = (label, msg) =>
    setErrors((prev) => [...prev, { label, msg }]);
  const addSuccess = (msg) => setSuccesses((prev) => [...prev, msg]);

  const handleSearch = async (q) => {
    setQuery(q);
    if (q.length < 2) { setResults([]); return; }
    try {
      setSearching(true);
      setResults(await api.searchUsers(q));
    } catch { /* ignore */ } finally { setSearching(false); }
  };

  const handleAddByUsername = async (uname) => {
    try {
      setLoading(true);
      await api.inviteMember(groupId, { method: 'username', username: uname });
      addSuccess(`@${uname} added ✓`);
      setQuery(''); setResults([]);
    } catch (e) {
      addError(`@${uname}`, e.message);
    } finally { setLoading(false); }
  };

  const handleSendEmail = async (e) => {
    e.preventDefault();
    const addr = email.trim();
    if (!addr) return;
    try {
      setLoading(true);
      await api.inviteMember(groupId, { method: 'email', email: addr });
      addSuccess(`Invite sent to ${addr} ✓`);
      setEmail('');
    } catch (err) {
      addError(addr, err.message);
    } finally { setLoading(false); }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const TABS = [
    { id: 'username', label: 'Username', icon: AtSign },
    { id: 'join_link', label: 'Link',     icon: Link2  },
    { id: 'email',    label: 'Email',     icon: Mail   },
  ];

  return (
    <div className="flex flex-col h-full">
      <h2 className="text-3xl font-black text-slate-900 leading-tight mb-1">
        Invite members
      </h2>
      <p className="text-sm text-slate-500 mb-6">
        Add people now, or skip and invite later from the Members tab.
      </p>

      {/* Successes */}
      {successes.length > 0 && (
        <div className="mb-4 space-y-1">
          {successes.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-xs font-semibold text-emerald-700
                                    bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
              <Check className="w-3.5 h-3.5 flex-shrink-0" /> {s}
            </div>
          ))}
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div className="mb-4 space-y-1">
          {errors.map((err, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-red-700
                                    bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span><span className="font-bold">{err.label}:</span> {err.msg}</span>
            </div>
          ))}
        </div>
      )}

      {/* Method tabs */}
      <div className="flex gap-1 p-1 bg-white rounded-2xl border border-slate-200 mb-5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setMethod(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-xl transition
              ${method === id
                ? 'bg-olive-primary text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-800'}`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {/* Panel body */}
      <div className="flex-1">
        {/* — By Username — */}
        {method === 'username' && (
          <div className="space-y-3">
            <div className="relative">
              <input
                className={INPUT + ' pl-10'}
                placeholder="Search by username…"
                value={query}
                onChange={(e) => handleSearch(e.target.value)}
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            </div>
            {searching && (
              <p className="text-xs text-slate-400 italic">Searching…</p>
            )}
            {results.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100 overflow-hidden max-h-44 overflow-y-auto">
                {results.map((u) => (
                  <div key={u.id} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm font-semibold text-slate-800">@{u.username}</span>
                    <button
                      onClick={() => handleAddByUsername(u.username)}
                      disabled={loading}
                      className="px-3 py-1 bg-olive-primary text-white text-xs font-bold rounded-xl transition hover:bg-olive-700 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* — Join Link — */}
        {method === 'join_link' && (
          <div className="space-y-3">
            {loading && !link && (
              <p className="text-xs text-slate-400 italic">Generating link…</p>
            )}
            {link ? (
              <>
                <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl px-4 py-3">
                  <input
                    readOnly
                    value={link}
                    className="flex-1 text-xs text-slate-700 bg-transparent focus:outline-none truncate"
                  />
                  <button
                    onClick={copyLink}
                    className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white text-xs font-bold rounded-xl transition hover:bg-slate-700"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  Anyone signed into Debt-Settle can open this link to join instantly.
                </p>
              </>
            ) : (
              <button
                onClick={generateLink}
                disabled={loading}
                className="w-full py-3 rounded-2xl border-2 border-dashed border-olive-300 text-olive-primary text-sm font-bold hover:bg-olive-50 transition"
              >
                Generate shareable link
              </button>
            )}
          </div>
        )}

        {/* — By Email — */}
        {method === 'email' && (
          <form onSubmit={handleSendEmail} className="space-y-3">
            <input
              type="email"
              required
              className={INPUT}
              placeholder="friend@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className="text-[11px] text-slate-400">
              They'll be auto-added to this group when they sign up with this email.
            </p>
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full py-3 rounded-2xl bg-olive-primary text-white font-bold text-sm transition hover:bg-olive-700 disabled:opacity-50"
            >
              {loading ? 'Sending…' : 'Send Invite'}
            </button>
          </form>
        )}
      </div>

      {/* Footer */}
      <button
        onClick={onDone}
        className="mt-8 w-full py-4 rounded-2xl bg-olive-primary hover:bg-olive-700
                   text-white font-bold text-base transition active:scale-[0.99]"
      >
        Open Group →
      </button>
      <button
        onClick={onDone}
        className="mt-2 w-full py-2 text-sm text-slate-500 hover:text-slate-700 font-semibold"
      >
        Invite later
      </button>
    </div>
  );
}

// ─── Create Group Modal (2-step) ──────────────────────────────────────────────
function CreateGroupModal({ user, onClose, onCreated }) {
  const [step, setStep] = useState(1); // 1 | 2
  const [newGroupId, setNewGroupId] = useState(null);
  const [joinLinkUrl, setJoinLinkUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Persist last-used UPI across sessions
  const defaultUpi = localStorage.getItem('debt_settle_last_upi') || '';

  const handleStep1 = async (name, upi) => {
    try {
      setSubmitting(true);
      setError('');
      const group = await api.createGroup(name, upi || null);
      if (upi) localStorage.setItem('debt_settle_last_upi', upi);
      setNewGroupId(group.id);
      setStep(2);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Sheet on mobile, centered card on desktop */}
      <div className="bg-cream-100 w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-2xl
                      flex flex-col p-6 pb-8 max-h-[92vh] overflow-y-auto">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6">
          {step === 2 ? (
            <button
              onClick={() => setStep(1)}
              className="flex items-center gap-1 text-sm font-bold text-slate-600 hover:text-slate-900"
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
          ) : (
            <span className="text-xs font-bold text-olive-primary uppercase tracking-widest">
              DEBT-SETTLE
            </span>
          )}
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white border border-slate-200 text-slate-500 hover:text-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}

        {submitting && (
          <div className="mb-4 flex items-center gap-2 text-xs text-olive-700 bg-olive-50 border border-olive-200 rounded-xl px-3 py-2">
            <RefreshCw className="w-4 h-4 animate-spin flex-shrink-0" /> Creating group…
          </div>
        )}

        {step === 1 && (
          <StepGroupDetails
            onNext={handleStep1}
            defaultUpi={defaultUpi}
          />
        )}
        {step === 2 && newGroupId && (
          <StepInviteMembers
            groupId={newGroupId}
            joinLinkUrl={joinLinkUrl}
            onDone={() => { onCreated(newGroupId); }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
export default function DashboardScreen({ user, onSelectGroup }) {
  const [groups, setGroups]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [showCreate, setShowCreate]   = useState(false);

  const fetchGroups = async () => {
    try {
      setLoading(true);
      setError('');
      setGroups(await api.listGroups());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchGroups(); }, []);

  const handleCreated = async (id) => {
    setShowCreate(false);
    await fetchGroups();
    onSelectGroup(id);
  };

  return (
    <div className="min-h-screen bg-cream-100 flex flex-col">
      {/* Header */}
      <div className="px-5 pt-10 pb-4">
        <p className="text-xs font-bold text-olive-primary uppercase tracking-widest mb-1">
          DEBT-SETTLE
        </p>
        <h1 className="text-4xl font-black text-slate-900 leading-tight">Your groups</h1>
        <p className="text-sm text-slate-500 mt-1">Keep shared money simple.</p>
      </div>

      {error && (
        <div className="mx-5 mb-3 flex items-center gap-2 text-xs text-red-700
                        bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {/* Group list */}
      <div className="flex-1 px-5">
        {loading && groups.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-6 h-6 animate-spin text-olive-primary" />
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-olive-100 flex items-center justify-center">
              <Users className="w-8 h-8 text-olive-primary" />
            </div>
            <p className="font-bold text-slate-700 text-lg">No groups yet</p>
            <p className="text-sm text-slate-500 max-w-xs">
              Create your first group to start tracking and settling shared expenses.
            </p>
          </div>
        ) : (
          <div className="space-y-2 pb-28">
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => onSelectGroup(g.id)}
                className="w-full flex items-center gap-4 bg-white rounded-2xl px-4 py-3.5
                           border border-slate-200 hover:border-olive-400 hover:shadow-sm
                           transition active:scale-[0.99] text-left"
              >
                {/* Avatar */}
                <div className="w-11 h-11 rounded-xl bg-olive-primary text-white flex items-center
                                justify-center font-black text-lg flex-shrink-0">
                  {g.name[0].toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-900 truncate">{g.name}</p>
                  <p className="text-xs text-slate-500">
                    {g.members_count} {g.members_count === 1 ? 'member' : 'members'}
                    {' · '}
                    {g.expenses_count} {g.expenses_count === 1 ? 'entry' : 'entries'}
                  </p>
                </div>

                {/* Status / arrow */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {g.fully_settled_at && (
                    <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                      Settled
                    </span>
                  )}
                  {!g.fully_settled_at && g.is_frozen && (
                    <span className="text-[10px] font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                      Frozen
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Pinned CTA */}
      <div className="fixed bottom-0 left-0 right-0 px-5 pb-6 pt-3
                      bg-gradient-to-t from-cream-100 via-cream-100/90 to-transparent">
        <button
          onClick={() => setShowCreate(true)}
          className="w-full max-w-md mx-auto flex items-center justify-center gap-2
                     py-4 rounded-2xl bg-olive-primary hover:bg-olive-700
                     text-white font-bold text-base shadow-lg transition active:scale-[0.99]"
        >
          <Plus className="w-5 h-5" />
          Create a new group
        </button>
      </div>

      {/* Create Group Modal */}
      {showCreate && (
        <CreateGroupModal
          user={user}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
