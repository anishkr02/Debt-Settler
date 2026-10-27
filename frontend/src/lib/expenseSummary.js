function toPaise(amount) {
  return Math.round(Number(amount || 0) * 100);
}

function fromPaise(amount) {
  return amount / 100;
}

export function buildExpenseSummary(expenses, debts, members) {
  const memberById = new Map(
    members.map((member) => [member.id, member.name || 'Former member'])
  );
  const rowById = new Map();

  const ensureRow = (memberId) => {
    if (!rowById.has(memberId)) {
      rowById.set(memberId, {
        member_id: memberId,
        name: memberById.get(memberId) || 'Former member',
        paidPaise: 0,
        sharePaise: 0,
        loansPaise: 0,
        detail: [],
      });
    }
    return rowById.get(memberId);
  };

  for (const member of members) ensureRow(member.id);

  let expenseTotalPaise = 0;
  for (const expense of expenses) {
    expenseTotalPaise += toPaise(expense.total_amount);
    const paidByMember = new Map();
    const shareByMember = new Map();

    for (const payer of expense.payers || []) {
      const amount = toPaise(payer.amount_paid);
      const row = ensureRow(payer.member_id);
      row.paidPaise += amount;
      paidByMember.set(payer.member_id, (paidByMember.get(payer.member_id) || 0) + amount);
    }
    for (const split of expense.splits || []) {
      const amount = toPaise(split.share_amount);
      const row = ensureRow(split.member_id);
      row.sharePaise += amount;
      shareByMember.set(split.member_id, (shareByMember.get(split.member_id) || 0) + amount);
    }

    const involvedMemberIds = new Set([...paidByMember.keys(), ...shareByMember.keys()]);
    for (const memberId of involvedMemberIds) {
      const paidPaise = paidByMember.get(memberId) || 0;
      const sharePaise = shareByMember.get(memberId) || 0;
      if (paidPaise > 0 || sharePaise > 0) {
        ensureRow(memberId).detail.push({
          description: expense.description,
          paid: fromPaise(paidPaise),
          share: fromPaise(sharePaise),
        });
      }
    }
  }

  for (const debt of debts) {
    const amountPaise = toPaise(debt.amount);
    const borrower = ensureRow(debt.from_member_id);
    const lender = ensureRow(debt.to_member_id);
    borrower.loansPaise -= amountPaise;
    lender.loansPaise += amountPaise;
    borrower.detail.push({
      kind: 'borrowed',
      other: lender.name,
      amount: fromPaise(amountPaise),
      note: debt.note,
    });
    lender.detail.push({
      kind: 'lent',
      other: borrower.name,
      amount: fromPaise(amountPaise),
      note: debt.note,
    });
  }

  const totalsPaise = { paid: 0, share: 0, loans: 0, net: 0 };
  const rows = [...rowById.values()].map((row) => {
    const netPaise = row.paidPaise - row.sharePaise + row.loansPaise;
    totalsPaise.paid += row.paidPaise;
    totalsPaise.share += row.sharePaise;
    totalsPaise.loans += row.loansPaise;
    totalsPaise.net += netPaise;
    return {
      member_id: row.member_id,
      name: row.name,
      paid: fromPaise(row.paidPaise),
      share: fromPaise(row.sharePaise),
      loans: fromPaise(row.loansPaise),
      net: fromPaise(netPaise),
      detail: row.detail,
    };
  });

  return {
    expenseCount: expenses.length,
    expenseTotal: fromPaise(expenseTotalPaise),
    loanCount: debts.length,
    rows,
    totals: {
      paid: fromPaise(totalsPaise.paid),
      share: fromPaise(totalsPaise.share),
      loans: fromPaise(totalsPaise.loans),
      net: fromPaise(totalsPaise.net),
    },
    balanced: Math.abs(totalsPaise.net) < 1,
  };
}
