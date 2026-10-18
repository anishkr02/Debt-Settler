import React from 'react';
import { ShieldCheck, ArrowLeft, Mail, Trash2, Clock, Eye, Database } from 'lucide-react';

export default function PrivacyScreen({ onBack }) {
  const contactEmail = import.meta.env.VITE_CONTACT_EMAIL;

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.hash = '';
      window.location.pathname = '/';
    }
  };

  return (
    <div className="screen-shell py-6 sm:py-10 font-sans">
      <div className="max-w-2xl mx-auto space-y-6 sm:space-y-8">
        {/* Navigation / Header */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleBack}
            className="secondary-btn"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Debt-Settle Privacy
          </span>
        </div>

        <div className="panel-card p-5 sm:p-8 space-y-6">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-5">
            <div className="w-11 h-11 rounded-2xl bg-brand-100 text-brand-800 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div>
                <p className="eyebrow mb-1">DEBT-SETTLE</p>
                <h1 className="text-xl sm:text-2xl font-black text-ink-900 tracking-tight">Privacy Policy</h1>
              </div>
              <p className="text-xs text-slate-500 font-medium">Clear, plain-language privacy information for Debt-Settle.</p>
            </div>
          </div>

          {/* Section 1: What is stored */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
              <Database className="w-4 h-4 text-brand-600" />
              <h2>What data is collected and stored</h2>
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
              Debt-Settle collects only the minimal data required to manage group expenses and calculate minimum-transaction settlements:
            </p>
            <ul className="list-disc pl-5 text-xs space-y-1.5 text-slate-600">
              <li><strong>Email address:</strong> Used for secure authentication and group invitation matching.</li>
              <li><strong>Username:</strong> Displayed to group members to identify payers, debtors, and chat participants.</li>
              <li><strong>UPI ID (VPA):</strong> Optional per group, provided by you so others can settle debts to you via one-tap UPI links.</li>
              <li><strong>Expenses and Debts:</strong> Amounts, descriptions, payers, and split breakdowns within groups you join.</li>
              <li><strong>Chat Messages:</strong> Messages sent within group chat boards.</li>
            </ul>
          </div>

          {/* Section 2: UPI ID visibility */}
          <div className="space-y-3 border-t border-slate-100 pt-5">
            <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
              <Eye className="w-4 h-4 text-brand-600" />
              <h2>UPI ID visibility and purpose</h2>
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
              Your UPI ID is <strong>strictly visible only to fellow members of the specific groups you belong to</strong>.
              It is shared solely so other members can generate direct UPI deep-links and scan QR codes to pay you back without any intermediary holding your funds. We never sell or share your UPI ID with third-party advertisers.
            </p>
          </div>

          {/* Section 3: Data retention */}
          <div className="space-y-3 border-t border-slate-100 pt-5">
            <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
              <Clock className="w-4 h-4 text-brand-600" />
              <h2>Automatic deletion of settled groups (7 days)</h2>
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
              Once a group is completely settled (all settlement transactions have been confirmed by their recipients), the group and all its associated data—including expenses, splits, personal debts, chat messages, and member roster records—are <strong>permanently deleted 7 days after settlement</strong> by our automated retention cleaner.
            </p>
          </div>

          {/* Section 4: Account deletion */}
          <div className="space-y-3 border-t border-slate-100 pt-5">
            <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
              <Trash2 className="w-4 h-4 text-red-600" />
              <h2>How to delete your account</h2>
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
              You can delete your account at any time through your Profile menu by clicking <strong>&quot;Delete my account&quot;</strong>.
            </p>
            <p className="text-xs leading-relaxed text-slate-600">
              To protect all group members, deletion requires that you have settled all non-zero balances in active groups and have no unconfirmed settlement payments in progress. Once confirmed, your personal identifiers (username, email, Firebase UID) are immediately anonymized, all pending invitations are purged, and your UPI handles are cleared.
            </p>
          </div>

          {/* Section 5: Contact */}
          <div className="space-y-3 border-t border-slate-100 pt-5">
            <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
              <Mail className="w-4 h-4 text-brand-600" />
              <h2>Contact us</h2>
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
              {contactEmail ? (
                <>
                  If you have any questions or privacy concerns regarding Debt-Settle, reach out to us at:{' '}
                  <a href={`mailto:${contactEmail}`} className="font-bold text-brand-700 hover:underline">
                    {contactEmail}
                  </a>
                </>
              ) : (
                'Contact information has not been configured yet.'
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
