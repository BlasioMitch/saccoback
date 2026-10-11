import type { Writable } from 'stream';
import { brandHeader, COLORS, footer, newDocument } from './brandPdf.js';

// Printable reports: the brand header, then tables (amounts in whole UGX, right-aligned)

interface Column {
  label: string;
  width: number;          // share of the page width
  align?: 'left' | 'right';
}

interface Section {
  heading?: string;
  columns: Column[];
  rows: string[][];
  totals?: string[];
}

interface ReportDocument {
  title: string;
  subtitle: string;
  landscape?: boolean;
  summary?: Array<[string, string]>;
  sections: Section[];
  notes?: string[];
}

const BRAND = COLORS.accent;
const MUTED = COLORS.muted;
const RULE = COLORS.rule;
const ROW_HEIGHT = 16;

export const money = (value: number | null | undefined) => Math.round(Number(value) || 0).toLocaleString('en-US');
const day = (value: string | Date) => new Date(value).toLocaleDateString('en-GB', { timeZone: 'Africa/Kampala', day: '2-digit', month: 'short', year: 'numeric' });

export function writeReportPdf(output: Writable, report: ReportDocument) {
  const doc = newDocument({ landscape: report.landscape });
  doc.pipe(output);
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 20;

  brandHeader(doc, { title: report.title, reference: report.subtitle, subtitle: 'Amounts in UGX' });

  if (report.summary?.length) {
    for (const [label, value] of report.summary) {
      const y = doc.y;
      doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(label, left, y, { width: width * 0.6 });
      doc.fillColor('#000').font('Helvetica-Bold').text(value, left + width * 0.6, y, { width: width * 0.4, align: 'right' });
      doc.moveDown(0.2);
    }
    doc.moveDown(0.6);
  }

  for (const section of report.sections) {
    const total = section.columns.reduce((sum, column) => sum + column.width, 0);
    const widths = section.columns.map(column => (column.width / total) * width);
    const drawRow = (cells: string[], { bold = false, color = '#000', header = false } = {}) => {
      if (doc.y + ROW_HEIGHT > bottom()) {
        doc.addPage();
        if (!header) drawRow(section.columns.map(column => column.label), { bold: true, color: MUTED, header: true });
      }
      const y = doc.y;
      let x = left;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(header ? 8.5 : 9).fillColor(color);
      cells.forEach((cell, index) => {
        doc.text(cell ?? '', x + 4, y + 3, { width: widths[index] - 10, align: section.columns[index].align ?? 'left', lineBreak: false, ellipsis: true });
        x += widths[index];
      });
      doc.moveTo(left, y + ROW_HEIGHT).lineTo(left + width, y + ROW_HEIGHT).strokeColor(RULE).lineWidth(0.5).stroke();
      doc.x = left;
      doc.y = y + ROW_HEIGHT;
    };

    if (section.heading) {
      if (doc.y + ROW_HEIGHT * 3 > bottom()) doc.addPage();
      doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(11).text(section.heading, left, doc.y);
      doc.moveDown(0.3);
    }
    if (section.columns.some(column => column.label)) {
      drawRow(section.columns.map(column => column.label.toUpperCase()), { bold: true, color: MUTED, header: true });
    }
    // A totals-only block (e.g. "Liabilities and equity") has no rows of its own
    if (!section.rows.length && !section.totals) drawRow(['No entries', ...section.columns.slice(1).map(() => '')], { color: MUTED });
    section.rows.forEach(row => drawRow(row));
    if (section.totals) drawRow(section.totals, { bold: true });
    doc.moveDown(1);
  }

  if (report.notes?.length) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5);
    for (const note of report.notes) doc.text(note, left, doc.y, { width });
  }

  footer(doc, `Green Sprout SACCO · ${report.title} · ${report.subtitle}`);
  doc.end();
}

