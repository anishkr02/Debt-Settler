import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { TrendingUp, TrendingDown, CheckCircle2, RefreshCw, AlertCircle } from 'lucide-react';
import ExpenseSummary from './ExpenseSummary';

export default function BalancesTab({ group }) {
  const [balances, setBalances] = useState({});
  const [summaryData, setSummaryData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchBalances = useCallback(async () => {
    setSummaryData(null);
    const summaryRequests = Promise.allSettled([
      api.listExpenses(group.id),
      api.listDebts(group.id),
    ]);
    try {
      const data = await api.getBalances(group.id);
      setBalances(data);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }

    const [expenseResult, debtResult] = await summaryRequests;
    if (expenseResult.status === 'fulfilled' && debtResult.status === 'fulfilled') {
      setSummaryData({
        groupId: group.id,
        expenses: expenseResult.value,
        debts: debtResult.value,
      });
    }
  }, [group.id]);

  useEffect(() => {
    let active = true;
    const loadBalances = async () => {
      const summaryRequests = Promise.allSettled([
        api.listExpenses(group.id),
        api.listDebts(group.id),
      ]);
      try {
        const data = await api.getBalances(group.id);
        if (active) {
          setBalances(data);
          setError('');
        }
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }

      const [expenseResult, debtResult] = await summaryRequests;
      if (active && expenseResult.status === 'fulfilled' && debtResult.status === 'fulfilled') {
        setSummaryData({
          groupId: group.id,
          expenses: expenseResult.value,
          debts: debtResult.value,
        });
      }
    };
    loadBalances();
    return () => {
      active = false;
    };
  }, [group.id]);

  const refreshBalances = async () => {
    setLoading(true);
    setError('');
    await fetchBalances();
  };

  const balanceEntries = Object.entries(balances);
  // Real check, computed from the data on screen: every rupee someone is owed
  // must be owed by someone else, so the balances add up to zero.
  const balanceSum = balanceEntries.reduce((sum, [, amt]) => sum + amt, 0);
  const balancesAddUp = Math.abs(balanceSum) < 0.01;

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Net Balances List */}
      <div className="content-card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="eyebrow mb-1">DEBT-SETTLE</p>
            <h3 className="text-base font-bold text-ink-900">Member Net Positions</h3>
            <p className="text-xs text-slate-500">Live balance calculated fresh from group expenses and IOUs.</p>
          </div>
          <button
            onClick={refreshBalances}
            disabled={loading}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-cream-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-brand-600" />
            <span className="text-xs font-medium">Computing live balances...</span>
          </div>
        ) : balanceEntries.length === 0 ? (
          <div className="py-8 text-center text-slate-500 text-sm">
            No members yet. Invite people from the Members tab.
          </div>
        ) : (
          <div className="space-y-3">
            {(group.expenses_count ?? 0) === 0 && (
              <p className="text-xs text-slate-500 text-center pb-1">
                No expenses yet. Add one from the Expenses tab and balances appear here.
              </p>
            )}
            {balanceEntries.map(([name, amount]) => {
              const isOwed = amount > 0.001;
              const owes = amount < -0.001;
              const isZero = !isOwed && !owes;

              return (
                <div
                  key={name}
                  className="flex items-center justify-between p-3.5 rounded-xl border border-slate-100 hover:border-slate-200 bg-cream-50/50 transition"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs ${
                        isOwed
                          ? 'bg-brand-100 text-brand-800'
                          : owes
                          ? 'bg-red-100 text-red-800'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {name[0].toUpperCase()}
                    </div>
                    <div>
                      <span className="font-bold text-sm text-slate-800 block">@{name}</span>
                      <span className="text-[11px] text-slate-400 font-medium">
                        {isOwed ? 'Gets back' : owes ? 'Owes group' : 'Settled up'}
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <span
                      className={`text-base font-extrabold flex items-center justify-end gap-1 ${
                        isOwed
                          ? 'text-brand-700'
                          : owes
                          ? 'text-red-600'
                          : 'text-slate-500'
                      }`}
                    >
                      {isOwed && <TrendingUp className="w-4 h-4" />}
                      {owes && <TrendingDown className="w-4 h-4" />}
                      {isZero && <CheckCircle2 className="w-4 h-4" />}
                      {isOwed ? `+₹${amount.toFixed(2)}` : owes ? `-₹${Math.abs(amount).toFixed(2)}` : '₹0.00'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Balance check, calculated from the numbers above */}
        {!loading && balanceEntries.length > 0 && (
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Balance check</span>
            {balancesAddUp ? (
              <span className="inline-flex items-center gap-1 text-brand-700 font-bold bg-brand-50 px-2 py-0.5 rounded-full border border-brand-100">
                <CheckCircle2 className="w-3 h-3" /> Everything adds up to ₹0.00
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-red-700 font-bold bg-red-50 px-2 py-0.5 rounded-full border border-red-100">
                <AlertCircle className="w-3 h-3" /> Off by ₹{Math.abs(balanceSum).toFixed(2)}
              </span>
            )}
          </div>
        )}
      </div>
      {summaryData?.groupId === group.id && (
        <ExpenseSummary
          expenses={summaryData.expenses}
          debts={summaryData.debts}
          members={group.members}
        />
      )}
    </div>
  );
}
