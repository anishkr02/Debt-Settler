import React, { useState } from 'react';
import { api } from '../api/client';
import { ShieldCheck, ArrowRight, ExternalLink, LogOut, AlertCircle } from 'lucide-react';

export default function ConsentScreen({ onConsentGiven, onLogout, onViewPrivacy }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleAgree = async () => {
    setLoading(true);
    setError('');
    try {
      await api.recordConsent('1.0');
      const updatedUser = await api.getMe();
      api.setSession(updatedUser, api.token, api.devUsername);
      onConsentGiven(updatedUser);
    } catch (err) {
      setError(err.message || 'Failed to record consent. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-cream-100 flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-slate-100 p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-olive-100 text-olive-800 shadow-sm mb-2">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Privacy Consent</h1>
          <p className="text-xs text-slate-500 font-medium">
            Please review and accept our privacy practices to continue to Debt-Settle.
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 text-xs space-y-3 text-slate-600">
          <p className="font-semibold text-slate-800">In summary:</p>
          <ul className="list-disc pl-4 space-y-1.5 text-slate-600">
            <li>We store your email, username, group expenses, debts, and chat messages.</li>
            <li>Your UPI ID is visible only to members of groups you join, strictly for payment settlements.</li>
            <li>Settled groups are permanently deleted 7 days after all balances are settled.</li>
            <li>You can delete your account at any time once unsettled debts are cleared.</li>
          </ul>

          <div className="pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onViewPrivacy}
              className="text-olive-700 hover:text-olive-800 font-bold inline-flex items-center gap-1 hover:underline"
            >
              <span>Read the full Privacy Policy</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="space-y-3 pt-2">
          <button
            type="button"
            onClick={handleAgree}
            disabled={loading}
            className="w-full py-3 bg-olive-primary hover:bg-olive-700 text-white font-bold text-sm rounded-xl shadow-lg shadow-olive-primary/20 transition flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.99]"
          >
            <span>{loading ? 'Recording Consent...' : 'I Agree & Continue'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onLogout}
            className="w-full py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 font-semibold text-xs rounded-xl transition flex items-center justify-center gap-2"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
