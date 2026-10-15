import React, { useState, useEffect, useRef } from 'react';
import { api } from './api/client';
import AuthScreen from './components/AuthScreen';
import ChooseUsernameScreen from './components/ChooseUsernameScreen';
import DashboardScreen from './components/DashboardScreen';
import GroupDetailScreen from './components/GroupDetailScreen';
import { LogOut, Wallet, CheckCircle2, AlertCircle } from 'lucide-react';

const JOIN_KEY_HASH = '#join=';
const JOIN_STORAGE_KEY = 'debt_settle_pending_join';

export default function App() {
  const [user, setUser] = useState(api.currentUser);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  // { type: 'success' | 'error', text } shown under the header
  const [notice, setNotice] = useState(null);
  const joinInFlight = useRef(false);

  // 1) Capture an invite token from the URL right away and keep it in
  //    sessionStorage, so it survives sign-in and the "choose your username"
  //    step. The hash is removed from the address bar immediately.
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith(JOIN_KEY_HASH)) {
      const token = decodeURIComponent(hash.slice(JOIN_KEY_HASH.length)).trim();
      if (token) sessionStorage.setItem(JOIN_STORAGE_KEY, token);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  // 2) Once the person is signed in AND has confirmed a username, use the token.
  useEffect(() => {
    if (!user || user.username_confirmed === false) return;
    const token = sessionStorage.getItem(JOIN_STORAGE_KEY);
    if (!token || joinInFlight.current) return;

    joinInFlight.current = true;
    (async () => {
      try {
        const res = await api.joinGroup(token);
        setNotice({
          type: 'success',
          text: res.status === 'already_member'
            ? "You're already in this group."
            : 'You joined the group from your invite link!',
        });
        if (res.group_id) setSelectedGroupId(res.group_id);
      } catch (err) {
        setNotice({ type: 'error', text: `Couldn't join the group: ${err.message}` });
      } finally {
        // Always clear it, so a bad or used link isn't retried on every render.
        sessionStorage.removeItem(JOIN_STORAGE_KEY);
        joinInFlight.current = false;
      }
    })();
  }, [user]);

  // Session validation
  useEffect(() => {
    if (api.currentUser) {
      api.getMe()
        .then((userData) => setUser(userData))
        .catch(() => {
          api.clearSession();
          setUser(null);
        });
    }
  }, []);

  const handleLogout = () => {
    sessionStorage.removeItem(JOIN_STORAGE_KEY);
    api.clearSession();
    setUser(null);
    setSelectedGroupId(null);
  };

  if (!user) {
    return <AuthScreen onLoginSuccess={(u) => setUser(u)} />;
  }

  if (user.username_confirmed === false) {
    return (
      <ChooseUsernameScreen
        user={user}
        onUsernameConfirmed={(updatedUser) => setUser(updatedUser)}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div
            onClick={() => setSelectedGroupId(null)}
            className="flex items-center gap-2.5 cursor-pointer group"
          >
            <div className="w-9 h-9 rounded-xl bg-olive-primary text-white flex items-center justify-center shadow-md shadow-olive-primary/20 group-hover:scale-105 transition">
              <Wallet className="w-5 h-5" />
            </div>
            <span className="font-black text-lg text-slate-900 tracking-tight">Debt-Settle</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <span className="text-xs font-bold text-slate-800 block">@{user.username}</span>
              <span className="text-[11px] text-slate-400 font-medium block">{user.email || 'Dev Mode'}</span>
            </div>
            <div className="w-8 h-8 rounded-full bg-olive-100 text-olive-800 flex items-center justify-center font-bold text-xs uppercase">
              {user.username ? user.username[0] : 'U'}
            </div>
            <button
              onClick={handleLogout}
              className="p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 border border-slate-200 transition"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Join Link Notice Banner */}
      {notice && (
        <div className="max-w-5xl mx-auto w-full px-4 pt-4">
          <div
            className={`p-3 text-xs font-bold rounded-xl flex items-center justify-between border ${
              notice.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}
          >
            <span className="flex items-center gap-2">
              {notice.type === 'error'
                ? <AlertCircle className="w-4 h-4 text-red-600" />
                : <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
              {notice.text}
            </span>
            <button
              onClick={() => setNotice(null)}
              className={notice.type === 'error' ? 'text-red-600 hover:text-red-800' : 'text-emerald-600 hover:text-emerald-800'}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">
        {selectedGroupId ? (
          <GroupDetailScreen
            groupId={selectedGroupId}
            currentUser={user}
            onBack={() => setSelectedGroupId(null)}
          />
        ) : (
          <DashboardScreen
            user={user}
            onSelectGroup={(id) => setSelectedGroupId(id)}
          />
        )}
      </main>
    </div>
  );
}
