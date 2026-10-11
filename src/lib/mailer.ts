import nodemailer from 'nodemailer';
import hbs from 'nodemailer-express-handlebars';
import path from 'path';
import exphbs from 'express-handlebars';
import {
    accountConfirmation, AccountConfirmationData, loanClearedCertificate, LoanClearedData, loanStatement, LoanStatementData,
    ReceiptData, transactionReceipt,
} from './pdfGenerator.js';
import { formatUGX, kampalaDate, kampalaDateTime, reference, typeLabel } from './brandPdf.js';
import { addMonths } from './loanSchedule.js';

// Member emails: one branded layout (templates/layouts/email.handlebars) with the logo inline, each with its
// document attached as a PDF built in memory.
// EMAIL_REDIRECT_TO sends every email to that address instead (development), so testing never reaches members.

const TEMPLATES = path.resolve('./src/templates');
const LOGO = path.join(TEMPLATES, 'assets/gs-logo.png');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'ts.gmail.com',
        pass: process.env.EMAIL_PASSWORD || 'lops'
    },
});

const engine = exphbs.create({
    extname: '.handlebars',
    layoutsDir: path.join(TEMPLATES, 'layouts'),
    partialsDir: path.join(TEMPLATES, 'partials'),
    defaultLayout: 'email',
});

transporter.use('compile', hbs({ viewEngine: engine, viewPath: TEMPLATES, extName: '.handlebars' }));

interface Attachment {
    filename: string;
    content: Buffer;
    contentType: string;
}

interface EmailOptions {
    to: string;
    subject: string;
    template: string;
    context: Record<string, any>;
    attachments?: Attachment[];
}

// The HTML an email will have (also used by tests and the preview script)
export const renderEmail = (template: string, context: Record<string, any>): Promise<string> =>
    engine.renderView(path.join(TEMPLATES, `${template}.handlebars`), { ...context, layout: 'email' });

// Tests: emails are kept here instead of being sent (NODE_ENV=test), rendered, with their attachments listed
export const testOutbox: Array<Pick<EmailOptions, 'to' | 'subject' | 'template' | 'context'> & {
    html: string;
    attachments: Array<{ filename: string; contentType: string; size: number; content: Buffer }>;
}> = [];

export const recipientFor = (email: string) => process.env.EMAIL_REDIRECT_TO?.trim() || email;

export async function sendEmail(options: EmailOptions): Promise<void> {
    const to = recipientFor(options.to);
    const context = { currentYear: new Date().getFullYear(), title: options.subject, ...options.context };
    const attachments = options.attachments ?? [];

    if (process.env.NODE_ENV === 'test') {
        testOutbox.push({
            to, subject: options.subject, template: options.template, context,
            html: await renderEmail(options.template, context),
            attachments: attachments.map(({ filename, contentType, content }) => ({ filename, contentType, size: content.length, content })),
        });
        return;
    }
    if (to !== options.to) console.log(`Email for ${options.to} sent to ${to} (EMAIL_REDIRECT_TO)`);

    await transporter.sendMail({
        from: `"Green Sprout SACCO" <${process.env.EMAIL_USER || 'ts.gmail.com'}>`,
        to,
        subject: options.subject,
        template: options.template,
        context,
        attachments: [{ filename: 'gs-logo.png', path: LOGO, cid: 'gs-logo' }, ...attachments],
    } as any);
}

// Emails go out after the change is saved and never fail the request that caused them
export const sendInBackground = (what: string, send: Promise<void>) => {
    send.catch(error => console.error(`Could not send the ${what} email:`, error));
};

const pdf = (filename: string, content: Buffer): Attachment => ({ filename, content, contentType: 'application/pdf' });

// A member was registered (their savings account comes later)
export async function sendWelcomeEmail(member: { email: string; name: string; joinedAt?: Date | string }) {
    await sendEmail({
        to: member.email,
        subject: 'Welcome to Green Sprout SACCO',
        template: 'welcome',
        context: {
            name: member.name,
            preheader: 'You are now a registered member of Green Sprout SACCO.',
            details: [
                { label: 'Member', value: member.name },
                { label: 'Sign-in email', value: member.email },
                { label: 'Joined', value: kampalaDate(member.joinedAt ?? new Date()) },
            ],
        },
    });
}

export async function sendAccountCreationEmail(data: AccountConfirmationData) {
    await sendEmail({
        to: data.email,
        subject: `Your account ${data.accountNumber} is open`,
        template: 'account-creation',
        context: {
            name: data.memberName,
            accountNumber: data.accountNumber,
            preheader: `Account ${data.accountNumber} is open and ready to use.`,
            details: [
                { label: 'Account number', value: data.accountNumber },
                { label: 'Opened on', value: kampalaDate(data.openedAt) },
                { label: 'Opening deposit', value: formatUGX(data.openingDeposit ?? 0) },
                { label: 'Membership fee', value: data.membershipFeePaid ? 'Paid' : 'Not paid yet' },
            ],
        },
        attachments: [pdf(`Account-confirmation-${data.accountNumber}.pdf`, await accountConfirmation(data))],
    });
}

