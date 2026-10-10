import { Router } from 'express';
import { isReportType, REPORTS } from '../../services/reports.js';
import { reportDocument, writeReportPdf } from '../../lib/reportPdf.js';
import { describeError } from '../../services/errors.js';

// Bookkeeping reports for ADMIN and MANAGER users (role enforced by the gateway).
// GET /reports/:type?from&to (cash book, income statement) or ?asAt (the rest); add .pdf for a printable copy.
const router = Router();

router.get('/:type', async (req, res) => {
  const pdf = req.params.type.endsWith('.pdf');
  const type = pdf ? req.params.type.slice(0, -4) : req.params.type;
  if (!isReportType(type)) return res.status(404).json({ error: 'Unknown report' });
  try {
    const data = await REPORTS[type](req.query as Record<string, unknown>);
    if (!pdf) return res.json(data);
    const period = 'asAt' in data ? data.asAt : `${data.from}_${data.to}`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${type}_${period}.pdf"`);
    writeReportPdf(res, reportDocument(type, data));
  } catch (error) {
    const { status, message } = describeError(error);
    if (!res.headersSent) res.status(status).json({ error: message });
  }
});

export default router;
