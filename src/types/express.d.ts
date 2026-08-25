import 'express';
import type { JwtPayload } from 'jsonwebtoken';

declare global {
  namespace Express {
    interface Request {
      /** Set by the requestId middleware, echoed back as X-Request-Id. */
      requestId?: string;
      /** Set by requireAdmin - the verified JWT payload or api-key marker. */
      adminUser?: JwtPayload | { via: string };
    }
  }
}
