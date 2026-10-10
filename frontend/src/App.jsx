import React, { useState, useEffect } from 'react';
import { api } from './api/client';
import AuthScreen from './components/AuthScreen';
import ChooseUsernameScreen from './components/ChooseUsernameScreen';
import DashboardScreen from './components/DashboardScreen';
import GroupDetailScreen from './components/GroupDetailScreen';
import { LogOut, Wallet, CheckCircle2, AlertCircle } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState(api.currentUser);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [joinNotification, setJoinNotification] = useState('');

  // Check URL hash for join token on mount or login
  useEffect(() => {
    const handleHashCheck = async () => {
      const hash = window.location.hash;
      if (hash.startsWith('#join=') && user && user.username_confirmed !== false) {
        const token = hash.replace('#join=', '');
        try {
          const res = await api.joinGroup(token);
          setJoinNotification('Successfully joined the group from your invite link!');
          window.location.hash = '';
          if (res.group_id) {
            setSelectedGroupId(res.group_id);
          }
        } catch (err) {
          setJoinNotification(`Failed to join: ${err.message}`);
        }
      }
    };

    handleHashCheck();
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
      {joinNotification && (
        <div className="max-w-5xl mx-auto w-full px-4 pt-4">
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl flex items-center justify-between">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              {joinNotification}
            </span>
            <button onClick={() => setJoinNotification('')} className="text-emerald-600 hover:text-emerald-800">
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
