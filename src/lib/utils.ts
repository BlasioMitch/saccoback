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


// export default generateUniqueAccountNumber