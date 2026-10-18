import React, { useState, useEffect, useCallback } from 'react';
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
  const [loadedGroupId, setLoadedGroupId] = useState(null);
  const [activeTab, setActiveTab] = useState('balances'); // balances | expenses | members | chat
  const [showSettleModal, setShowSettleModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchGroup = useCallback(async () => {
    try {
      // The server says whether YOU are the admin (data.is_admin); don't guess from names.
      const data = await api.getGroup(groupId);
      setGroup(data);
      setLoadedGroupId(groupId);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    let active = true;
    const loadGroup = async () => {
      try {
        const data = await api.getGroup(groupId);
        if (active) {
          setGroup(data);
          setLoadedGroupId(groupId);
          setError('');
        }
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    };
    loadGroup();
    return () => {
      active = false;
    };
  }, [groupId]);

  if ((loading && !group) || (loadedGroupId !== groupId && !error)) {
    return (
      <div className="py-24 text-center text-slate-400">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-brand-600" />
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
    <div className="space-y-5 sm:space-y-6">
      {/* Header Bar */}
      <section className="hero-card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-white/20 text-slate-300 transition hover:bg-white/10 hover:text-white"
            title="Back to Dashboard"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div>
            <p className="eyebrow mb-1 text-brand-300">DEBT-SETTLE</p>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black tracking-tight text-white sm:text-2xl">{group.name}</h1>
              {group.is_admin && (
                <span className="inline-flex items-center gap-1 text-[10px] bg-amber-50 text-amber-700 font-bold px-2 py-0.5 rounded-full border border-amber-200">
                  <Shield className="w-2.5 h-2.5" /> Admin
                </span>
              )}
            </div>
            <p className="text-xs font-medium text-slate-300">
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
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-800 bg-brand-50 border border-brand-200 px-3 py-1.5 rounded-xl">
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
                :                 'bg-brand-600 hover:bg-brand-500 text-white shadow-sm active:scale-[0.98]'
            }`}
          >
            <Zap className="w-3.5 h-3.5 fill-current" />
            <span>{hasStarted ? 'View payments' : 'Settle Up'}</span>
          </button>
        </div>
      </section>

      {settleHint && (
        <p className="text-xs text-slate-500 font-medium px-1 -mt-3">{settleHint}</p>
      )}

      {/* Tabs Bar */}
      <div className="grid grid-cols-4 gap-1 rounded-2xl border border-slate-200/80 bg-cream-200 p-1.5 text-xs font-bold">
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
                ? 'bg-white text-ink-900 shadow-sm'
                : 'text-slate-600 hover:bg-white/60 hover:text-ink-900'
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
