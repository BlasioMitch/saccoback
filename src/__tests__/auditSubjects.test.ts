// The audit trail names who an action was about
import { personLabel, renderSummary, transactionLabel } from '../lib/auditSubjects.js';

const jane = { userId: 'u1', name: 'Jane Smith', email: 'jane@example.com', amount: 500_000, accountNumber: 'JS-1234567', typeLabel: 'a savings deposit' };

describe('renderSummary', () => {
  it('names the member and the amount', () => {
    expect(renderSummary('Approved a loan of {amount} for {person}', jane)).toBe('Approved a loan of UGX 500,000 for Jane Smith (jane@example.com)');
    expect(renderSummary('Approved the password reset for {person}: temporary password issued', jane))
      .toBe('Approved the password reset for Jane Smith (jane@example.com): temporary password issued');
    expect(renderSummary('Recorded {type} of {amount} for {person}', jane)).toBe('Recorded a savings deposit of UGX 500,000 for Jane Smith (jane@example.com)');
  });

  it('gives up (so the plain wording is used) when something is unknown', () => {
    expect(renderSummary('Opened account {account} for {person}', { name: 'Jane Smith' })).toBeNull();
    expect(renderSummary('Approved a loan of {amount} for {person}', null)).toBeNull();
    expect(renderSummary('Imported members from CSV', null)).toBe('Imported members from CSV');
  });
});

describe('labels', () => {
  it('uses whatever part of the name is known', () => {
    expect(personLabel({ email: 'x@y.z' })).toBe('x@y.z');
    expect(personLabel({ name: 'Jane' })).toBe('Jane');
    expect(personLabel(null)).toBeNull();
  });

  it('describes transaction types', () => {
    expect(transactionLabel('ACCOUNT_WITHDRAW')).toBe('a withdrawal');
    expect(transactionLabel('SOMETHING_NEW')).toBe('a transaction');
  });
});
