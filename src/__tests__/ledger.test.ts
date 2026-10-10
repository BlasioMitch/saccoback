// Posting rules behind every report: debits always equal credits, and the reports balance
import {
  balanceSheet, cashEffect, interestShare, LedgerEvent, loanArrears, postEvent, totalInterest, trialBalance,
} from '../lib/ledger.js';

const sumSide = (event: LedgerEvent) => postEvent(event).reduce(
  (total, line) => ({ debit: total.debit + line.debit, credit: total.credit + line.credit }), { debit: 0, credit: 0 },
);

describe('postEvent', () => {
  const kinds: LedgerEvent[] = [
    { kind: 'SAVINGS_DEPOSIT', amount: 50_000 },
    { kind: 'ACCOUNT_WITHDRAW', amount: 20_000 },
    { kind: 'CLOSURE_WITHDRAW', amount: 5_000 },
    { kind: 'MEMBERSHIP_FEE', amount: 20_000 },
    { kind: 'LOAN_DISBURSEMENT', amount: 1_000_000 },
    { kind: 'LOAN_PAYMENT', amount: 110_000, interest: 10_000 },
  ];

  it.each(kinds)('balances a $kind', (event) => {
    const { debit, credit } = sumSide(event);
    expect(debit).toBe(event.amount);
    expect(credit).toBe(event.amount);
  });

  it('splits a repayment into principal and interest', () => {
    expect(postEvent({ kind: 'LOAN_PAYMENT', amount: 110_000, interest: 10_000 })).toEqual([
      { account: 'CASH', debit: 110_000, credit: 0 },
      { account: 'LOANS_RECEIVABLE', debit: 0, credit: 100_000 },
      { account: 'INTEREST_INCOME', debit: 0, credit: 10_000 },
    ]);
  });

  it('takes the membership fee from savings without moving cash', () => {
    expect(cashEffect({ kind: 'MEMBERSHIP_FEE', amount: 20_000 })).toBe(0);
    expect(postEvent({ kind: 'MEMBERSHIP_FEE', amount: 20_000 }).map(line => line.account)).toEqual(['MEMBER_SAVINGS', 'FEE_INCOME']);
  });

  it('never lets interest exceed the payment, and ignores empty amounts', () => {
    expect(sumSide({ kind: 'LOAN_PAYMENT', amount: 5_000, interest: 9_000 })).toEqual({ debit: 5_000, credit: 5_000 });
    expect(postEvent({ kind: 'SAVINGS_DEPOSIT', amount: 0 })).toEqual([]);
  });
});

describe('interestShare', () => {
  it('follows the loan book\'s flat interest', () => {
    // 1,000,000 at 10% owes 1,100,000; a tenth of every payment is interest
    expect(totalInterest(1_000_000, 10)).toBe(100_000);
    expect(interestShare(110_000, 1_000_000, 10)).toBe(10_000);
    expect(interestShare(0, 1_000_000, 10)).toBe(0);
  });

  it('adds up to the loan\'s total interest once it is repaid', () => {
    const payments = Array.from({ length: 12 }, () => 91_667);
    payments[11] = 1_100_000 - 91_667 * 11;
    const interest = payments.reduce((total, payment) => total + interestShare(payment, 1_000_000, 10), 0);
    expect(Math.abs(interest - 100_000)).toBeLessThanOrEqual(12);
  });
});

describe('trial balance and balance sheet', () => {
  const events: LedgerEvent[] = [
    { kind: 'SAVINGS_DEPOSIT', amount: 3_000_000 },
    { kind: 'MEMBERSHIP_FEE', amount: 60_000 },
    { kind: 'ACCOUNT_WITHDRAW', amount: 400_000 },
    { kind: 'LOAN_DISBURSEMENT', amount: 2_000_000 },
    { kind: 'LOAN_PAYMENT', amount: 550_000, interest: 50_000 },
    { kind: 'CLOSURE_WITHDRAW', amount: 100_000 },
  ];

  it('debits equal credits', () => {
    const result = trialBalance(events);
    expect(result.balanced).toBe(true);
    expect(result.totals.debit).toBe(result.totals.credit);
  });

  it('assets equal liabilities plus equity', () => {
    const sheet = balanceSheet(events);
    expect(sheet.balanced).toBe(true);
    const line = (rows: { code: string; amount: number }[], code: string) => rows.find(row => row.code === code)?.amount;
    expect(line(sheet.assets, '1000')).toBe(3_000_000 - 400_000 - 2_000_000 + 550_000 - 100_000);
    expect(line(sheet.assets, '1100')).toBe(2_000_000 - 500_000);
    expect(line(sheet.liabilities, '2000')).toBe(3_000_000 - 60_000 - 400_000 - 100_000);
    expect(sheet.totals.equity).toBe(60_000 + 50_000);
  });

  it('balances for an empty ledger', () => {
    expect(trialBalance([]).balanced).toBe(true);
    expect(balanceSheet([]).balanced).toBe(true);
  });
});

describe('loanArrears', () => {
  const loan = { amount: 1_200_000, interestRate: 10, term: 12, startDate: '2026-01-15T09:00:00Z' };
  // 1,320,000 owed over 12 months: 110,000 a month

  it('is current before the first instalment is due', () => {
    const result = loanArrears({ ...loan, paid: 0 }, new Date('2026-02-10T00:00:00Z'));
    expect(result).toMatchObject({ monthlyPayment: 110_000, instalmentsDue: 0, arrears: 0, daysOverdue: 0, bucket: 'CURRENT' });
  });

  it('is current when every due instalment is paid', () => {
    const result = loanArrears({ ...loan, paid: 330_000 }, new Date('2026-04-20T00:00:00Z'));
    expect(result).toMatchObject({ instalmentsDue: 3, arrears: 0, bucket: 'CURRENT', outstanding: 990_000 });
  });

  it('counts days from the first instalment not fully covered', () => {
    // Paid one instalment; the second fell due on 15 March
    const result = loanArrears({ ...loan, paid: 110_000 }, new Date('2026-04-20T09:00:00Z'));
    expect(result.instalmentsDue).toBe(3);
    expect(result.arrears).toBe(220_000);
    expect(result.daysOverdue).toBe(36);
    expect(result.bucket).toBe('D31_60');
  });

  it('puts long-unpaid loans over 90 days', () => {
    const result = loanArrears({ ...loan, paid: 0 }, new Date('2026-08-01T00:00:00Z'));
    expect(result.bucket).toBe('D90_PLUS');
  });

  it('has no arrears once fully repaid, even early', () => {
    const result = loanArrears({ ...loan, paid: 1_320_000 }, new Date('2026-03-01T00:00:00Z'));
    expect(result).toMatchObject({ outstanding: 0, arrears: 0, bucket: 'CURRENT' });
  });

  it('handles month ends (31 January + 1 month is the end of February)', () => {
    const result = loanArrears({ ...loan, startDate: '2026-01-31T09:00:00Z', paid: 0 }, new Date('2026-02-28T12:00:00Z'));
    expect(result.instalmentsDue).toBe(1);
  });
});
