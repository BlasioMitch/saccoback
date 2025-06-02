import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { models } from '../models/index.js';
export function cn(...inputs) {
    return twMerge(clsx(inputs));
}
function generateAccountNo(firstName, lastName) {
    const firstInitial = firstName.trim()[0]?.toUpperCase() || '';
    const lastInitial = lastName.trim()[0]?.toUpperCase() || '';
    const initials = firstInitial + lastInitial;
    const now = new Date();
    const hour = now.getHours().toString().padStart(2, '0');
    const minute = now.getMinutes().toString().padStart(2, '0');
    const randomDigits = Math.floor(10000 + Math.random() * 90000); // 5 random digits
    return `${initials}-${hour}${randomDigits}${minute}`;
}
export async function generateUniqueAccountNumber(firstName, lastName) {
    let accountNumber;
    let exists = true;
    do {
        accountNumber = generateAccountNo(firstName, lastName);
        const existingAccount = await models.Account.findOne({ where: { accountNumber } });
        exists = !!existingAccount;
    } while (exists);
    return accountNumber;
}
// Calculate Monthly Payment
export function calculateMonthlyPayment(amount, interestRate, term) {
    const monthlyPayment = amount * (1 + interestRate / 100) / term;
    return monthlyPayment;
}
// Calculate Total Interest
export function calculateTotalInterest(amount, interestRate, term) {
    const totalInterest = amount * interestRate / 100;
    return totalInterest;
}
// Calculate Remaining Balance
export function calculateRemainingBalance(CurrentAmount, transactionAmount) {
    const remainingBalance = CurrentAmount - transactionAmount;
    return remainingBalance;
}
// export default generateUniqueAccountNumber
