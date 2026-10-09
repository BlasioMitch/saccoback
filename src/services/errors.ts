// Errors raised by the services carry the HTTP status the routes should answer with
export class ServiceError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ServiceError';
  }
}

// Turns any thrown error into { status, message } for single routes and bulk results
export const describeError = (error: unknown): { status: number; message: string } => {
  if (error instanceof ServiceError) return { status: error.status, message: error.message };
  if (error instanceof Error) {
    const details = (error as any).errors?.map((item: any) => item.message).join('; ');
    if (error.name === 'SequelizeValidationError') return { status: 400, message: details || 'Validation error' };
    if (error.name === 'SequelizeUniqueConstraintError') return { status: 409, message: details || 'Already exists' };
    if (error.name === 'SequelizeDatabaseError') return { status: 400, message: 'Invalid value for this field type' };
  }
  console.error('Unexpected service error:', error);
  return { status: 500, message: 'Internal server error' };
};
