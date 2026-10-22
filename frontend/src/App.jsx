import React, { useState, useEffect, useRef } from 'react';
import { api } from './api/client';
import AuthScreen from './components/AuthScreen';
import ConsentScreen from './components/ConsentScreen';
import ChooseUsernameScreen from './components/ChooseUsernameScreen';
import DashboardScreen from './components/DashboardScreen';
import GroupDetailScreen from './components/GroupDetailScreen';
import PrivacyScreen from './components/PrivacyScreen';
import DeleteAccountModal from './components/DeleteAccountModal';
import { 
  LogOut, Wallet, CheckCircle2, AlertCircle, Shield, 
  MessageSquare, Trash2, ChevronDown 
} from 'lucide-react';

const JOIN_KEY_HASH = '#join=';
const JOIN_STORAGE_KEY = 'debt_settle_pending_join';

export default function App() {
  const [user, setUser] = useState(api.currentUser);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  // { type: 'success' | 'error', text } shown under the header
  const [notice, setNotice] = useState(null);
  const [showPrivacy, setShowPrivacy] = useState(
    window.location.pathname === '/privacy' || window.location.hash === '#privacy'
  );
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const joinInFlight = useRef(false);
  const profileMenuRef = useRef(null);

  const feedbackUrl = import.meta.env.VITE_FEEDBACK_URL;

  // Listen to popstate / hash for /privacy
  useEffect(() => {
    const handleUrlChange = () => {
      if (window.location.pathname === '/privacy' || window.location.hash === '#privacy') {
        setShowPrivacy(true);
      }
    };
    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);
    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('hashchange', handleUrlChange);
    };
  }, []);

  // Close profile menu on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
    if (!user || !user.consented_at || user.username_confirmed === false) return;
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
    let active = true;
    let retryTimeout;

    if (api.currentUser) {
      const validateSession = async (retryCount = 0) => {
        try {
          const userData = await api.getMe();
          if (active) setUser(userData);
        } catch (err) {
          if (!active) return;
          if (err.status === 401) {
            api.clearSession();
            setUser(null);
          } else if (retryCount < 3) {
            retryTimeout = setTimeout(() => validateSession(retryCount + 1), 5000);
          } else {
            console.warn('Session validation failed; keeping the current session:', err);
          }
        }
      };
      validateSession();
    }

    return () => {
      active = false;
      clearTimeout(retryTimeout);
    };
  }, []);

  const handleLogout = () => {
    sessionStorage.removeItem(JOIN_STORAGE_KEY);
    api.clearSession();
    setUser(null);
    setSelectedGroupId(null);
    setProfileMenuOpen(false);
    setShowDeleteModal(false);
  };

  const handleOpenPrivacy = () => {
    setProfileMenuOpen(false);
    setShowPrivacy(true);
  };

  const handleClosePrivacy = () => {
    setShowPrivacy(false);
    if (window.location.pathname === '/privacy') {
      window.history.pushState(null, '', '/');
    }
    if (window.location.hash === '#privacy') {
      window.location.hash = '';
    }
  };

  // If viewing privacy page
  if (showPrivacy) {
    return <PrivacyScreen onBack={handleClosePrivacy} />;
  }

  // Auth screen
  if (!user) {
    return (
      <AuthScreen
        onLoginSuccess={(u) => setUser(u)}
        onViewPrivacy={handleOpenPrivacy}
      />
    );
  }

  // Consent screen: if user has no consent recorded yet
  if (!user.consented_at) {
    return (
      <ConsentScreen
        onConsentGiven={(updatedUser) => setUser(updatedUser)}
        onLogout={handleLogout}
        onViewPrivacy={handleOpenPrivacy}
      />
    );
  }

  // Choose username screen: if username not confirmed yet
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
    <div className="min-h-screen bg-cream-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="bg-cream-100/95 border-b border-slate-200/80 sticky top-0 z-30 shadow-xs backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div
            onClick={() => setSelectedGroupId(null)}
            className="flex items-center gap-2.5 cursor-pointer group"
          >
            <div className="w-9 h-9 rounded-xl bg-brand-600 text-white flex items-center justify-center shadow-md shadow-brand-600/20 group-hover:scale-105 transition">
              <Wallet className="w-5 h-5" />
            </div>
            <span className="font-black text-lg text-slate-900 tracking-tight">Debt-Settle</span>
          </div>

          <div className="flex items-center gap-3">
            {/* Profile Dropdown Trigger */}
            <div className="relative" ref={profileMenuRef}>
              <button
                type="button"
                onClick={() => setProfileMenuOpen((prev) => !prev)}
                className="flex min-h-[44px] items-center gap-2.5 p-1.5 sm:px-3 sm:py-1.5 rounded-2xl hover:bg-cream-200 border border-slate-200/80 transition"
                title="Profile Menu"
              >
                <div className="w-8 h-8 rounded-xl bg-brand-100 text-brand-800 flex items-center justify-center font-bold text-xs uppercase flex-shrink-0">
                  {user.username ? user.username[0] : 'U'}
                </div>
                <div className="text-left hidden sm:block">
                  <span className="text-xs font-bold text-slate-800 block leading-tight">@{user.username}</span>
                  <span className="text-[10px] text-slate-400 font-medium block leading-tight truncate max-w-[120px]">
                    {user.email || 'Dev Mode'}
                  </span>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 hidden sm:block" />
              </button>

              {/* Profile Dropdown Menu */}
              {profileMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-card border border-slate-200/80 py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
                  <div className="px-4 py-2 border-b border-slate-100">
                    <span className="text-xs font-bold text-slate-800 block">@{user.username}</span>
                    <span className="text-[11px] text-slate-400 font-medium block truncate">
                      {user.email || 'Dev Mode'}
                    </span>
                  </div>

                  <div className="py-1">
                    <button
                      type="button"
                      onClick={handleOpenPrivacy}
                      className="flex min-h-[44px] w-full items-center gap-2.5 px-4 py-2 text-left text-xs font-semibold text-slate-700 transition hover:bg-cream-50"
                    >
                      <Shield className="w-4 h-4 text-slate-400" />
                      <span>Privacy Policy</span>
                    </button>

                    {feedbackUrl && (
                      <a
                        href={feedbackUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-h-[44px] w-full items-center gap-2.5 px-4 py-2 text-left text-xs font-semibold text-slate-700 transition hover:bg-cream-50"
                        onClick={() => setProfileMenuOpen(false)}
                      >
                        <MessageSquare className="w-4 h-4 text-slate-400" />
                        <span>Send feedback</span>
                      </a>
                    )}
                  </div>

                  <div className="border-t border-slate-100 py-1">
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="flex min-h-[44px] w-full items-center gap-2.5 px-4 py-2 text-left text-xs font-semibold text-slate-700 transition hover:bg-cream-50"
                    >
                      <LogOut className="w-4 h-4 text-slate-400" />
                      <span>Sign Out</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        setShowDeleteModal(true);
                      }}
                      className="flex min-h-[44px] w-full items-center gap-2.5 px-4 py-2 text-left text-xs font-bold text-red-600 transition hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                      <span>Delete my account</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
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

      {/* Delete Account Confirmation Dialog */}
      {showDeleteModal && (
        <DeleteAccountModal
          onClose={() => setShowDeleteModal(false)}
          onDeleted={handleLogout}
        />
      )}
    </div>
  );
}
