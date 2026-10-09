// SACCO-wide settings read from the environment
const parsedRate = Number(process.env.DEFAULT_LOAN_RATE);

// Interest (%) used for member loan applications until a manager confirms or changes it on approval
export const DEFAULT_LOAN_RATE = Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : 10;