// Each report's data laid out for print
export function reportDocument(type: string, data: any): ReportDocument {
  switch (type) {
    case 'cash-book':
      return {
        title: 'Cash book',
        subtitle: `${day(data.from)} to ${day(data.to)}`,
        landscape: true,
        summary: [
          ['Opening balance', money(data.opening)],
          ['Money in', money(data.totalIn)],
          ['Money out', money(data.totalOut)],
          ['Closing balance', money(data.closing)],
        ],
        sections: [{
          columns: [
            { label: 'Date', width: 1.1 }, { label: 'Description', width: 1.6 }, { label: 'Member', width: 1.8 },
            { label: 'Account', width: 1.1 }, { label: 'In', width: 1.1, align: 'right' }, { label: 'Out', width: 1.1, align: 'right' },
            { label: 'Balance', width: 1.2, align: 'right' },
          ],
          rows: data.lines.map((line: any) => [
            day(line.date), line.description, line.member ?? '', line.accountNumber ?? '',
            line.inflow ? money(line.inflow) : '', line.outflow ? money(line.outflow) : '', money(line.balance),
          ]),
          totals: ['', 'Totals', '', '', money(data.totalIn), money(data.totalOut), money(data.closing)],
        }],
        notes: [
          'Membership fees are taken from members\' savings and move no cash, so they appear in the income statement, not here.',
          'Loan disbursements are dated on each loan\'s start date.',
          ...(data.truncated ? ['Only the first 10,000 lines are shown; narrow the dates for the rest.'] : []),
          ...(data.filtered ? ['Filtered: the balance column still shows the full cash position.'] : []),
        ],
      };
    case 'income-statement':
      return {
        title: 'Income statement',
        subtitle: `${day(data.from)} to ${day(data.to)}`,
        sections: [
          {
            heading: 'Income',
            columns: [{ label: 'Account', width: 3 }, { label: 'Amount', width: 1, align: 'right' }],
            rows: data.income.map((line: any) => [`${line.code}  ${line.name}`, money(line.amount)]),
            totals: ['Total income', money(data.totals.income)],
          },
          {
            heading: 'Expenses',
            columns: [{ label: 'Account', width: 3 }, { label: 'Amount', width: 1, align: 'right' }],
            rows: [['Operating expenses (not recorded in the system)', '–']],
            totals: ['Surplus for the period', money(data.totals.surplus)],
          },
          {
            heading: 'By month',
            columns: [{ label: 'Month', width: 1.5 }, { label: 'Fees', width: 1, align: 'right' }, { label: 'Interest', width: 1, align: 'right' }, { label: 'Total', width: 1, align: 'right' }],
            rows: data.months.map((month: any) => [month.month, money(month.feeIncome), money(month.interestIncome), money(month.total)]),
            totals: ['Total', money(data.totals.income - data.income[1].amount), money(data.income[1].amount), money(data.totals.income)],
          },
        ],
        notes: ['Interest income is the interest part of each repayment, in proportion to the loan\'s interest to total owed.'],
      };
    case 'trial-balance':
      return {
        title: 'Trial balance',
        subtitle: `As at ${day(data.asAt)}`,
        sections: [{
          columns: [{ label: 'Code', width: 0.6 }, { label: 'Account', width: 2.4 }, { label: 'Type', width: 1 }, { label: 'Debit', width: 1, align: 'right' }, { label: 'Credit', width: 1, align: 'right' }],
          rows: data.rows.map((row: any) => [row.code, row.name, row.type.toLowerCase(), row.debit ? money(row.debit) : '', row.credit ? money(row.credit) : '']),
          totals: ['', 'Totals', '', money(data.totals.debit), money(data.totals.credit)],
        }],
        notes: [data.balanced ? 'Debits equal credits.' : 'Warning: debits and credits differ.'],
      };
    case 'balance-sheet': {
      const block = (heading: string, lines: any[], total: number, label: string): Section => ({
        heading,
        columns: [{ label: 'Account', width: 3 }, { label: 'Amount', width: 1, align: 'right' }],
        rows: lines.map(line => [`${line.code}  ${line.name}`, money(line.amount)]),
        totals: [label, money(total)],
      });
      return {
        title: 'Balance sheet',
        subtitle: `As at ${day(data.asAt)}`,
        sections: [
          block('Assets', data.assets, data.totals.assets, 'Total assets'),
          block('Liabilities', data.liabilities, data.totals.liabilities, 'Total liabilities'),
          block('Equity', data.equity, data.totals.equity, 'Total equity'),
          {
            columns: [{ label: '', width: 3 }, { label: '', width: 1, align: 'right' }],
            rows: [],
            totals: ['Liabilities and equity', money(data.totals.liabilities + data.totals.equity)],
          },
        ],
        notes: [
          data.balanced ? 'Assets equal liabilities plus equity.' : 'Warning: the balance sheet does not balance.',
          ...(data.savingsCheck ? [`Member savings check: ledger ${money(data.savingsCheck.ledger)}, account balances ${money(data.savingsCheck.accounts)}, difference ${money(data.savingsCheck.difference)}.`] : []),
        ],
      };
    }
    case 'loan-portfolio':
      return {
        title: 'Loan portfolio and arrears',
        subtitle: `As at ${day(data.asAt)}`,
        landscape: true,
        summary: [
          ['Loans disbursed', `${data.summary.loans} (${money(data.summary.disbursed)})`],
          ['Repaid', money(data.summary.repaid)],
          ['Outstanding', `${money(data.summary.outstanding)} on ${data.summary.openLoans} open loans`],
          ['In arrears', `${money(data.summary.arrears)} on ${data.summary.loansInArrears} loans`],
          ['Portfolio at risk (over 30 days)', `${(data.summary.portfolioAtRisk30 * 100).toFixed(1)}%`],
        ],
        sections: [
          {
            heading: 'Aging of open loans',
            columns: [{ label: 'Days overdue', width: 2 }, { label: 'Loans', width: 1, align: 'right' }, { label: 'Outstanding', width: 1.5, align: 'right' }, { label: 'Arrears', width: 1.5, align: 'right' }],
            rows: data.aging.map((bucket: any) => [bucket.label, String(bucket.count), money(bucket.outstanding), money(bucket.arrears)]),
          },
          {
            heading: 'Loans',
            columns: [
              { label: 'Member', width: 1.8 }, { label: 'Account', width: 1 }, { label: 'Start', width: 1 }, { label: 'Principal', width: 1, align: 'right' },
              { label: 'Paid', width: 1, align: 'right' }, { label: 'Outstanding', width: 1.1, align: 'right' }, { label: 'Arrears', width: 1, align: 'right' },
              { label: 'Days late', width: 0.8, align: 'right' }, { label: 'Status', width: 1 },
            ],
            rows: data.loans.map((loan: any) => [
              loan.member ?? '', loan.accountNumber ?? '', day(loan.startDate), money(loan.principal), money(loan.paid),
              money(loan.outstanding), loan.arrears ? money(loan.arrears) : '', loan.daysOverdue ? String(loan.daysOverdue) : '', loan.status.toLowerCase(),
            ]),
          },
        ],
        notes: ['Arrears: instalments due by the report date (one a month from the start date) less repayments made.'],
      };
    default:
      throw new Error(`Unknown report ${type}`);
  }
}
