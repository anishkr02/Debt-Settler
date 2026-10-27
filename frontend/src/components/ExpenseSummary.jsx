import React, { useState } from 'react';
import { buildExpenseSummary } from '../lib/expenseSummary';

function formatAmount(amount) {
  return `₹${Math.abs(amount).toFixed(2)}`;
}

function formatSignedAmount(amount) {
  if (amount > 0) return `+${formatAmount(amount)}`;
  if (amount < 0) return `-${formatAmount(amount)}`;
  return '₹0.00';
}

function LoanAmount({ row }) {
  if (row.detail.every((item) => !item.kind)) return '-';
  return formatSignedAmount(row.loans);
}

function PersonDetail({ row }) {
  return (
    <div className="mt-2 space-y-2 border-t border-slate-100 pt-2 text-xs">
      {row.detail.map((item, index) => (
        <div key={`${item.description || item.kind}-${index}`} className="break-words">
          {item.kind ? (
            <>
              <p className="font-medium text-slate-700">
                {item.kind === 'lent'
                  ? `Lent ${formatAmount(item.amount)} to @${item.other}`
                  : `Borrowed ${formatAmount(item.amount)} from @${item.other}`}
              </p>
              {item.note && <p className="text-slate-500">{item.note}</p>}
            </>
          ) : (
            <p className="text-slate-700">
              {item.description}: paid {formatAmount(item.paid)}, share {formatAmount(item.share)}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function PersonButton({ row, expanded, onClick }) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onClick}
      className="break-all text-left font-bold text-slate-800 underline decoration-slate-300 underline-offset-2"
    >
      @{row.name}
    </button>
  );
}

function NetAmount({ amount }) {
  const color = amount > 0 ? 'text-brand-700' : amount < 0 ? 'text-red-600' : 'text-slate-700';
  return <span className={`font-extrabold ${color}`}>{formatSignedAmount(amount)}</span>;
}

export default function ExpenseSummary({ expenses, debts, members }) {
  const [expanded, setExpanded] = useState(false);
  const [expandedMembers, setExpandedMembers] = useState({});
  const summary = buildExpenseSummary(expenses, debts, members);

  if (summary.expenseCount === 0 && summary.loanCount === 0) return null;

  const expenseLabel = `${summary.expenseCount} ${
    summary.expenseCount === 1 ? 'expense' : 'expenses'
  } totalling ${formatAmount(summary.expenseTotal)}`;
  const loanLabel = `${summary.loanCount} ${summary.loanCount === 1 ? 'loan' : 'loans'}`;
  const toggleMember = (memberId) => {
    setExpandedMembers((current) => ({ ...current, [memberId]: !current[memberId] }));
  };

  return (
    <section className="content-card min-w-0 space-y-3">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="w-full text-left text-sm font-bold text-ink-900"
      >
        {expenseLabel}{summary.loanCount > 0 ? ` plus ${loanLabel}` : ''}
      </button>

      {expanded && (
        <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[600px] text-left text-xs">
              <thead className="border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Person</th>
                  <th className="px-3 py-2">Paid out of pocket</th>
                  <th className="px-3 py-2">Their share</th>
                  <th className="px-3 py-2">Loans</th>
                  <th className="py-2 pl-3 text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((row) => (
                  <React.Fragment key={row.member_id}>
                    <tr className="border-b border-slate-100">
                      <td className="py-2 pr-3">
                        <PersonButton
                          row={row}
                          expanded={!!expandedMembers[row.member_id]}
                          onClick={() => toggleMember(row.member_id)}
                        />
                      </td>
                      <td className="px-3 py-2">{formatAmount(row.paid)}</td>
                      <td className="px-3 py-2">{formatAmount(row.share)}</td>
                      <td className="px-3 py-2"><LoanAmount row={row} /></td>
                      <td className="py-2 pl-3 text-right"><NetAmount amount={row.net} /></td>
                    </tr>
                    {expandedMembers[row.member_id] && (
                      <tr>
                        <td colSpan="5" className="px-2 pb-2">
                          <PersonDetail row={row} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
                <tr className="font-bold text-slate-800">
                  <td className="py-2 pr-3">Totals</td>
                  <td className="px-3 py-2">{formatAmount(summary.totals.paid)}</td>
                  <td className="px-3 py-2">{formatAmount(summary.totals.share)}</td>
                  <td className="px-3 py-2">{formatSignedAmount(summary.totals.loans)}</td>
                  <td className="py-2 pl-3 text-right">
                    <NetAmount amount={summary.totals.net} />
                    {summary.balanced && (
                      <span className="ml-2 whitespace-nowrap text-[10px] text-brand-700">Balanced ✓</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="space-y-2 sm:hidden">
            {summary.rows.map((row) => (
              <div key={row.member_id} className="min-w-0 rounded-xl border border-slate-200 bg-cream-50/50 p-3">
                <PersonButton
                  row={row}
                  expanded={!!expandedMembers[row.member_id]}
                  onClick={() => toggleMember(row.member_id)}
                />
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div className="min-w-0 break-words">
                    <span className="block text-[10px] text-slate-500">Paid out of pocket</span>
                    {formatAmount(row.paid)}
                  </div>
                  <div className="min-w-0 break-words">
                    <span className="block text-[10px] text-slate-500">Their share</span>
                    {formatAmount(row.share)}
                  </div>
                  <div className="min-w-0 break-words">
                    <span className="block text-[10px] text-slate-500">Loans</span>
                    <LoanAmount row={row} />
                  </div>
                  <div className="min-w-0 break-words">
                    <span className="block text-[10px] text-slate-500">Net</span>
                    <NetAmount amount={row.net} />
                  </div>
                </div>
                {expandedMembers[row.member_id] && <PersonDetail row={row} />}
              </div>
            ))}
            <div className="rounded-xl border border-slate-200 p-3 text-xs font-bold">
              <p>Totals</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div><span className="block text-[10px] text-slate-500">Paid out of pocket</span>{formatAmount(summary.totals.paid)}</div>
                <div><span className="block text-[10px] text-slate-500">Their share</span>{formatAmount(summary.totals.share)}</div>
                <div><span className="block text-[10px] text-slate-500">Loans</span>{formatSignedAmount(summary.totals.loans)}</div>
                <div>
                  <span className="block text-[10px] text-slate-500">Net</span>
                  <NetAmount amount={summary.totals.net} />
                  {summary.balanced && <span className="ml-2 text-[10px] text-brand-700">Balanced ✓</span>}
                </div>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-slate-500">
            Shares can differ by ₹0.01 from the total because of rounding.
          </p>
        </>
      )}
    </section>
  );
}
