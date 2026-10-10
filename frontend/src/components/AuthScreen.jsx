import React, { useState } from 'react';
import { api } from '../api/client';
import { auth, googleProvider, signInWithPopup } from '../api/firebase';
import { Wallet, ShieldCheck, UserCheck, ArrowRight, Sparkles } from 'lucide-react';

export default function AuthScreen({ onLoginSuccess }) {
  const [isSignup, setIsSignup] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [devUser, setDevUser] = useState('aarav');
  const [customDevName, setCustomDevName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Handle standard signup
  const handleSignup = async (e) => {
    e.preventDefault();
    if (!username.trim() || !email.trim()) {
      setError('Please provide both username and email');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const user = await api.signup(username.trim(), email.trim());
      api.setSession(user, null, user.username);
      onLoginSuccess(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Handle Dev Mode Sign-In
  const handleDevLogin = async (nameToUse) => {
    setLoading(true);
    setError('');
    const name = (nameToUse || devUser).trim().toLowerCase();
    try {
      api.setSession({ username: name }, null, name);
      // Fetch or auto-create me
      const me = await api.getMe();
      api.setSession(me, null, me.username);
      onLoginSuccess(me);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Handle Google Sign-In (Firebase popup)
  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      if (auth && googleProvider) {
        const result = await signInWithPopup(auth, googleProvider);
        const idToken = await result.user.getIdToken();
        api.setSession(
          {
            email: result.user.email,
            username: result.user.displayName || result.user.email?.split('@')[0],
          },
          idToken
        );
        const me = await api.getMe();
        api.setSession(me, idToken);
        onLoginSuccess(me);
      } else {
        // Fallback to dev login if firebase config is missing
        handleDevLogin(devUser);
      }
    } catch (err) {
      if (err.code === 'auth/popup-closed-by-user') {
        return;
      }
      setError(err.message || 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-cream-100 flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8">
      {/* Brand Header */}
      <div className="max-w-md w-full text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-olive-primary text-white shadow-lg shadow-olive-primary/20 mb-4">
          <Wallet className="w-8 h-8" />
        </div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Debt-Settle</h1>
        <p className="mt-2 text-sm text-slate-600 font-medium">
          Group expense splitting with minimum-transaction settlement & UPI links.
        </p>
      </div>

      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-slate-100 p-8 space-y-6">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">
            {error}
          </div>
        )}

        {/* Google Sign-In Button */}
        <div>
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-slate-200 rounded-xl shadow-sm bg-white hover:bg-slate-50 text-slate-700 font-medium transition active:scale-[0.99] disabled:opacity-50"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            Continue with Google
          </button>
        </div>

        {/* Divider */}
        <div className="relative flex py-1 items-center">
          <div className="flex-grow border-t border-slate-200"></div>
          <span className="flex-shrink mx-4 text-xs font-semibold uppercase text-slate-400">or dev quick-login</span>
          <div className="flex-grow border-t border-slate-200"></div>
        </div>

        {/* Dev Mode Login Selector */}
        <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-olive-600" /> Dev User Switcher
            </span>
            <span className="text-[11px] bg-olive-100 text-olive-800 font-semibold px-2 py-0.5 rounded-full">
              DEV_MODE
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {['aarav', 'anish', 'rahul', 'priya'].map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => handleDevLogin(name)}
                disabled={loading}
                className="flex items-center gap-2 p-2.5 bg-white border border-slate-200 hover:border-olive-500 hover:bg-olive-50/50 rounded-lg text-xs font-semibold text-slate-700 capitalize transition"
              >
                <div className="w-6 h-6 rounded-full bg-olive-primary text-white flex items-center justify-center font-bold text-[10px]">
                  {name[0].toUpperCase()}
                </div>
                <span>@{name}</span>
              </button>
            ))}
          </div>

          <div className="pt-2 border-t border-slate-200 flex gap-2">
            <input
              type="text"
              placeholder="Custom username..."
              value={customDevName}
              onChange={(e) => setCustomDevName(e.target.value)}
              className="flex-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-olive-primary"
            />
            <button
              type="button"
              onClick={() => customDevName.trim() && handleDevLogin(customDevName)}
              disabled={loading || !customDevName.trim()}
              className="px-3 py-1.5 bg-olive-primary text-white text-xs font-semibold rounded-lg hover:bg-olive-700 disabled:opacity-50"
            >
              Login
            </button>
          </div>
        </div>

        {/* Direct Account Registration */}
        <div className="pt-2">
          {!isSignup ? (
            <p className="text-center text-xs text-slate-500">
              Need to register a custom username?{' '}
              <button
                type="button"
                onClick={() => setIsSignup(true)}
                className="text-olive-700 font-bold hover:underline"
              >
                Create Account
              </button>
            </p>
          ) : (
            <form onSubmit={handleSignup} className="space-y-3 pt-2">
              <h3 className="text-sm font-bold text-slate-800">Register Profile</h3>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Username</label>
                <input
                  type="text"
                  placeholder="e.g. karan_k"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-olive-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                <input
                  type="email"
                  placeholder="e.g. karan@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-olive-primary"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2 bg-olive-primary hover:bg-olive-700 text-white rounded-lg text-xs font-bold transition disabled:opacity-50"
                >
                  Save Profile
                </button>
                <button
                  type="button"
                  onClick={() => setIsSignup(false)}
                  className="px-3 py-2 border border-slate-200 text-slate-600 rounded-lg text-xs font-semibold"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
