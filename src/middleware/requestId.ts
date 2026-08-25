import { randomUUID } from 'crypto';
import type { RequestHandler } from 'express';

/**
 * Echoes the app's X-Request-Id back and puts it on every log line, so a
 * row on the phone and a line on this server are the same string.
 */
const requestId: RequestHandler = (req, res, next) => {
  const id =
    req.header('X-Request-Id') || `srv-${randomUUID()}`;
  req.requestId = id;
  res.setHeader('X-Request-Id', id);

  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(
      `${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(0)}ms [${id}]`,
    );
  });

  next();
};

export default requestId;