const INTRO: Record<string, string> = {
    SAVINGS_DEPOSIT: 'A deposit has been added to your savings.',
    ACCOUNT_WITHDRAW: 'A withdrawal has been made from your savings.',
    CLOSURE_WITHDRAW: 'Your account closure payout has been recorded.',
    MEMBERSHIP_FEE: 'Your membership fee has been paid from your savings. You are now eligible for loans.',
    LOAN_PAYMENT: 'A repayment has been recorded on your loan.',
};
const STATUS_COLOR: Record<string, string> = { COMPLETED: '#1F6B29', PENDING: '#8A5A00', FAILED: '#B42318' };

export async function sendTransactionEmail(data: ReceiptData & { email: string }) {
    const ref = reference('TX', data.transactionId);
    const status = data.status.charAt(0) + data.status.slice(1).toLowerCase();
    await sendEmail({
        to: data.email,
        subject: `${typeLabel(data.type)} of ${formatUGX(data.amount)} · receipt ${ref}`,
        template: 'transaction',
        context: {
            name: data.memberName,
            intro: data.status === 'COMPLETED' ? INTRO[data.type] ?? 'A transaction has been recorded on your account.' : `This transaction is ${status.toLowerCase()}.`,
            typeLabel: typeLabel(data.type),
            amount: formatUGX(data.amount),
            statusLabel: status,
            statusColor: STATUS_COLOR[data.status] ?? '#1F6B29',
            preheader: `${typeLabel(data.type)} of ${formatUGX(data.amount)} on account ${data.accountNumber}.`,
            details: [
                { label: 'Receipt number', value: ref },
                { label: 'Account number', value: data.accountNumber },
                { label: 'Date and time', value: kampalaDateTime(data.date) },
                ...(data.loanRemaining != null ? [{ label: 'Still owed on the loan', value: formatUGX(data.loanRemaining) }] : []),
                ...(data.balanceAfter != null && data.type !== 'LOAN_PAYMENT' ? [{ label: 'Savings balance', value: formatUGX(data.balanceAfter) }] : []),
            ],
        },
        attachments: [pdf(`Receipt-${ref}.pdf`, await transactionReceipt(data))],
    });
}

export async function sendLoanApprovedEmail(data: LoanStatementData & { email: string }) {
    const ref = reference('LN', data.loanId);
    const totalDue = Number(data.amount) + Number(data.totalInterest);
    await sendEmail({
        to: data.email,
        subject: `Your loan of ${formatUGX(data.amount)} is approved`,
        template: 'loan-approved',
        context: {
            name: data.memberName,
            amount: formatUGX(data.amount),
            note: data.note,
            summaryLine: `${data.term} monthly payments of about ${formatUGX(data.monthlyPayment)}`,
            preheader: `Loan ${ref}: ${formatUGX(data.amount)} over ${data.term} months.`,
            details: [
                { label: 'Loan reference', value: ref },
                { label: 'Interest rate', value: `${Number(data.interestRate)}%` },
                { label: 'Repayment period', value: `${data.term} month${data.term === 1 ? '' : 's'}` },
                { label: 'Monthly payment', value: formatUGX(data.monthlyPayment) },
                { label: 'Total interest', value: formatUGX(data.totalInterest) },
                { label: 'Total to repay', value: formatUGX(totalDue) },
                { label: 'First payment due', value: kampalaDate(addMonths(new Date(data.startDate), 1)) },
                { label: 'Last payment due', value: kampalaDate(data.endDate) },
            ],
        },
        attachments: [pdf(`Loan-statement-${ref}.pdf`, await loanStatement(data))],
    });
}

export async function sendLoanClearedEmail(data: LoanClearedData & { email: string }) {
    const ref = reference('LN', data.loanId);
    const totalRepaid = data.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    await sendEmail({
        to: data.email,
        subject: `Loan ${ref} is fully repaid`,
        template: 'loan-cleared',
        context: {
            name: data.memberName,
            totalRepaid: formatUGX(totalRepaid),
            preheader: `Congratulations, loan ${ref} is cleared.`,
            details: [
                { label: 'Loan reference', value: ref },
                { label: 'Amount borrowed', value: formatUGX(data.amount) },
                { label: 'Interest', value: formatUGX(data.totalInterest) },
                { label: 'Repayments', value: String(data.payments.length) },
                { label: 'Cleared on', value: kampalaDate(data.clearedAt) },
            ],
        },
        attachments: [pdf(`Loan-cleared-${ref}.pdf`, await loanClearedCertificate(data))],
    });
}

// The temporary password staff set after a "Forgot password?" request
export async function sendPasswordResetEmail(data: { email: string; name: string; password: string; expiresAt: Date }) {
    await sendEmail({
        to: data.email,
        subject: 'Your temporary password',
        template: 'password-reset',
        context: {
            name: data.name,
            email: data.email,
            password: data.password,
            expiresAt: data.expiresAt.toLocaleString('en-GB', { timeZone: 'Africa/Kampala', dateStyle: 'medium', timeStyle: 'short' }),
            preheader: 'Sign in with this temporary password and choose your own.',
        },
    });
}
