// The repayment plan printed on loan statements
import { addMonths, repaymentSchedule } from '../lib/loanSchedule.js';

describe('repaymentSchedule', () => {
  it('adds up to principal plus interest, the last instalment taking what is left', () => {
    const schedule = repaymentSchedule(1_000_000, 12, 12, new Date(2026, 9, 17));
    expect(schedule).toHaveLength(12);
    expect(schedule.slice(0, 11).every(row => row.amount === 93_334)).toBe(true);
    expect(schedule[11]).toMatchObject({ number: 12, amount: 93_326, balanceAfter: 0 });
    expect(schedule.reduce((sum, row) => sum + row.amount, 0)).toBe(1_120_000);
  });

  it('is due monthly from the start date, keeping month ends', () => {
    const schedule = repaymentSchedule(300_000, 10, 3, new Date(2026, 0, 31));
    expect(schedule.map(row => [row.dueDate.getMonth(), row.dueDate.getDate()])).toEqual([[1, 28], [2, 31], [3, 30]]);
    expect(addMonths(new Date(2026, 0, 31), 1).getDate()).toBe(28);
  });

  it('a one-month loan is a single payment of everything', () => {
    expect(repaymentSchedule(50_000, 10, 1, new Date(2026, 4, 1))).toEqual([expect.objectContaining({ amount: 55_000, balanceAfter: 0 })]);
  });
});
