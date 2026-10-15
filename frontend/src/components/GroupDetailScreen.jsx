import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import BalancesTab from './BalancesTab';
import ExpensesTab from './ExpensesTab';
import MembersTab from './MembersTab';
import ChatTab from './ChatTab';
import SettleModal from './SettleModal';
import { 
  ArrowLeft, Users, Receipt, Scale, MessageSquare, Zap, 
  Shield, CheckCircle2, Lock, RefreshCw, AlertCircle 
} from 'lucide-react';

export default function GroupDetailScreen({ groupId, currentUser, onBack }) {
  const [group, setGroup] = useState(null);
  const [activeTab, setActiveTab] = useState('balances'); // balances | expenses | members | chat
  const [showSettleModal, setShowSettleModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchGroup = async () => {
    try {
      setLoading(true);
      setError('');
      // The server says whether YOU are the admin (data.is_admin); don't guess from names.
      const data = await api.getGroup(groupId);
      setGroup(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGroup();
  }, [groupId]);

  if (loading && !group) {
    return (
      <div className="py-24 text-center text-slate-400">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-olive-600" />
        <p className="text-sm font-semibold">Loading group details...</p>
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="p-8 text-center bg-white rounded-2xl border border-red-200 text-red-700 space-y-3">
        <AlertCircle className="w-8 h-8 mx-auto" />
        <p className="text-sm font-bold">{error || 'Failed to load group'}</p>
        <button
          onClick={onBack}
          className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  // ONE Settle Up button for the whole screen.
  //  - before settling: enabled only when there is something to settle
  //  - once settling has started (or finished): becomes "View payments"
  const hasStarted = !!group.is_frozen || !!group.fully_settled_at;
  const canSettle = group.members.length >= 2 && (group.expenses_count ?? 0) >= 1;
  const settleDisabled = !hasStarted && !canSettle;
  const settleHint = settleDisabled
    ? 'Add at least 2 members and 1 expense before settling up.'
    : '';

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition border border-slate-200"
            title="Back to Dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-slate-900 tracking-tight">{group.name}</h1>
              {group.is_admin && (
                <span className="inline-flex items-center gap-1 text-[10px] bg-amber-50 text-amber-700 font-bold px-2 py-0.5 rounded-full border border-amber-200">
                  <Shield className="w-2.5 h-2.5" /> Admin
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 font-medium">
              {group.members.length} {group.members.length === 1 ? 'member' : 'members'}
            </p>
          </div>
        </div>

        {/* Status Pill & Settle Quick Trigger */}
        <div className="flex items-center gap-2.5">
          {group.fully_settled_at ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl">
              <CheckCircle2 className="w-4 h-4" /> Fully Settled
            </span>
          ) : group.is_frozen ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-3 py-1.5 rounded-xl">
              <Lock className="w-4 h-4" /> Settling (Frozen)
            </span>
          ) : null}

          <button
            onClick={() => setShowSettleModal(true)}
            disabled={settleDisabled}
            title={settleHint || undefined}
            className={`px-4 py-2 font-bold text-xs rounded-xl flex items-center gap-1.5 transition ${
              settleDisabled
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                : 'bg-olive-primary hover:bg-olive-700 text-white shadow-sm active:scale-[0.98]'
            }`}
          >
            <Zap className="w-3.5 h-3.5 fill-current" />
            <span>{hasStarted ? 'View payments' : 'Settle Up'}</span>
          </button>
        </div>
      </div>

      {settleHint && (
        <p className="text-xs text-slate-500 font-medium px-1 -mt-3">{settleHint}</p>
      )}

      {/* Tabs Bar */}
      <div className="grid grid-cols-4 gap-1 p-1.5 bg-slate-200/70 rounded-2xl text-xs font-bold">
        {[
          { id: 'balances', label: 'Balances', icon: Scale },
          { id: 'expenses', label: 'Expenses', icon: Receipt },
          { id: 'members', label: 'Members', icon: Users },
          { id: 'chat', label: 'Chat', icon: MessageSquare },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-xl transition ${
              activeTab === id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Icon className="w-4 h-4" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* Active Tab Component */}
      <div>
        {activeTab === 'balances' && (
          <BalancesTab group={group} />
        )}
        {activeTab === 'expenses' && (
          <ExpensesTab
            group={group}
            onExpenseLogged={fetchGroup}
          />
        )}
        {activeTab === 'members' && (
          <MembersTab
            group={group}
            currentUser={currentUser}
            onMemberUpdated={fetchGroup}
          />
        )}
        {activeTab === 'chat' && (
          <ChatTab
            group={group}
            currentUser={currentUser}
          />
        )}
      </div>

      {/* Settle Up Modal */}
      {showSettleModal && (
        <SettleModal
          group={group}
          currentUser={currentUser}
          onClose={() => setShowSettleModal(false)}
          onSettlementUpdated={fetchGroup}
        />
      )}
    </div>
  );
}
