import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { Plus, Receipt, AlertCircle, RefreshCw, Lock } from 'lucide-react';

export default function ExpensesTab({ group, onExpenseLogged }) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Modals
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showAddIOU, setShowAddIOU] = useState(false);
  
  // Expense Form State
  const [description, setDescription] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [splitType, setSplitType] = useState('equal'); // equal | exact | percentage | shares
  const [paidBy, setPaidBy] = useState(group.members[0]?.id || '');
  const [isMultiPayer, setIsMultiPayer] = useState(false);
  const [payersMap, setPayersMap] = useState({}); // member_id -> amount
  const [selectedSplits, setSelectedSplits] = useState(
    group.members.reduce((acc, m) => ({ ...acc, [m.id]: true }), {})
  );
  const [customSplitValues, setCustomSplitValues] = useState({}); // member_id -> val (exact, percentage, shares)

  // IOU Form State
  const [fromMember, setFromMember] = useState(group.members[0]?.id || '');
  const [toMember, setToMember] = useState(group.members[1]?.id || group.members[0]?.id || '');
  const [iouAmount, setIouAmount] = useState('');
  const [iouNote, setIouNote] = useState('');

  const [submitting, setSubmitting] = useState(false);

  const fetchExpenses = useCallback(async () => {
    try {
      const data = await api.listExpenses(group.id);
      setExpenses(data);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [group.id]);

  useEffect(() => {
    let active = true;
    const loadExpenses = async () => {
      try {
        const data = await api.listExpenses(group.id);
        if (active) {
          setExpenses(data);
          setError('');
        }
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    };
    loadExpenses();
    return () => {
      active = false;
    };
  }, [group.id]);

  // Member map for quick name lookups
  const memberMap = group.members.reduce((acc, m) => ({ ...acc, [m.id]: m.name }), {});

  const handleCreateExpense = async (e) => {
    e.preventDefault();
    const amountNum = parseFloat(totalAmount);
    if (!description.trim() || isNaN(amountNum) || amountNum <= 0) {
      setError('Please provide a valid description and positive amount');
      return;
    }

    try {
      setSubmitting(true);
      setError('');

      if (!isMultiPayer && splitType === 'equal') {
        const splitMembers = Object.keys(selectedSplits)
          .filter((id) => selectedSplits[id])
          .map((id) => parseInt(id, 10));

        if (splitMembers.length === 0) {
          setError('Please select at least one member to split among');
          setSubmitting(false);
          return;
        }

        await api.addEqualExpense(group.id, {
          description: description.trim(),
          total_amount: amountNum,
          paid_by: parseInt(paidBy, 10),
          split_among: splitMembers,
        });
      } else {
        // Multi-payer or unequal split
        let payers = [];
        if (isMultiPayer) {
          payers = Object.entries(payersMap)
            .filter(([, amt]) => parseFloat(amt) > 0)
            .map(([mid, amt]) => ({ member_id: parseInt(mid, 10), amount_paid: parseFloat(amt) }));
        } else {
          payers = [{ member_id: parseInt(paidBy, 10), amount_paid: amountNum }];
        }

        let splitAmong = [];
        if (splitType === 'equal') {
          splitAmong = Object.keys(selectedSplits)
            .filter((id) => selectedSplits[id])
            .map((id) => ({ member_id: parseInt(id, 10) }));
        } else if (splitType === 'exact') {
          splitAmong = Object.entries(customSplitValues)
            .filter(([, val]) => parseFloat(val) > 0)
            .map(([mid, val]) => ({ member_id: parseInt(mid, 10), amount: parseFloat(val) }));
        } else if (splitType === 'percentage') {
          splitAmong = Object.entries(customSplitValues)
            .filter(([, val]) => parseFloat(val) > 0)
            .map(([mid, val]) => ({ member_id: parseInt(mid, 10), percentage: parseFloat(val) }));
        } else if (splitType === 'shares') {
          splitAmong = Object.entries(customSplitValues)
            .filter(([, val]) => parseFloat(val) > 0)
            .map(([mid, val]) => ({ member_id: parseInt(mid, 10), shares: parseFloat(val) }));
        }

        await api.addGeneralExpense(group.id, {
          description: description.trim(),
          total_amount: amountNum,
          split_type: splitType,
          paid_by: payers,
          split_among: splitAmong,
        });
      }

      setShowAddExpense(false);
      setDescription('');
      setTotalAmount('');
      setSplitType('equal');
      setIsMultiPayer(false);
      await fetchExpenses();
      if (onExpenseLogged) onExpenseLogged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateIOU = async (e) => {
    e.preventDefault();
    const amountNum = parseFloat(iouAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError('Please provide a valid positive amount');
      return;
    }
    if (fromMember === toMember) {
      setError('Debtor and creditor cannot be the same member');
      return;
    }

    try {
      setSubmitting(true);
      setError('');
      await api.addDebt(group.id, {
        from_member_id: parseInt(fromMember, 10),
        to_member_id: parseInt(toMember, 10),
        amount: amountNum,
        note: iouNote.trim(),
      });
      setShowAddIOU(false);
      setIouAmount('');
      setIouNote('');
      await fetchExpenses();
      if (onExpenseLogged) onExpenseLogged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Action Bar */}
      <div className="content-card flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="eyebrow mb-1">DEBT-SETTLE</p>
          <h2 className="text-lg font-bold text-ink-900">Expenses & Debts</h2>
          <p className="text-xs text-slate-500 font-medium">Log shared purchases, dining, travel, or 1-on-1 IOUs.</p>
        </div>

        <div className="flex items-center gap-2">
          {group.is_frozen || group.fully_settled_at ? (
            <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 text-slate-500 text-xs font-bold rounded-xl border border-slate-200">
              <Lock className="w-3.5 h-3.5" />
              <span>Group Frozen (Settling)</span>
            </div>
          ) : (
            <>
              <button
                onClick={() => setShowAddIOU(true)}
                className="secondary-btn bg-brand-50 text-brand-800 hover:bg-brand-100"
              >
                + Add IOU
              </button>
              <button
                onClick={() => setShowAddExpense(true)}
                className="primary-btn"
              >
                <Plus className="w-4 h-4" />
                <span>Log Expense</span>
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Expenses Feed */}
      {loading ? (
        <div className="content-card py-12 text-center text-slate-400">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-brand-600" />
          <span className="text-xs font-medium">Loading expenses...</span>
        </div>
      ) : expenses.length === 0 ? (
        <div className="content-card py-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mx-auto">
            <Receipt className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-800">No expenses logged yet</h3>
          <p className="text-xs text-slate-400 max-w-xs mx-auto">
            Click "+ Log Expense" above to add the first shared expense to this group.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {expenses.map((e) => (
            <div
              key={e.id}
              className="content-card space-y-3 transition hover:border-slate-300"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-bold text-sm text-slate-900">{e.description}</h4>
                  <p className="text-[11px] text-slate-400">
                    {new Date(e.created_at).toLocaleDateString()} • Split:{' '}
                    <span className="capitalize font-semibold text-slate-600">{e.split_type}</span>
                  </p>
                </div>
                <span className="text-base font-black text-slate-900">₹{e.total_amount.toFixed(2)}</span>
              </div>

              {/* Payers and Splits breakdown */}
              <div className="pt-2.5 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                    Paid By:
                  </span>
                  <div className="space-y-1">
                    {e.payers.map((p, idx) => (
                      <span key={idx} className="block text-slate-700 font-medium">
                        @{memberMap[p.member_id] || `Member ${p.member_id}`}:{' '}
                        <strong className="text-slate-900 font-bold">₹{p.amount_paid.toFixed(2)}</strong>
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                    Split Among:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {e.splits.map((s, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 bg-cream-50 border border-slate-200 text-slate-700 text-[11px] font-medium px-2 py-0.5 rounded-lg"
                      >
                        <span>@{memberMap[s.member_id] || s.member_id}</span>
                        <strong className="text-slate-900">₹{s.share_amount.toFixed(2)}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Expense Modal */}
      {showAddExpense && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="panel-card max-w-lg w-full p-5 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Log Shared Expense</h3>
              <button onClick={() => setShowAddExpense(false)} className="text-slate-400 hover:text-slate-600 font-bold p-1">✕</button>
            </div>

            <form onSubmit={handleCreateExpense} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Description *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dinner, Beach Shack, Groceries"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Total Amount (₹) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>

              {/* Payer selection */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Paid By</label>
                  <button
                    type="button"
                    onClick={() => setIsMultiPayer(!isMultiPayer)}
                    className="text-xs text-brand-700 font-bold hover:underline"
                  >
                    {isMultiPayer ? 'Switch to Single Payer' : 'Multiple Payers?'}
                  </button>
                </div>

                {!isMultiPayer ? (
                  <select
                    value={paidBy}
                    onChange={(e) => setPaidBy(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
                  >
                    {group.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        @{m.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="space-y-2 p-3 bg-cream-50 rounded-xl border border-slate-200 text-xs">
                    {group.members.map((m) => (
                      <div key={m.id} className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-slate-700">@{m.name}</span>
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Amount paid"
                          value={payersMap[m.id] || ''}
                          onChange={(e) => setPayersMap({ ...payersMap, [m.id]: e.target.value })}
                          className="w-32 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Split Type Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Split Type</label>
                <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-100 rounded-xl">
                  {['equal', 'exact', 'percentage', 'shares'].map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setSplitType(type)}
                      className={`py-1.5 text-xs font-bold rounded-lg capitalize transition ${
                        splitType === type
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {/* Split Among Members Checklist / Custom Values */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Split Among Members
                </label>
                <div className="space-y-2 p-3 bg-cream-50 rounded-xl border border-slate-200 max-h-48 overflow-y-auto">
                  {group.members.map((m) => (
                    <div key={m.id} className="flex items-center justify-between text-xs">
                      <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          checked={!!selectedSplits[m.id]}
                          onChange={(e) =>
                            setSelectedSplits({ ...selectedSplits, [m.id]: e.target.checked })
                          }
                          className="rounded text-brand-600 focus:ring-brand-600"
                        />
                        <span>@{m.name}</span>
                      </label>

                      {splitType !== 'equal' && (
                        <input
                          type="number"
                          step="any"
                          placeholder={
                            splitType === 'exact'
                              ? '₹ Amount'
                              : splitType === 'percentage'
                              ? '% Pct'
                              : 'Shares (e.g. 1)'
                          }
                          value={customSplitValues[m.id] || ''}
                          onChange={(e) =>
                            setCustomSplitValues({ ...customSplitValues, [m.id]: e.target.value })
                          }
                          className="w-28 px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddExpense(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-xl disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Save Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add IOU Modal */}
      {showAddIOU && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="panel-card max-w-md w-full p-5 sm:p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Record Personal IOU</h3>
              <button onClick={() => setShowAddIOU(false)} className="text-slate-400 hover:text-slate-600 font-bold p-1">✕</button>
            </div>

            <form onSubmit={handleCreateIOU} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Debtor (Who Owes) *</label>
                <select
                  value={fromMember}
                  onChange={(e) => setFromMember(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
                >
                  {group.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      @{m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Creditor (Owed To) *</label>
                <select
                  value={toMember}
                  onChange={(e) => setToMember(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
                >
                  {group.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      @{m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Amount (₹) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={iouAmount}
                  onChange={(e) => setIouAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Note (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Chai money, Cash advance"
                  value={iouNote}
                  onChange={(e) => setIouNote(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddIOU(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-xl disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Record IOU'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
