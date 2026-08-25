import type { RequestHandler } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';

interface AdminPayload extends JwtPayload {
  isAdmin?: boolean;
  role?: string;
}

/**
 * GET /logs is admin only. Two accepted credentials:
 *   - a JWT signed with JWT_SECRET whose payload has isAdmin === true
 *     (matches the token shape the ReviewManager backend issues), or
 *   - the static ADMIN_API_KEY as a bearer token, for curl / scripts.
 */
const requireAdmin: RequestHandler = (req, res, next) => {
  const header = req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }

  if (process.env.ADMIN_API_KEY && token === process.env.ADMIN_API_KEY) {
    req.adminUser = { via: 'api-key' };
    next();
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res
      .status(401)
      .json({ error: 'Admin access not configured (set JWT_SECRET or ADMIN_API_KEY)' });
    return;
  }

  try {
    const payload = jwt.verify(token, secret) as AdminPayload;
    if (!(payload.isAdmin === true || payload.role === 'admin')) {
      res.status(403).json({ error: 'Admin only' });
      return;
    }
    req.adminUser = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export default requireAdmin;
