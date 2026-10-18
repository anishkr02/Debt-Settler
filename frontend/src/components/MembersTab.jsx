import React, { useState } from 'react';
import { api } from '../api/client';
import { UserPlus, Shield, Check, X, Pencil, AlertCircle } from 'lucide-react';
import InvitePanel from './InvitePanel';
import { buildJoinUrl } from '../lib/joinLink';

const UPI_REGEX = /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9]{1,63}$/;

export default function MembersTab({ group, currentUser, onMemberUpdated }) {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  // Inline UPI editing state for current user
  const [isEditingUpi, setIsEditingUpi] = useState(false);
  const [upiInput, setUpiInput] = useState('');
  const [upiSaving, setUpiSaving] = useState(false);
  const [upiError, setUpiError] = useState('');

  // Each of these runs the real API call; the InvitePanel shows any error
  // and the returned message.
  const addByUsername = async (username) => {
    const res = await api.inviteMember(group.id, { method: 'username', username });
    if (onMemberUpdated) onMemberUpdated();
    const msg = res.status === 'already_member'
      ? `@${username} is already in this group`
      : `@${username} was added to the group`;
    setSuccessMsg(msg);
    return msg;
  };

  const addByEmail = async (email) => {
    const res = await api.inviteMember(group.id, { method: 'email', email });
    if (onMemberUpdated) onMemberUpdated();
    const msg = res.status === 'added'
      ? `${email} already has an account, so they were added to the group`
      : res.status === 'already_member'
      ? `${email} is already in this group`
      : `Saved. ${email} is added when they sign in with this email. We don't send emails, so share the link too.`;
    setSuccessMsg(msg);
    return msg;
  };

  const requestLink = async () => {
    const res = await api.inviteMember(group.id, { method: 'join_link' });
    return buildJoinUrl(res.join_token);
  };

  const handleStartEditUpi = (currentUpi) => {
    setUpiInput(currentUpi || '');
    setUpiError('');
    setIsEditingUpi(true);
  };

  const handleSaveUpi = async () => {
    const trimmed = upiInput.trim();
    if (trimmed && !UPI_REGEX.test(trimmed)) {
      setUpiError('Invalid UPI ID format. Use 2-64 letters, numbers, dots, underscores, or hyphens, followed by @ and a valid handle (e.g. name@okaxis).');
      return;
    }

    setUpiSaving(true);
    setUpiError('');
    try {
      await api.updateMyMemberUpi(group.id, trimmed || null);
      setIsEditingUpi(false);
      setSuccessMsg(trimmed ? 'UPI ID updated successfully!' : 'UPI ID cleared successfully!');
      if (onMemberUpdated) onMemberUpdated();
    } catch (err) {
      setUpiError(err.message || 'Failed to update UPI ID');
    } finally {
      setUpiSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="content-card flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="eyebrow mb-1">DEBT-SETTLE</p>
          <h2 className="text-lg font-bold text-ink-900">Group Members</h2>
          <p className="text-xs text-slate-500 font-medium">Manage members, UPI payment handles, and group invites.</p>
        </div>

        <button
          onClick={() => {
            setShowInviteModal(true);
            setSuccessMsg('');
          }}
          className="primary-btn"
        >
          <UserPlus className="w-4 h-4" />
          <span>Invite Member</span>
        </button>
      </div>

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-xl flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMsg('')}
            className="text-emerald-700 hover:text-emerald-900 text-xs font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Members Roster */}
      <div className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-soft divide-y divide-slate-100">
        {group.members.map((m) => {
          const isSelf = currentUser && (m.name === currentUser.username || m.user_id === currentUser.id);

          return (
            <div key={m.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-cream-50/50 transition">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center font-bold text-sm">
                  {m.name[0].toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-900">
                      @{m.name} {isSelf && <span className="text-[11px] font-normal text-slate-400">(you)</span>}
                    </span>
                    {m.is_admin && (
                      <span className="inline-flex items-center gap-1 text-[10px] bg-amber-50 text-amber-700 font-bold px-2 py-0.5 rounded-full border border-amber-200">
                        <Shield className="w-2.5 h-2.5" /> Admin
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-slate-400 font-medium block">
                    {m.email || 'No email provided'}
                  </span>
                </div>
              </div>

              {/* UPI Handle Section */}
              <div className="sm:text-right">
                {isSelf && isEditingUpi ? (
                  <div className="space-y-1.5 inline-block text-left sm:text-right">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        placeholder="yourname@okaxis"
                        value={upiInput}
                        onChange={(e) => setUpiInput(e.target.value)}
                        disabled={upiSaving}
                        className="min-h-[44px] w-44 px-3 text-xs"
                      />
                      <button
                        type="button"
                        onClick={handleSaveUpi}
                        disabled={upiSaving}
                        className="min-h-[44px] rounded-xl bg-brand-600 px-3 text-xs font-bold text-white transition hover:bg-brand-700 disabled:opacity-50"
                        title="Save UPI"
                      >
                        {upiSaving ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsEditingUpi(false);
                          setUpiError('');
                        }}
                        disabled={upiSaving}
                        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:text-slate-600"
                        title="Cancel"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {upiError && (
                      <div className="text-[11px] text-red-600 font-medium flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 flex-shrink-0" />
                        <span>{upiError}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center sm:justify-end gap-2">
                    {m.upi_id ? (
                      <div className="inline-flex items-center gap-1.5 bg-cream-50 border border-slate-200 px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-700">
                        <span className="text-[10px] uppercase font-bold text-slate-400">UPI:</span>
                        <span className="text-brand-800">{m.upi_id}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 italic">No UPI handle set</span>
                    )}

                    {/* Inline edit control on own row */}
                    {isSelf && (
                      <button
                        type="button"
                        onClick={() => handleStartEditUpi(m.upi_id)}
                        className="p-1.5 text-slate-400 hover:text-brand-700 hover:bg-brand-50 rounded-lg transition border border-transparent hover:border-brand-200"
                        title={m.upi_id ? 'Edit your UPI ID' : 'Add your UPI ID'}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Invite Member Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="panel-card max-w-md w-full p-5 sm:p-6 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Add members</h3>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-white border border-slate-200 text-slate-500 hover:text-slate-800"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <InvitePanel
              currentUsername={currentUser?.username}
              excludeUsernames={group.members.map((m) => m.name)}
              onAddUsername={addByUsername}
              onAddEmail={addByEmail}
              onRequestLink={requestLink}
            />

            <button
              type="button"
              onClick={() => setShowInviteModal(false)}
              className="primary-btn w-full bg-ink-900 hover:bg-ink-700"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
