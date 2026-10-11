import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

// The Green Sprout look for every printed document (receipts, loan documents, reports): a brand-green band
// with the logo mark, then key facts, an amount panel and tables, and a footer on every page.

export const COLORS = {
  brand: '#012203',
  accent: '#1F6B29',
  leaf: '#70AF3E',
  soft: '#D1FCD0',
  softFill: '#EEF7EC',
  ink: '#0E2112',
  muted: '#5B6B5D',
  rule: '#DCE7D9',
  danger: '#B42318',
  warning: '#8A5A00',
};

type Doc = InstanceType<typeof PDFDocument>;
const TIME_ZONE = 'Africa/Kampala';

export const formatUGX = (value: number | string | null | undefined) => `UGX ${Math.round(Number(value) || 0).toLocaleString('en-US')}`;
export const kampalaDate = (value: Date | string) =>
  new Date(value).toLocaleDateString('en-GB', { timeZone: TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' });
export const kampalaDateTime = (value: Date | string) =>
  new Date(value).toLocaleString('en-GB', { timeZone: TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
// Short, readable reference for a record id ("TX-3F9A1C2B")
export const reference = (prefix: string, id: string) => `${prefix}-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

export const TYPE_LABELS: Record<string, string> = {
  SAVINGS_DEPOSIT: 'Savings deposit',
  ACCOUNT_WITHDRAW: 'Withdrawal',
  CLOSURE_WITHDRAW: 'Account closure payout',
  MEMBERSHIP_FEE: 'Membership fee',
  LOAN_PAYMENT: 'Loan repayment',
};
export const typeLabel = (type: string) => TYPE_LABELS[type] ?? type.replace(/_/g, ' ').toLowerCase();

// The mark from src/assets/brand/gs-mark.svg (the same file the web app uses), drawn as vector paths.
// Only the sprout in its circle: the SVG's small wordmark underneath is clipped off (the SACCO name is set
// in type beside it).
const MARK_VIEWBOX = { x: 296, y: 212, size: 432 };
let markPaths: string[] | null = null;
const loadMark = () => {
  if (!markPaths) {
    const svg = fs.readFileSync(path.resolve('./src/assets/brand/gs-mark.svg'), 'utf8');
    markPaths = [...svg.matchAll(/\sd="([^"]+)"/g)].map(match => match[1].replace(/\s+/g, ' ').trim());
  }
  return markPaths;
};

export function drawMark(doc: Doc, x: number, y: number, size: number, color: string = COLORS.brand) {
  const scale = size / MARK_VIEWBOX.size;
  doc.save();
  doc.translate(x, y).scale(scale).translate(-MARK_VIEWBOX.x, -MARK_VIEWBOX.y);
  doc.rect(MARK_VIEWBOX.x, MARK_VIEWBOX.y, MARK_VIEWBOX.size, MARK_VIEWBOX.size).clip();
  for (const d of loadMark()) doc.path(d).fill(color);
  doc.restore();
}

export const newDocument = (options: { landscape?: boolean } = {}) =>
  new PDFDocument({ size: 'A4', layout: options.landscape ? 'landscape' : 'portrait', margin: 48, bufferPages: true, info: { Author: 'Green Sprout SACCO', Creator: 'Green Sprout SACCO' } });

export const contentWidth = (doc: Doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;

// Edge-to-edge brand band: mark and SACCO name on the left, the document title and reference on the right
export function brandHeader(doc: Doc, { title, reference: ref, subtitle }: { title: string; reference?: string; subtitle?: string }) {
  const height = 96;
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  doc.save();
  doc.rect(0, 0, doc.page.width, height).fill(COLORS.brand);
  doc.rect(0, height, doc.page.width, 4).fill(COLORS.leaf);
  doc.restore();

  drawMark(doc, left, 20, 56, COLORS.soft);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(15).text('Green Sprout SACCO', left + 72, 32, { lineBreak: false });
  doc.fillColor(COLORS.soft).font('Helvetica').fontSize(9).text('Savings and credit cooperative', left + 72, 52, { lineBreak: false });

  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(16).text(title, left, 30, { width, align: 'right', lineBreak: false });
  if (ref) doc.fillColor(COLORS.soft).font('Helvetica').fontSize(9).text(ref, left, 52, { width, align: 'right', lineBreak: false });
  if (subtitle) doc.fillColor(COLORS.soft).font('Helvetica').fontSize(9).text(subtitle, left, 66, { width, align: 'right', lineBreak: false });

  doc.x = left;
  doc.y = height + 30;
}

export function sectionHeading(doc: Doc, text: string) {
  ensureSpace(doc, 48);
  doc.fillColor(COLORS.accent).font('Helvetica-Bold').fontSize(9).text(text.toUpperCase(), doc.page.margins.left, doc.y, { characterSpacing: 0.8 });
  doc.moveDown(0.5);
}

export function ensureSpace(doc: Doc, needed: number) {
  // The footer sits inside the bottom margin, so content may run right down to it
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

// Facts in two columns: label above value
export function keyValues(doc: Doc, rows: Array<[string, string]>, columns = 2) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const columnWidth = width / columns;
  for (let index = 0; index < rows.length; index += columns) {
    ensureSpace(doc, 40);
    const y = doc.y;
    let tallest = 0;
    rows.slice(index, index + columns).forEach(([label, value], column) => {
      const x = left + column * columnWidth;
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8.5).text(label, x, y, { width: columnWidth - 16 });
      doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(11).text(value || '–', x, y + 12, { width: columnWidth - 16 });
      tallest = Math.max(tallest, doc.y - y);
    });
    doc.y = y + tallest + 10;
  }
  doc.x = left;
  doc.moveDown(0.4);
}

// The figure the document is about, in a soft panel, with an optional status chip
export function amountPanel(doc: Doc, { label, amount, chip, chipTone = 'good', note }: {
  label: string; amount: string; chip?: string; chipTone?: 'good' | 'warning' | 'danger'; note?: string;
}) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const height = note ? 86 : 72;
  ensureSpace(doc, height + 16);
  const y = doc.y;
  doc.save();
  doc.roundedRect(left, y, width, height, 10).fill(COLORS.softFill);
  doc.rect(left, y + 10, 4, height - 20).fill(COLORS.leaf);
  doc.restore();
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text(label, left + 20, y + 14);
  doc.fillColor(COLORS.brand).font('Helvetica-Bold').fontSize(24).text(amount, left + 20, y + 28, { lineBreak: false });
  if (note) doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8.5).text(note, left + 20, y + 60, { width: width - 40 });
  if (chip) {
    const tone = { good: COLORS.accent, warning: COLORS.warning, danger: COLORS.danger }[chipTone];
    doc.font('Helvetica-Bold').fontSize(9);
    const chipWidth = doc.widthOfString(chip) + 20;
    doc.save();
    doc.roundedRect(left + width - chipWidth - 16, y + 16, chipWidth, 20, 10).fill('#FFFFFF');
    doc.restore();
    doc.fillColor(tone).text(chip, left + width - chipWidth - 16, y + 22, { width: chipWidth, align: 'center', lineBreak: false });
  }
  doc.x = left;
  doc.y = y + height + 18;
}

export interface Column {
  label: string;
  width: number;
  align?: 'left' | 'right';
}

// A table that carries its header onto new pages; totals in bold on a soft row
export function table(doc: Doc, columns: Column[], rows: string[][], totals?: string[]) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const share = columns.reduce((sum, column) => sum + column.width, 0);
  const widths = columns.map(column => (column.width / share) * width);
  const rowHeight = 20;

  const drawRow = (cells: string[], { header = false, bold = false, shade = false } = {}) => {
    if (!header && doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      drawRow(columns.map(column => column.label), { header: true });
    }
    const y = doc.y;
    if (header || shade) {
      doc.save();
      doc.rect(left, y, width, rowHeight).fill(header ? COLORS.brand : COLORS.softFill);
      doc.restore();
    }
    let x = left;
    doc.font(header || bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(header ? 8 : 9).fillColor(header ? '#FFFFFF' : COLORS.ink);
    cells.forEach((cell, index) => {
      doc.text(header ? (cell ?? '').toUpperCase() : cell ?? '', x + 8, y + (header ? 7 : 6), {
        width: widths[index] - 16, align: columns[index].align ?? 'left', lineBreak: false, ellipsis: true,
      });
      x += widths[index];
    });
    if (!header) doc.moveTo(left, y + rowHeight).lineTo(left + width, y + rowHeight).strokeColor(COLORS.rule).lineWidth(0.5).stroke();
    doc.x = left;
    doc.y = y + rowHeight;
  };

  ensureSpace(doc, rowHeight * 3);
  drawRow(columns.map(column => column.label), { header: true });
  if (!rows.length) drawRow(['No entries', ...columns.slice(1).map(() => '')]);
  rows.forEach(row => drawRow(row));
  if (totals) drawRow(totals, { bold: true, shade: true });
  doc.moveDown(1);
}

export function paragraph(doc: Doc, text: string, { color = COLORS.ink, size = 10 } = {}) {
  ensureSpace(doc, 40);
  doc.fillColor(color).font('Helvetica').fontSize(size).text(text, doc.page.margins.left, doc.y, { width: contentWidth(doc), lineGap: 2 });
  doc.moveDown(0.8);
}

// Footer on every page: a rule, the note, when it was produced and the page number
export function footer(doc: Doc, note = 'Green Sprout SACCO · Keep this document for your records.') {
  const generated = kampalaDateTime(new Date());
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    // Writing inside the bottom margin would otherwise start a new page
    const margin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - margin + 6;
    doc.moveTo(left, y - 8).lineTo(left + width, y - 8).strokeColor(COLORS.rule).lineWidth(0.5).stroke();
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7.5);
    doc.text(note, left, y, { width: width * 0.7, lineBreak: false, ellipsis: true });
    doc.text(`Page ${index + 1} of ${range.count}`, left + width * 0.7, y, { width: width * 0.3, align: 'right', lineBreak: false });
    doc.text(`Produced ${generated} (Kampala time)`, left, y + 11, { width, lineBreak: false });
    doc.page.margins.bottom = margin;
  }
}

// Finishes the document and returns it as one Buffer (attached to emails in memory)
export function toBuffer(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}
