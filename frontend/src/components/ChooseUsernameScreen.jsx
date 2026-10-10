import React, { useState } from 'react';
import { api } from '../api/client';
import { AtSign, AlertCircle, RefreshCw, LogOut, Check } from 'lucide-react';

export default function ChooseUsernameScreen({ user, onUsernameConfirmed, onLogout }) {
  const [username, setUsername] = useState(user.username || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const validateLocal = (val) => {
    const norm = val.trim().toLowerCase();
    if (norm.length < 3 || norm.length > 20) {
      return 'Username must be between 3 and 20 characters.';
    }
    if (!/^[a-z0-9_]+$/.test(norm)) {
      return 'Username can only contain lowercase letters, numbers, and underscores (a-z, 0-9, _).';
    }
    return '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const norm = username.trim().toLowerCase();
    const localErr = validateLocal(norm);
    if (localErr) {
      setError(localErr);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const updatedUser = await api.updateUsername(norm);
      api.setSession(updatedUser, api.token, updatedUser.username);
      onUsernameConfirmed(updatedUser);
    } catch (err) {
      setError(err.message || 'Failed to update username');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-cream-100 flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-md w-full text-center mb-6">
        <p className="text-xs font-bold text-olive-primary uppercase tracking-widest mb-1.5">
          DEBT-SETTLE
        </p>
        <h1 className="text-3xl font-black text-slate-900 leading-tight">
          Choose your username
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          This is your unique handle so friends can find and add you to expense groups.
        </p>
      </div>

      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-slate-200/80 p-8 space-y-6">
        {error && (
          <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-2xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
              Username Handle
            </label>
            <div className="relative">
              <input
                type="text"
                autoFocus
                required
                className="w-full pl-10 pr-4 py-3.5 border border-slate-300 rounded-2xl text-sm font-semibold text-slate-900 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-olive-primary placeholder:text-slate-400"
                placeholder="e.g. rahul_k"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''));
                  setError('');
                }}
              />
              <AtSign className="w-4 h-4 text-slate-400 absolute left-3.5 top-4" />
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              3–20 characters, lowercase letters, numbers, and underscores only.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || !username.trim()}
            className="w-full py-4 rounded-2xl bg-olive-primary hover:bg-olive-700 text-white font-bold text-base transition shadow-md active:scale-[0.99] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Confirming…</span>
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>Confirm username</span>
              </>
            )}
          </button>
        </form>

        <div className="pt-2 border-t border-slate-100 flex justify-center">
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-slate-600 transition"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign in with a different account</span>
          </button>
        </div>
      </div>
    </div>
  );
}
