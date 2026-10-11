import { calculateMonthlyPayment, calculateTotalInterest } from './utils.js';

// The repayment plan printed on a loan statement: one instalment a month from the start date, each the monthly
// payment (rounded up, as the loan book charges it), the last one only what is left, so they add up to the total due.
export interface Instalment {
  number: number;
  dueDate: Date;
  amount: number;
  balanceAfter: number;
}

// Same month arithmetic as the loan service: 31 January + 1 month is the end of February
export const addMonths = (date: Date, months: number) => {
  const result = new Date(date);
  const day = result.getDate();
  result.setMonth(result.getMonth() + months);
  if (result.getDate() !== day) result.setDate(0);
  return result;
};

export function repaymentSchedule(amount: number, interestRate: number, term: number, startDate: Date): Instalment[] {
  const totalDue = Number(amount) + calculateTotalInterest(amount, interestRate, term);
  const monthly = calculateMonthlyPayment(amount, interestRate, term);
  const schedule: Instalment[] = [];
  let remaining = totalDue;
  for (let number = 1; number <= term && remaining > 0; number += 1) {
    const instalment = number === term ? remaining : Math.min(monthly, remaining);
    remaining -= instalment;
    schedule.push({ number, dueDate: addMonths(startDate, number), amount: instalment, balanceAfter: remaining });
  }
  return schedule;
}
