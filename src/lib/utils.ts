import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { models } from '../models/index.js';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function generateAccountNo(firstName: string, lastName: string): string {
  const firstInitial = firstName.trim()[0]?.toUpperCase() || '';
  const lastInitial = lastName.trim()[0]?.toUpperCase() || '';
  
  const initials = firstInitial + lastInitial;

  const now = new Date();
  const hour = now.getHours().toString().padStart(2, '0');
  const minute = now.getMinutes().toString().padStart(2, '0');
  const randomDigits = Math.floor(10000 + Math.random() * 90000); // 5 random digits
  return `${initials}-${hour}${randomDigits}${minute}`;
}

export async function generateUniqueAccountNumber(firstName: string, lastName: string): Promise<string> {
  let accountNumber: string;
  let exists = true;

  do {
    accountNumber = generateAccountNo(firstName, lastName);
    const existingAccount = await models.Account.findOne({ where: { accountNumber } });
    exists = !!existingAccount;
  } while (exists);

  return accountNumber;
}

// Shillings have no minor unit, so every calculated amount is a whole number.

// Calculate Total Interest
export function calculateTotalInterest(amount: number, interestRate: number, term: number): number {
  const totalInterest = Math.round(Number(amount) * Number(interestRate) / 100);
  return totalInterest;
}

// Calculate Monthly Payment (rounded up so `term` payments always cover principal + interest)
export function calculateMonthlyPayment(amount: number, interestRate: number, term: number): number {
  const totalOwed = Number(amount) + calculateTotalInterest(amount, interestRate, term);
  const monthlyPayment = Math.ceil(totalOwed / Number(term));
  return monthlyPayment;
}

// Calculate Remaining Balance
export function calculateRemainingBalance(CurrentAmount: number, transactionAmount: number): number {
  const remainingBalance = Math.round(Number(CurrentAmount) - Number(transactionAmount));
  return remainingBalance;
}



// export default generateUniqueAccountNumber