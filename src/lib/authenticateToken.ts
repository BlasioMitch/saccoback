import { Request, Response, NextFunction } from 'express';

export type ClientSource = 'WEB' | 'MOBILE' | 'SYSTEM';

// Who is behind a request. The gateway verifies the member's session and forwards it as x-actor-* headers;
// they are only trusted on requests that carry the internal API key.
export interface Actor {
  id: string | null;
  email: string | null;
  role: string | null;
}

export interface ClientInfo {
  source: ClientSource;
  ip: string | null;
  userAgent: string | null;
  // A change made offline and sent later: when it was really made
  queuedAt: Date | null;
  // The web page's origin (passkeys are bound to it)
  origin: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: Actor;
      client?: ClientInfo;
    }
  }
}

export interface AuthenticatedRequest extends Request {
  user?: any;
}

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

const publicRoutes = [
  '/api/auth/login',
  '/health',
  '/api-docs',
];

const header = (req: Request, name: string) => {
  const value = req.headers[name];
  const text = Array.isArray(value) ? value[0] : value;
  return text ? String(text).slice(0, 500) : null;
};

const SOURCES: Record<string, ClientSource> = { web: 'WEB', mobile: 'MOBILE' };

const readActor = (req: Request): Actor => ({
  id: header(req, 'x-actor-id'),
  email: header(req, 'x-actor-email'),
  role: header(req, 'x-actor-role'),
});

const readDate = (value: string | null) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const readClient = (req: Request): ClientInfo => ({
  source: SOURCES[header(req, 'x-client')?.toLowerCase() ?? ''] ?? 'SYSTEM',
  ip: header(req, 'x-client-ip'),
  userAgent: header(req, 'x-client-ua'),
  queuedAt: readDate(header(req, 'x-queued-at')),
  origin: header(req, 'x-client-origin'),
});

export const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const apiKey = req.headers['graph-api-key'] as string | undefined;

  // Public routes need no key; through the gateway they still get the client details for the audit trail
  if (publicRoutes.includes(req.path)) {
    if (apiKey && apiKey === INTERNAL_API_KEY) {
      req.actor = readActor(req);
      req.client = readClient(req);
    }
    return next();
  }

  // Only the GraphQL gateway holds the internal API key
  if (apiKey) {
    if (apiKey === INTERNAL_API_KEY) {
      req.user = { role: 'internal-service', service: 'graphql' };
      req.actor = readActor(req);
      req.client = readClient(req);
      return next();
    }
    console.warn('❌ Invalid API Key provided');
    return res.status(403).json({ message: 'Invalid API key' });
  }

  return res.status(401).json({ message: 'Unauthorized access' });
};
