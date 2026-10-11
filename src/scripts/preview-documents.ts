// Renders every member document and email with sample data, for design review (nothing is sent or saved):
//   npm run preview:documents -- <output folder>
import fs from 'fs';
import path from 'path';
import { accountConfirmation, loanClearedCertificate, loanStatement, transactionReceipt } from '../lib/pdfGenerator.js';
import { renderEmail } from '../lib/mailer.js';
import { writeReportPdf } from '../lib/reportPdf.js';
import { formatUGX } from '../lib/brandPdf.js';

const out = path.resolve(process.argv[2] || './document-previews');
fs.mkdirSync(out, { recursive: true });
const save = (name: string, content: Buffer | string) => fs.writeFileSync(path.join(out, name), content);

const member = { memberName: 'Aisha Nakato', accountNumber: 'AN-7068479', email: 'aisha.nakato@example.com' };
const loan = { loanId: '4f1c2a7e-9b0d-4c55-9a1e-2f9d8b7c6a51', amount: 1_000_000, interestRate: 12, term: 12, totalInterest: 120_000, monthlyPayment: 93_334 };

save('receipt.pdf', await transactionReceipt({ ...member, transactionId: '6f1c2a7e-4b0d-4c55-9a1e-2f9d8b7c6a51', type: 'SAVINGS_DEPOSIT', amount: 150_000, status: 'COMPLETED', date: new Date(), balanceAfter: 820_000 }));
save('receipt-repayment.pdf', await transactionReceipt({ ...member, transactionId: '7a1c2a7e-4b0d-4c55-9a1e-2f9d8b7c6a51', type: 'LOAN_PAYMENT', amount: 93_334, status: 'COMPLETED', date: new Date(), loanRemaining: 933_332, description: 'Paid from savings' }));
save('account-confirmation.pdf', await accountConfirmation({ ...member, contact: '0772 123456', openedAt: new Date(), openingDeposit: 50_000, membershipFeePaid: true }));
save('loan-statement.pdf', await loanStatement({ ...member, ...loan, startDate: new Date('2026-10-17'), endDate: new Date('2027-10-17'), purpose: 'Poultry project', note: 'Good repayment history', approvedAt: new Date() }));
save('loan-cleared.pdf', await loanClearedCertificate({
  ...member, ...loan, startDate: new Date('2025-10-17'), clearedAt: new Date(),
  payments: Array.from({ length: 12 }, (_, index) => ({ date: new Date(2025, 10 + index, 15), amount: index === 11 ? 93_326 : 93_334 })),
}));
await new Promise<void>((resolve) => {
  const stream = fs.createWriteStream(path.join(out, 'report-trial-balance.pdf'));
  stream.on('finish', resolve);
  writeReportPdf(stream, {
    title: 'Trial balance', subtitle: 'As at 11 Oct 2026',
    sections: [{ columns: [{ label: 'Code', width: 1 }, { label: 'Account', width: 4 }, { label: 'Debit', width: 2, align: 'right' }, { label: 'Credit', width: 2, align: 'right' }],
      rows: [['1000', 'Cash and bank', '12,450,000', ''], ['1100', 'Loans to members', '8,200,000', ''], ['2000', 'Member savings deposits', '', '19,100,000'], ['4000', 'Membership fee income', '', '800,000'], ['4100', 'Loan interest income', '', '750,000']],
      totals: ['', 'Total', '20,650,000', '20,650,000'] }],
  });
});

const year = new Date().getFullYear();
const details = (rows: Array<[string, string]>) => rows.map(([label, value]) => ({ label, value }));
const emails: Array<[string, Record<string, any>]> = [
  ['welcome', { title: 'Welcome to Green Sprout SACCO', name: 'Aisha Nakato', details: details([['Member', 'Aisha Nakato'], ['Sign-in email', member.email], ['Joined', '11 Oct 2026']]) }],
  ['account-creation', { title: 'Your account AN-7068479 is open', name: 'Aisha Nakato', accountNumber: member.accountNumber, details: details([['Account number', member.accountNumber], ['Opened on', '11 Oct 2026'], ['Opening deposit', formatUGX(50_000)], ['Membership fee', 'Paid']]) }],
  ['transaction', { title: 'Savings deposit of UGX 150,000', name: 'Aisha Nakato', intro: 'A deposit has been added to your savings.', typeLabel: 'Savings deposit', amount: formatUGX(150_000), statusLabel: 'Completed', statusColor: '#1F6B29', details: details([['Receipt number', 'TX-6F1C2A7E'], ['Account number', member.accountNumber], ['Date and time', '11 Oct 2026, 14:05'], ['Savings balance', formatUGX(820_000)]]) }],
  ['loan-approved', { title: 'Your loan of UGX 1,000,000 is approved', name: 'Aisha Nakato', amount: formatUGX(1_000_000), summaryLine: '12 monthly payments of about UGX 93,334', note: 'Good repayment history', details: details([['Loan reference', 'LN-4F1C2A7E'], ['Interest rate', '12%'], ['Repayment period', '12 months'], ['Monthly payment', formatUGX(93_334)], ['Total to repay', formatUGX(1_120_000)]]) }],
  ['loan-cleared', { title: 'Loan LN-4F1C2A7E is fully repaid', name: 'Aisha Nakato', totalRepaid: formatUGX(1_120_000), details: details([['Loan reference', 'LN-4F1C2A7E'], ['Amount borrowed', formatUGX(1_000_000)], ['Interest', formatUGX(120_000)], ['Repayments', '12'], ['Cleared on', '11 Oct 2026']]) }],
  ['password-reset', { title: 'Your temporary password', name: 'Aisha Nakato', email: member.email, password: 'Kp7mWq2xRt9z', expiresAt: '12 Oct 2026, 14:05' }],
];
for (const [template, context] of emails) {
  // The logo is attached inline when sent; previews point at the file instead
  const html = (await renderEmail(template, { currentYear: year, preheader: '', ...context }))
    .replace('cid:gs-logo', `data:image/png;base64,${fs.readFileSync(path.resolve('./src/templates/assets/gs-logo.png')).toString('base64')}`);
  save(`email-${template}.html`, html);
}
console.log(`Previews written to ${out}`);
