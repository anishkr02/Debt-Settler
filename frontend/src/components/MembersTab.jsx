import React, { useState } from 'react';
import { api } from '../api/client';
import { 
  Users, UserPlus, Shield, Copy, Check, Search, Mail, 
  Link2, AtSign, AlertCircle, Sparkles 
} from 'lucide-react';

export default function MembersTab({ group, onMemberUpdated }) {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteMethod, setInviteMethod] = useState('username'); // username | join_link | email

  // Username search state
  const [usernameQuery, setUsernameQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // Email state
  const [inviteEmail, setInviteEmail] = useState('');

  // Join link state
  const [generatedLink, setGeneratedLink] = useState('');
  const [copied, setCopied] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Search users by username query
  const handleSearchUsers = async (q) => {
    setUsernameQuery(q);
    if (!q || q.length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      setSearching(true);
      const results = await api.searchUsers(q);
      setSearchResults(results);
    } catch (e) {
      // ignore
    } finally {
      setSearching(false);
    }
  };

  // Invite by username
  const handleInviteUsername = async (uName) => {
    try {
      setLoading(true);
      setError('');
      await api.inviteMember(group.id, { method: 'username', username: uName });
      setSuccessMsg(`@${uName} was added to the group!`);
      setShowInviteModal(false);
      setUsernameQuery('');
      setSearchResults([]);
      if (onMemberUpdated) onMemberUpdated();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Generate join link
  const handleGenerateLink = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await api.inviteMember(group.id, { method: 'join_link' });
      const fullUrl = `${window.location.origin}/#join=${data.join_token}`;
      setGeneratedLink(fullUrl);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Copy link
  const handleCopyLink = () => {
    navigator.clipboard.writeText(generatedLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Invite by email
  const handleInviteEmail = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    try {
      setLoading(true);
      setError('');
      await api.inviteMember(group.id, { method: 'email', email: inviteEmail.trim() });
      setSuccessMsg(`Invite sent to ${inviteEmail}. They will be automatically attached once they sign up!`);
      setShowInviteModal(false);
      setInviteEmail('');
      if (onMemberUpdated) onMemberUpdated();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
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
            setError('');
            setSuccessMsg('');
            setGeneratedLink('');
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
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Add Member to Group</h3>
              <button onClick={() => setShowInviteModal(false)} className="text-slate-400 hover:text-slate-600 font-bold p-1">✕</button>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Method Tabs */}
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl">
              {[
                { id: 'username', label: 'By Username', icon: AtSign },
                { id: 'join_link', label: 'Share Link', icon: Link2 },
                { id: 'email', label: 'By Email', icon: Mail },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setInviteMethod(id);
                    setError('');
                  }}
                  className={`flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold rounded-lg transition ${
                    inviteMethod === id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {/* 1. By Username */}
            {inviteMethod === 'username' && (
              <div className="space-y-3 pt-1">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Search Registered User
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Type username (e.g. karan_k)..."
                      value={usernameQuery}
                      onChange={(e) => handleSearchUsers(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-olive-primary"
                    />
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  </div>
                </div>

                {searching && (
                  <p className="text-xs text-slate-400 italic">Searching registered users...</p>
                )}

                {searchResults.length > 0 && (
                  <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-40 overflow-y-auto">
                  {searchResults.map((u) => (
                      <div
                        key={u.id}
                        className="p-2.5 flex items-center justify-between hover:bg-slate-50 transition text-xs"
                      >
                        <span className="font-bold text-slate-800">@{u.username}</span>
                        <button
                          type="button"
                          onClick={() => handleInviteUsername(u.username)}
                          disabled={loading}
                          className="px-3 py-1 bg-olive-primary hover:bg-olive-700 text-white font-bold rounded-lg transition"
                        >
                          Add
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 2. Share Join Link */}
            {inviteMethod === 'join_link' && (
              <div className="space-y-3 pt-1 text-center">
                <p className="text-xs text-slate-500">
                  Generate a shareable link that anyone signed into Debt-Settle can open to instantly join this group.
                </p>

                {!generatedLink ? (
                  <button
                    type="button"
                    onClick={handleGenerateLink}
                    disabled={loading}
                    className="w-full py-2.5 bg-olive-primary hover:bg-olive-700 text-white text-xs font-bold rounded-xl transition"
                  >
                    Generate Shareable Join Link
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl">
                      <input
                        type="text"
                        readOnly
                        value={generatedLink}
                        className="flex-1 bg-transparent text-xs text-slate-700 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleCopyLink}
                        className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg flex items-center gap-1 transition"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copied ? 'Copied!' : 'Copy'}</span>
                      </button>
                    </div>
                    <span className="text-[11px] text-emerald-700 font-semibold block">
                      ✓ Link active! Share it with your friends.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* 3. By Email */}
            {inviteMethod === 'email' && (
              <form onSubmit={handleInviteEmail} className="space-y-3 pt-1">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Friend's Email Address
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="friend@gmail.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-olive-primary"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Even if they haven't signed up yet, they will be automatically added to this group the moment they create their account with this email.
                  </p>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowInviteModal(false)}
                    className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading || !inviteEmail.trim()}
                    className="px-5 py-2 bg-olive-primary hover:bg-olive-700 text-white text-xs font-bold rounded-xl transition disabled:opacity-50"
                  >
                    {loading ? 'Sending...' : 'Send Invite'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
