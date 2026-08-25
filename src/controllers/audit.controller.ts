import pool from '../config/db';
import type { AsyncRequestHandler } from '../middleware/asyncHandler';

const COLS = [
  'id',
  'device_id',
  'platform',
  'app_version',
  'ts',
  'user_id',
  'actor_email',
  'actor_role',
  'level',
  'category',
  'label',
  'summary',
  'duration_ms',
  'request',
  'response',
  'error',
  'context',
] as const;

const LEVELS = new Set<string>(['debug', 'info', 'warn', 'error']);
const MAX_ENTRIES = 200;
const CHUNK = 50;

type AuditRow = (string | number | Date | object | null)[];

interface IngestMeta {
  deviceId: string;
  platform?: unknown;
  appVersion?: unknown;
}

function strOrNull(value: unknown, max: number): string | null {
  return value == null ? null : String(value).slice(0, max);
}

function objOrNull(value: unknown): object | null {
  if (value === null || typeof value !== 'object') return null;
  return value;
}

/**
 * Maps one client AuditLogEntry onto a row. Anything malformed is dropped
 * rather than rejected - a bad row should never lose the other 199.
 */
function normalizeEntry(raw: unknown, meta: IngestMeta): AuditRow | null {
  if (raw === null || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;

  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  const category = typeof entry.category === 'string' ? entry.category.trim() : '';
  if (!id || !category) return null;

  const rawTs = entry.timestamp;
  let tsMs: number;
  if (typeof rawTs === 'number' && Number.isFinite(rawTs)) {
    tsMs = rawTs;
  } else if (typeof rawTs === 'string') {
    const parsed = new Date(rawTs).getTime();
    tsMs = Number.isFinite(parsed) ? parsed : Date.now();
  } else {
    tsMs = Date.now();
  }
  const actor =
    entry.actor && typeof entry.actor === 'object'
      ? (entry.actor as Record<string, unknown>)
      : {};
  const level =
    typeof entry.level === 'string' && LEVELS.has(entry.level)
      ? entry.level
      : 'info';
  const durationMs = Number.isFinite(Number(entry.durationMs))
    ? Math.round(Number(entry.durationMs))
    : null;

  return [
    id.slice(0, 128),
    meta.deviceId.slice(0, 128),
    strOrNull(meta.platform, 32),
    strOrNull(meta.appVersion, 64),
    new Date(tsMs),
    strOrNull(actor.id, 128),
    strOrNull(actor.email, 320),
    strOrNull(actor.role, 32),
    level,
    category.slice(0, 64),
    strOrNull(entry.label, 512),
    strOrNull(entry.summary, 512),
    durationMs,
    objOrNull(entry.request),
    objOrNull(entry.response),
    strOrNull(entry.error, 1024),
    objOrNull(entry.context),
  ];
}

/**
 * POST /logs
 * Body: { deviceId, platform?, appVersion?, entries: AuditLogEntry[] }
 * Idempotent per entry id (the client correlation id), so retries are safe.
 * Accepts unauthenticated posts on purpose - failed sign-ins and session
 * expiry happen when there is no token, and those rows matter most.
 */
export const ingestLogs: AsyncRequestHandler = async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
  if (!deviceId) {
    res.status(400).json({ error: 'deviceId is required' });
    return;
  }

  const entries = body.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    res.status(400).json({ error: 'entries must be a non-empty array' });
    return;
  }
  if (entries.length > MAX_ENTRIES) {
    res
      .status(413)
      .json({ error: `Send at most ${MAX_ENTRIES} entries per request` });
    return;
  }

  const meta: IngestMeta = {
    deviceId,
    platform: body.platform,
    appVersion: body.appVersion,
  };
  const rows = entries
    .map(entry => normalizeEntry(entry, meta))
    .filter((row): row is AuditRow => row !== null);
  if (!rows.length) {
    res.status(400).json({ error: 'No valid entries in payload' });
    return;
  }

  console.log(`[audit] Ingesting ${rows.length} entries from device ${deviceId}`);

  let accepted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((row, r) => {
      const base = r * COLS.length;
      values.push(`(${COLS.map((_, c) => `$${base + c + 1}`).join(',')})`);
      params.push(...row);
    });

    const result = await pool.query(
      `INSERT INTO audit_logs (${COLS.join(',')})
       VALUES ${values.join(',')}`,
      params,
    );
    accepted += result.rowCount ?? 0;
  }

  res.json({ accepted });
};

const queryValue = (value: unknown): string | undefined => {
  if (value == null || typeof value === 'object') return undefined;
  return String(value);
};

const toDate = (value: string): Date | null => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * GET /logs?userId=&deviceId=&level=&category=&from=&to=&limit=&offset=
 * Admin only - see middleware/auth.ts.
 */
export const queryLogs: AsyncRequestHandler = async (req, res) => {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (fragment: string, value: unknown) => {
    params.push(value);
    conditions.push(`${fragment} $${params.length}`);
  };

  const userId = queryValue(req.query.userId);
  const deviceId = queryValue(req.query.deviceId);
  const level = queryValue(req.query.level);
  const category = queryValue(req.query.category);
  const actorRole = queryValue(req.query.actorRole);

  const fromRaw = queryValue(req.query.from);
  const toRaw = queryValue(req.query.to);
  const from = fromRaw ? toDate(fromRaw) : null;
  const to = toRaw ? toDate(toRaw) : null;
  if (fromRaw && !from) {
    res.status(400).json({ error: 'Invalid ISO date in "from"' });
    return;
  }
  if (toRaw && !to) {
    res.status(400).json({ error: 'Invalid ISO date in "to"' });
    return;
  }

  if (userId) add('user_id =', userId);
  if (deviceId) add('device_id =', deviceId);
  if (level) add('level =', level);
  if (category) add('category =', category);
  if (actorRole) add('actor_role =', actorRole);
  if (from) add('ts >=', from);
  if (to) add('ts <=', to);

  const limitRaw = parseInt(queryValue(req.query.limit) ?? '', 10);
  const offsetRaw = parseInt(queryValue(req.query.offset) ?? '', 10);
  const limit = Math.min(
    Math.max(Number.isNaN(limitRaw) ? 100 : limitRaw, 1),
    500,
  );
  const offset = Math.max(Number.isNaN(offsetRaw) ? 0 : offsetRaw, 0);

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const result = await pool.query(
    `SELECT * FROM audit_logs
     ${where}
     ORDER BY ts DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  res.json({ data: result.rows, count: result.rows.length });
};
