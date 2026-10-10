// Who or what an audited action was about, so the trail reads "Approved a loan of UGX 500,000 for Jane Smith"
// rather than a bare record id. The lookup (describeSubject in audit.ts) fills a Subject; the wording here is pure.

export interface Subject {
  // The member affected (e.g. whose password was reset, whose account a deposit went to)
  userId?: string | null;
  name?: string | null;
  email?: string | null;
  accountNumber?: string | null;
  amount?: number | null;
  typeLabel?: string | null;
}

const money = (value: number) => `UGX ${Math.round(value).toLocaleString('en-US')}`;

// "Jane Smith (jane@example.com)", or whichever part is known
export const personLabel = (subject: Subject | null | undefined) => {
  if (!subject) return null;
  if (subject.name && subject.email) return `${subject.name} (${subject.email})`;
  return subject.name || subject.email || null;
};

const values = (subject: Subject): Record<string, string | null> => ({
  person: personLabel(subject),
  name: subject.name || subject.email || null,
  account: subject.accountNumber ?? null,
  amount: typeof subject.amount === 'number' && Number.isFinite(subject.amount) ? money(subject.amount) : null,
  type: subject.typeLabel ?? null,
});

// Fills "{person}", "{amount}" etc. Returns null when any placeholder is unknown, so the caller falls back
// to the plain summary instead of printing a half sentence.
export function renderSummary(template: string, subject: Subject | null | undefined): string | null {
  if (!subject) return /\{\w+\}/.test(template) ? null : template;
  const known = values(subject);
  let missing = false;
  const text = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = known[key];
    if (!value) missing = true;
    return value ?? '';
  });
  return missing ? null : text;
}

const TYPE_LABELS: Record<string, string> = {
  SAVINGS_DEPOSIT: 'a savings deposit',
  ACCOUNT_WITHDRAW: 'a withdrawal',
  CLOSURE_WITHDRAW: 'an account closure payout',
  LOAN_PAYMENT: 'a loan repayment',
  MEMBERSHIP_FEE: 'a membership fee',
};
export const transactionLabel = (type: string | null | undefined) => (type && TYPE_LABELS[type]) || 'a transaction';
