import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { api } from '../api/client';
import {
  ChevronRight, Users, RefreshCw, AlertCircle,
  Mail, Copy, Check, X,
  ChevronLeft, Plus,
} from 'lucide-react';
import InvitePanel from './InvitePanel';
import InstallPrompt from './InstallPrompt';
import { buildJoinUrl, copyText } from '../lib/joinLink';
import { parseServerDate } from '../lib/dates';

// ─── tiny shared input style ─────────────────────────────────────────────────
const INPUT =
  'w-full px-4 py-3 border border-slate-300 rounded-2xl text-sm bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-brand-600 placeholder:text-slate-400';

// ─── Step 1: Group details ────────────────────────────────────────────────────
function StepGroupDetails({ groupName, setGroupName, adminUpi, setAdminUpi, onNext }) {
  const nameRef = useRef(null);
  useEffect(() => { nameRef.current?.focus(); }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (groupName.trim()) {
      onNext();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full">
      <h2 className="text-3xl font-black text-slate-900 leading-tight mb-1">
        Create your<br />group
      </h2>
      <p className="text-sm text-slate-500 mb-8">
        Name it anything — Goa Trip, Flat 402, Hostel Mess.
      </p>

      <div className="space-y-5 flex-1">
        <div>
          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
            Group name *
          </label>
          <input
            ref={nameRef}
            className={INPUT}
            placeholder="Weekend in Goa"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
            Your UPI ID <span className="normal-case font-normal text-slate-400">(optional)</span>
          </label>
          <input
            className={INPUT}
            placeholder="name@upi"
            value={adminUpi}
            onChange={(e) => setAdminUpi(e.target.value)}
          />
          <p className="text-[11px] text-slate-400 mt-1.5">
            UPI IDs are only used to create payment links. Keep them accurate.
          </p>
        </div>
      </div>

      <button
        type="submit"
        disabled={!groupName.trim()}
        className="mt-8 w-full py-4 rounded-2xl bg-brand-600 hover:bg-brand-700
                   text-white font-bold text-base transition disabled:opacity-40 active:scale-[0.99]"
      >
        Next →
      </button>
    </form>
  );
}

// ─── Step 2: Invite members ───────────────────────────────────────────────────
function StepInviteMembers({
  currentUser,
  chips,
  setChips,
  onSubmitCreate,
  submitting,
  submitError,
}) {
  // The group doesn't exist yet, so "adding" only stages a chip. The invites
  // are sent after the group is created (see handleFinalCreate).
  const stageChip = (chip) => {
    const dup = chips.some((c) => c.type === chip.type && c.value.toLowerCase() === chip.value.toLowerCase());
    if (dup) throw new Error(`${chip.label} is already in the invite list`);
    setChips((prev) => [...prev, chip]);
  };

  const onAddUsername = (username) =>
    stageChip({ type: 'username', value: username, label: `@${username}` });
  const onAddEmail = (email) =>
    stageChip({ type: 'email', value: email, label: `${email} (pending)` });

  const removeChip = (indexToRemove) =>
    setChips((prev) => prev.filter((_, idx) => idx !== indexToRemove));

  const inviteCount = chips.length;
  const buttonLabel = submitting
    ? 'Creating group…'
    : inviteCount > 0
    ? `Create group + ${inviteCount} invite${inviteCount > 1 ? 's' : ''}`
    : 'Create group';

  return (
    <div className="flex flex-col h-full">
      <h2 className="text-3xl font-black text-slate-900 leading-tight mb-1">
        Invite members
      </h2>
      <p className="text-sm text-slate-500 mb-5">
        Add people now, or skip and invite later from the Members tab.
      </p>

      {chips.length > 0 && (
        <div className="mb-4 p-3 bg-white border border-slate-200 rounded-2xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">
              Added ({chips.length})
            </span>
            <button
              type="button"
              onClick={() => setChips([])}
              className="text-[11px] font-semibold text-slate-400 hover:text-red-600 transition"
            >
              Clear all
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
            {chips.map((chip, idx) => (
              <span
                key={`${chip.type}-${chip.value}`}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-brand-50 border border-brand-200 text-brand-900 rounded-xl text-xs font-semibold"
              >
                <span>{chip.label}</span>
                <button
                  type="button"
                  onClick={() => removeChip(idx)}
                  className="text-brand-700 hover:text-red-600 font-bold ml-0.5"
                  title="Remove"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {submitError && (
        <div className="mb-4 flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{submitError}</span>
        </div>
      )}

      <div className="flex-1">
        <InvitePanel
          currentUsername={currentUser?.username}
          excludeUsernames={[]}
          onAddUsername={onAddUsername}
          onAddEmail={onAddEmail}
        />
      </div>

      <button
        type="button"
        onClick={onSubmitCreate}
        disabled={submitting}
        className="mt-6 w-full py-4 rounded-2xl bg-brand-600 hover:bg-brand-700
                   text-white font-bold text-base transition disabled:opacity-50 active:scale-[0.99] shadow-md flex items-center justify-center gap-2"
      >
        {submitting && <RefreshCw className="w-4 h-4 animate-spin" />}
        <span>{buttonLabel}</span>
      </button>
    </div>
  );
}

// ─── Step 3: Result Summary Screen ───────────────────────────────────────────
function StepResultSummary({ summary, onOpenGroup }) {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    if (!summary?.joinLink) return;
    const ok = await copyText(summary.joinLink);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex flex-col h-full space-y-5">
      <div>
        <span className="text-[11px] font-bold text-brand-600 uppercase tracking-wider block mb-1">
          Group Created Successfully
        </span>
        <h2 className="text-3xl font-black text-slate-900 leading-tight">
          {summary.groupName}
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Here is your invite summary:
        </p>
      </div>

      {/* Added Members */}
      {summary.added && summary.added.length > 0 && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
            <Check className="w-4 h-4 text-emerald-600" />
            <span>Added to group ({summary.added.length})</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {summary.added.map((uname, idx) => (
              <span
                key={idx}
                className="px-2.5 py-0.5 bg-emerald-100 text-emerald-900 text-xs font-semibold rounded-lg"
              >
                {uname}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Pending Email Invites */}
      {summary.pending && summary.pending.length > 0 && (
        <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-2xl space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-blue-800">
            <Mail className="w-4 h-4 text-blue-600" />
            <span>Email invites pending signup ({summary.pending.length})</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {summary.pending.map((em, idx) => (
              <span
                key={idx}
                className="px-2.5 py-0.5 bg-blue-100 text-blue-900 text-xs font-semibold rounded-lg"
              >
                {em}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-blue-700">
            We don&apos;t send emails. Share the link below. They&apos;re added when they sign in with that email.
          </p>
        </div>
      )}

      {/* Failures */}
      {summary.failures && summary.failures.length > 0 && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-red-800">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <span>Failed invites ({summary.failures.length})</span>
          </div>
          <ul className="text-xs text-red-700 divide-y divide-red-100">
            {summary.failures.map((f, idx) => (
              <li key={idx} className="py-1 flex items-start justify-between gap-2">
                <span className="font-bold">{f.target}</span>
                <span className="text-red-600 text-right">{f.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Join Link */}
      {summary.joinLink && (
        <div className="space-y-2 pt-1">
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
            Shareable Join Link
          </label>
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl px-3.5 py-2.5">
            <input
              readOnly
              value={summary.joinLink}
              className="flex-1 text-xs text-slate-700 bg-transparent focus:outline-none truncate"
            />
            <button
              type="button"
              onClick={copyLink}
              className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white text-xs font-bold rounded-xl transition hover:bg-slate-700 flex-shrink-0"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy'}</span>
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            Anyone signed into Debt-Settle can open this link to join instantly.
          </p>
        </div>
      )}

      {/* Open Group CTA */}
      <div className="pt-2">
        <button
          type="button"
          onClick={onOpenGroup}
          className="w-full py-4 rounded-2xl bg-brand-600 hover:bg-brand-700
                     text-white font-bold text-base transition active:scale-[0.99] shadow-md flex items-center justify-center gap-2"
        >
          <span>Open group →</span>
        </button>
      </div>
    </div>
  );
}

// ─── Create Group Modal (Flow Controller) ────────────────────────────────────
function CreateGroupModal({ user, onClose, onCreated }) {
  const [step, setStep] = useState(1); // 1 = Details, 2 = Invites, 3 = Summary
  const [groupName, setGroupName] = useState('');
  const [adminUpi, setAdminUpi] = useState(
    localStorage.getItem('debt_settle_last_upi') || ''
  );
  const [chips, setChips] = useState([]); // [{ type: 'username'|'email', value, label }]
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [summary, setSummary] = useState(null);

  // Step 1 -> Step 2: NO API call, purely local state progression!
  const handleNextToStep2 = () => {
    if (!groupName.trim()) return;
    setStep(2);
  };

  // Step 2 Final Submit: Creates group, sends invites, fetches join link
  const handleFinalCreate = async () => {
    try {
      setSubmitting(true);
      setSubmitError('');

      // 1. Create Group
      const newGroup = await api.createGroup(groupName.trim(), adminUpi.trim() || null);
      if (adminUpi.trim()) {
        localStorage.setItem('debt_settle_last_upi', adminUpi.trim());
      }

      // 2. Process invites
      const addedList = [];
      const pendingList = [];
      const failuresList = [];

      for (const chip of chips) {
        try {
          if (chip.type === 'username') {
            await api.inviteMember(newGroup.id, {
              method: 'username',
              username: chip.value,
            });
            addedList.push(`@${chip.value}`);
          } else if (chip.type === 'email') {
            const res = await api.inviteMember(newGroup.id, {
              method: 'email',
              email: chip.value,
            });
            // If that email already has an account, the server adds them straight away.
            if (res.status === 'added' || res.status === 'already_member') {
              addedList.push(chip.value);
            } else {
              pendingList.push(chip.value);
            }
          }
        } catch (err) {
          failuresList.push({
            target: chip.type === 'username' ? `@${chip.value}` : chip.value,
            reason: err.message || 'Failed to send invite',
          });
        }
      }

      // 3. Generate join link
      let joinLink = '';
      try {
        const linkRes = await api.inviteMember(newGroup.id, { method: 'join_link' });
        joinLink = buildJoinUrl(linkRes.join_token);
      } catch {
        // join link fallback if error
      }

      setSummary({
        groupId: newGroup.id,
        groupName: newGroup.name,
        added: addedList,
        pending: pendingList,
        failures: failuresList,
        joinLink,
      });

      setStep(3);
    } catch (err) {
      setSubmitError(err.message || 'Failed to create group');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-cream-100 w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-2xl
                      flex flex-col p-6 pb-8 max-h-[92vh] overflow-y-auto">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-5">
          {step === 2 && (
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex items-center gap-1 text-sm font-bold text-slate-600 hover:text-slate-900"
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
          )}
          {step === 1 && (
            <span className="text-xs font-bold text-brand-600 uppercase tracking-widest">
              DEBT-SETTLE
            </span>
          )}
          {step === 3 && (
            <span className="text-xs font-bold text-emerald-700 uppercase tracking-widest">
              COMPLETED
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              if (step === 3 && summary?.groupId) {
                onCreated(summary.groupId);
              } else {
                onClose();
              }
            }}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white border border-slate-200 text-slate-500 hover:text-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {step === 1 && (
          <StepGroupDetails
            groupName={groupName}
            setGroupName={setGroupName}
            adminUpi={adminUpi}
            setAdminUpi={setAdminUpi}
            onNext={handleNextToStep2}
          />
        )}

        {step === 2 && (
          <StepInviteMembers
            currentUser={user}
            chips={chips}
            setChips={setChips}
            onSubmitCreate={handleFinalCreate}
            submitting={submitting}
            submitError={submitError}
          />
        )}

        {step === 3 && summary && (
          <StepResultSummary
            summary={summary}
            onOpenGroup={() => onCreated(summary.groupId)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
export default function DashboardScreen({ user, onSelectGroup }) {
  const [groups, setGroups]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const sortedGroups = useMemo(() => [...groups].sort((a, b) => {
    const timeDifference = parseServerDate(b.last_activity_at || b.created_at).getTime()
      - parseServerDate(a.last_activity_at || a.created_at).getTime();
    return Number.isNaN(timeDifference) || timeDifference === 0
      ? b.id - a.id
      : timeDifference;
  }), [groups]);

  const fetchGroups = useCallback(async () => {
    try {
      setGroups(await api.listGroups());
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const loadGroups = async () => {
      try {
        const groupsData = await api.listGroups();
        if (active) {
          setGroups(groupsData);
          setError('');
        }
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    };
    loadGroups();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchGroups();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchGroups]);

  useEffect(() => {
    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') fetchGroups();
    };
    document.addEventListener('visibilitychange', refreshOnVisible);
    return () => document.removeEventListener('visibilitychange', refreshOnVisible);
  }, [fetchGroups]);

  const handleCreated = async (id) => {
    setShowCreate(false);
    await fetchGroups();
    onSelectGroup(id);
  };

  return (
    <div className="min-h-screen bg-cream-100 flex flex-col">
      <InstallPrompt />
      {/* Header */}
      <section className="hero-card mx-1 mt-3 mb-6">
        <p className="eyebrow mb-2 text-brand-300">
          DEBT-SETTLE
        </p>
        <h1 className="text-3xl font-black leading-tight text-white sm:text-4xl">Your groups</h1>
        <p className="mt-2 text-sm text-slate-300">Keep shared money simple.</p>
      </section>

      {error && (
        <div className="mx-1 mb-3 flex items-center gap-2 text-xs text-red-700
                        bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {/* Group list */}
      <div className="flex-1 px-1">
        {loading && groups.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-6 h-6 animate-spin text-brand-600" />
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-brand-100 flex items-center justify-center">
              <Users className="w-8 h-8 text-brand-600" />
            </div>
            <p className="font-bold text-slate-700 text-lg">No groups yet</p>
            <p className="text-sm text-slate-500 max-w-xs">
              Create your first group to start tracking and settling shared expenses.
            </p>
          </div>
        ) : (
          <div className="space-y-2 pb-28">
            {sortedGroups.map((g) => (
              <button
                key={g.id}
                onClick={() => onSelectGroup(g.id)}
                className="w-full flex items-center gap-4 bg-white rounded-2xl px-4 py-3.5
                           border border-slate-200 hover:border-brand-400 hover:shadow-sm
                           transition active:scale-[0.99] text-left"
              >
                {/* Avatar */}
                <div className="w-11 h-11 rounded-xl bg-brand-600 text-white flex items-center
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
                  {g.unread_total_count > 0 && (
                    <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                      {g.unread_total_count > 99 ? '99+' : g.unread_total_count}
                    </span>
                  )}
                  {g.fully_settled_at && (
                    <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                      Settled
                    </span>
                  )}
                  {!g.fully_settled_at && g.is_frozen && (
                    <span className="text-[10px] font-bold bg-brand-100 text-brand-800 px-2 py-0.5 rounded-full">
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
      <div className="fixed bottom-0 left-0 right-0 border-t border-slate-200/80 bg-cream-100 px-5 pb-5 pt-3">
        <button
          onClick={() => setShowCreate(true)}
          className="w-full max-w-md mx-auto flex items-center justify-center gap-2
                     min-h-[52px] py-4 rounded-2xl bg-brand-600 hover:bg-brand-700
                     text-white font-bold text-base shadow-soft transition active:scale-[0.99]"
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
