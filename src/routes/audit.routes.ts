import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { ingestLogs, queryLogs } from '../controllers/audit.controller';
import asyncHandler from '../middleware/asyncHandler';
import requireAdmin from '../middleware/auth';

const router = Router();

const ingestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/logs', ingestLimiter, asyncHandler(ingestLogs));
router.get('/logs', readLimiter, requireAdmin, asyncHandler(queryLogs));

export default router;
