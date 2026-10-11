import nodemailer from 'nodemailer';
import hbs from 'nodemailer-express-handlebars';
import path from 'path';
import fs from 'fs';
import exphbs from 'express-handlebars';
import { generateTransactionPDF, generateAccountPDF } from './pdfGenerator.js';
import { TransactionType, TransactionStatus } from '../models/transaction.js';


// Configure email transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'ts.gmail.com',
        pass: process.env.EMAIL_PASSWORD || 'lops'
    },
});

// Configure handlebars for email templates
const handlebarOptions = {
    viewEngine: exphbs.create({
        extname: '.handlebars',
        partialsDir: path.resolve('./src/templates/'),
        defaultLayout: false,
    }),
    viewPath: path.resolve('./src/templates/'),
    extName: '.handlebars',
};

transporter.use('compile', hbs(handlebarOptions));

// Interface for email options
interface EmailOptions {
    to: string;
    subject: string;
    template: string;
    context: Record<string, any>;
    attachments?: Array<{
        filename: string;
        path: string;
    }>;
}

// Tests: emails are kept here instead of being sent (NODE_ENV=test), so a test can read e.g. a temporary password
export const testOutbox: Array<Pick<EmailOptions, 'to' | 'subject' | 'template' | 'context'>> = [];

// Main email sending function
export async function sendEmail(options: EmailOptions): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
        testOutbox.push({ to: options.to, subject: options.subject, template: options.template, context: options.context });
        return;
    }
    try {
        let attachments = options.attachments || [];

        // Generate PDF if needed
        if (options.template === 'transaction') {
            const transactionContext = options.context as {
                transactionId: string;
                accountNumber: string;
                type: TransactionType;
                amount: number;
                status: TransactionStatus;
                date: string;
                name: string;
            };
            const pdfPath = await generateTransactionPDF(transactionContext);
            attachments.push({
                filename: `transaction_receipt_${Date.now()}.pdf`,
                path: pdfPath,
            });
        } else if (options.template === 'account-creation') {
            const accountContext = options.context as {
                accountId: string;
                name: string;
                email: string;
            };
            const pdfPath = await generateAccountPDF(accountContext);
            attachments.push({
                filename: `account_confirmation_${Date.now()}.pdf`,
                path: pdfPath,
            });
        }

        const mailOptions = {
            from: process.env.EMAIL_USER || 'ts.gmail.com',
            to: options.to,
            subject: options.subject,
            template: options.template,
            context: options.context,
            attachments,
        };

        await transporter.sendMail(mailOptions);

        // Clean up temporary PDF files
        attachments.forEach(attachment => {
            if (attachment.path.includes('/temp/')) {
                fs.unlinkSync(attachment.path);
            }
        });
    } catch (error) {
        console.error('Error sending email:', error);
        throw error;
    }
}

// Example usage functions
export async function sendAccountCreationEmail(userData: {
    email: string;
    name: string;
    accountId: string;
}): Promise<void> {
    await sendEmail({
        to: userData.email,
        subject: 'Welcome to Our Platform',
        template: 'account-creation',
        context: {
            name: userData.name,
            accountId: userData.accountId,
            email: userData.email,
        },
    });
}

export async function sendTransactionEmail(transactionData: {
    email: string;
    name: string;
    transactionId: string;
    accountNumber: string;
    type: TransactionType;
    amount: number;
    status: TransactionStatus;
    date: string;
}): Promise<void> {
    await sendEmail({
        to: transactionData.email,
        subject: 'Transaction Confirmation',
        template: 'transaction',
        context: {
            name: transactionData.name,
            transactionId: transactionData.transactionId,
            accountNumber: transactionData.accountNumber,
            type: transactionData.type,
            amount: transactionData.amount,
            status: transactionData.status,
            date: transactionData.date,
        },
    });
}

export async function sendLoanCreationEmail(loanData: {
    email: string;
    name: string;
    loanId: string;
    accountNumber: string;
    loanAmount: number;
    interestRate: number;
    term: number;
    monthlyPayment: number;
    totalInterest: number;
    totalAmount: number;
}): Promise<void> {
    await sendEmail({
        to: loanData.email,
        subject: 'Loan Approval Notification',
        template: 'loan-creation',
        context: {
            name: loanData.name,
            loanId: loanData.loanId,
            accountNumber: loanData.accountNumber,
            loanAmount: loanData.loanAmount.toLocaleString(),
            interestRate: loanData.interestRate,
            term: loanData.term,
            monthlyPayment: loanData.monthlyPayment.toLocaleString(),
            totalInterest: loanData.totalInterest.toLocaleString(),
            totalAmount: loanData.totalAmount.toLocaleString(),
            currentYear: new Date().getFullYear()
        },
    });
}

export async function sendLoanCompletionEmail(loanData: {
    email: string;
    name: string;
    loanId: string;
    accountNumber: string;
    loanAmount: number;
    interestRate: number;
    term: number;
    totalInterest: number;
    totalAmount: number;
    completionDate: string;
    transactions: Array<{
        date: string;
        amount: number;
        type: string;
    }>;
}): Promise<void> {
    await sendEmail({
        to: loanData.email,
        subject: 'Loan Completion Notification',
        template: 'loan-completion',
        context: {
            name: loanData.name,
            loanId: loanData.loanId,
            accountNumber: loanData.accountNumber,
            loanAmount: loanData.loanAmount.toLocaleString(),
            interestRate: loanData.interestRate,
            term: loanData.term,
            totalInterest: loanData.totalInterest.toLocaleString(),
            totalAmount: loanData.totalAmount.toLocaleString(),
            completionDate: loanData.completionDate,
            transactions: loanData.transactions.map(t => ({
                ...t,
                amount: t.amount.toLocaleString()
            })),
            currentYear: new Date().getFullYear()
        },
    });
}

// The temporary password staff set after a "Forgot password?" request
export async function sendPasswordResetEmail(data: {
    email: string;
    name: string;
    password: string;
    expiresAt: Date;
}): Promise<void> {
    await sendEmail({
        to: data.email,
        subject: 'Your temporary password',
        template: 'password-reset',
        context: {
            name: data.name,
            email: data.email,
            password: data.password,
            expiresAt: data.expiresAt.toLocaleString('en-GB', { timeZone: 'Africa/Kampala', dateStyle: 'medium', timeStyle: 'short' }),
            currentYear: new Date().getFullYear(),
        },
    });
}
