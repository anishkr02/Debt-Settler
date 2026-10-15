import React, { useState } from 'react';
import { api } from '../api/client';
import { UserPlus, Shield, Check, X } from 'lucide-react';
import InvitePanel from './InvitePanel';
import { buildJoinUrl } from '../lib/joinLink';

export default function MembersTab({ group, currentUser, onMemberUpdated }) {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

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

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Group Members</h2>
          <p className="text-xs text-slate-500 font-medium">Manage members, UPI payment handles, and group invites.</p>
        </div>

        <button
          onClick={() => {
            setShowInviteModal(true);
            setSuccessMsg('');
          }}
          className="flex items-center gap-1.5 px-4 py-2 bg-olive-primary hover:bg-olive-700 text-white font-bold text-xs rounded-xl shadow-sm transition active:scale-[0.99]"
        >
          <UserPlus className="w-4 h-4" />
          <span>Invite Member</span>
        </button>
      </div>

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-xl flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Members Roster */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm divide-y divide-slate-100 overflow-hidden">
        {group.members.map((m) => (
          <div key={m.id} className="p-4 flex items-center justify-between hover:bg-slate-50/50 transition">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-olive-100 text-olive-primary flex items-center justify-center font-bold text-sm">
                {m.name[0].toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-slate-900">@{m.name}</span>
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

            <div className="text-right">
              {m.upi_id ? (
                <div className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-700">
                  <span className="text-[10px] uppercase font-bold text-slate-400">UPI:</span>
                  <span className="text-olive-800">{m.upi_id}</span>
                </div>
              ) : (
                <span className="text-xs text-slate-400 italic">No UPI handle set</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Invite Member Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-cream-100 rounded-2xl shadow-2xl border border-slate-100 max-w-md w-full p-6 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Add members</h3>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-white border border-slate-200 text-slate-500 hover:text-slate-800"
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
              className="w-full py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold transition"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
