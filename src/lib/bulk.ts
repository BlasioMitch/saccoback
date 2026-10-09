import type { Request, Response } from 'express';
import type { Transaction as DbTransaction } from 'sequelize';
import sequelize from './sequelize.js';
import { describeError } from '../services/errors.js';

export const MAX_BULK_ROWS = 1000;

// Runs each row in its own DB transaction: a failing row is rolled back and reported,
// the others are kept. Results are indexed by the row's position in the request.
export const bulkHandler = (createRow: (row: Record<string, any>, transaction: DbTransaction) => Promise<string>) =>
  async (req: Request, res: Response) => {
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'rows must be a non-empty array' });
    }
    if (rows.length > MAX_BULK_ROWS) {
      return res.status(400).json({ error: `At most ${MAX_BULK_ROWS} rows per import` });
    }

    const results = [];
    for (let row = 0; row < rows.length; row++) {
      try {
        const id = await sequelize.transaction((transaction) => createRow(rows[row], transaction));
        results.push({ row, ok: true, id });
      } catch (error) {
        results.push({ row, ok: false, error: describeError(error).message });
      }
    }
    res.status(200).json({ results });
  };
