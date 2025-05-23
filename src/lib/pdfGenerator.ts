import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TransactionType, TransactionStatus } from '../models/transaction.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TransactionPDFData {
    transactionId: string;
    accountNumber: string;
    type: TransactionType;
    amount: number;
    status: TransactionStatus;
    date: string;
    name: string;
}

export async function generateTransactionPDF(data: TransactionPDFData): Promise<string> {
    const doc = new PDFDocument();
    const pdfPath = path.join(__dirname, `../../temp/${Date.now()}.pdf`);
    
    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, '../../temp'))) {
        fs.mkdirSync(path.join(__dirname, '../../temp'), { recursive: true });
    }

    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    // Add header
    doc.fontSize(25).text('Transaction Receipt', { align: 'center' });
    doc.moveDown();

    // Add company logo or name
    doc.fontSize(16).text('Your Company Name', { align: 'center' });
    doc.moveDown();

    // Add transaction details
    doc.fontSize(12);
    doc.text(`Date: ${data.date}`);
    doc.text(`Transaction ID: ${data.transactionId}`);
    doc.text(`Account Number: ${data.accountNumber}`);
    doc.text(`Customer Name: ${data.name}`);
    doc.moveDown();

    // Add transaction type and amount in a highlighted box
    doc.rect(50, doc.y, 500, 60).stroke();
    doc.fontSize(14);
    doc.text(`Transaction Type: ${data.type.replace(/_/g, ' ')}`, 60, doc.y + 10);
    doc.text(`Amount: $${data.amount.toLocaleString()}`, 60, doc.y + 30);
    doc.moveDown();

    // Add status
    doc.fontSize(12);
    doc.text(`Status: ${data.status}`, { align: 'right' });
    doc.moveDown();

    // Add footer
    doc.fontSize(10);
    doc.text('This is an official receipt. Please keep it for your records.', { align: 'center' });
    doc.text('Thank you for your business!', { align: 'center' });

    doc.end();

    return new Promise((resolve, reject) => {
        writeStream.on('finish', () => resolve(pdfPath));
        writeStream.on('error', reject);
    });
}

export async function generateAccountPDF(data: {
    accountId: string;
    name: string;
    email: string;
}): Promise<string> {
    const doc = new PDFDocument();
    const pdfPath = path.join(__dirname, `../../temp/${Date.now()}.pdf`);
    
    // Ensure temp directory exists
    if (!fs.existsSync(path.join(__dirname, '../../temp'))) {
        fs.mkdirSync(path.join(__dirname, '../../temp'), { recursive: true });
    }

    const writeStream = fs.createWriteStream(pdfPath);
    doc.pipe(writeStream);

    // Add header
    doc.fontSize(25).text('Account Confirmation', { align: 'center' });
    doc.moveDown();

    // Add company logo or name
    doc.fontSize(16).text('Your Company Name', { align: 'center' });
    doc.moveDown();

    // Add account details
    doc.fontSize(12);
    doc.text(`Account ID: ${data.accountId}`);
    doc.text(`Name: ${data.name}`);
    doc.text(`Email: ${data.email}`);
    doc.moveDown();

    // Add footer
    doc.fontSize(10);
    doc.text('This is an official account confirmation document.', { align: 'center' });
    doc.text('Thank you for choosing our services!', { align: 'center' });

    doc.end();

    return new Promise((resolve, reject) => {
        writeStream.on('finish', () => resolve(pdfPath));
        writeStream.on('error', reject);
    });
} 