// Uganda shillings have no minor unit, so every money value is a whole number.
// Stored as Postgres BIGINT; capped at the largest integer JavaScript represents exactly
// (9,007,199,254,740,991 UGX) so values survive JSON and the GraphQL Money scalar unchanged.
export const MAX_AMOUNT = Number.MAX_SAFE_INTEGER;

export const isWholeAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

// Error message for the first money field that is present but not a whole number of shillings, else null
export const moneyFieldError = (body: Record<string, unknown>, fields: string[]): string | null => {
  for (const field of fields) {
    const value = body[field];
    if (value === undefined || value === null) continue;
    if (!isWholeAmount(value)) {
      return `${field} must be a whole number of shillings between 0 and ${MAX_AMOUNT}`;
    }
  }
  return null;
};
