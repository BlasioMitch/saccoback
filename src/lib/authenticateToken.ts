import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

export interface AuthenticatedRequest extends Request {
  user?: any;
}

interface JwtPayload {
  service?: string;
  exp: number;
  [key: string]: any;
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret';
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'your-internal-api-key';

const publicRoutes = [
  '/api/auth/login',
  '/api/auth/token-login',
  '/health',
  '/api-docs',
];

export const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // Skip auth for public routes
  if (publicRoutes.includes(req.path)) return next();

  const apiKey = req.headers['graph-api-key'] as string | undefined;
  const token = req.cookies?.token;

  // ✅ 1. Allow internal service-to-service requests with signed API key (JWT)
  if (apiKey) {
    try {
      const payload = jwt.verify(apiKey, INTERNAL_API_SECRET) as JwtPayload;

      if (payload?.service === 'graphql') {
        req.user = { role: 'internal-service', service: payload.service };
        return next();
      } else {
        console.warn('❌ Invalid service field in API key payload');
        return res.status(403).json({ message: 'Invalid API key' });
      }
    } catch (err: any) {
      console.warn('❌ API key verification failed:', err.message);
      return res.status(403).json({ message: 'Invalid or expired API key' });
    }
  }

  // ✅ 2. Allow browser requests with JWT in cookie
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      return next();
    } catch (err: any) {
      console.warn('❌ Token verification failed:', err.message);
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
  }

  // ❌ Neither token nor valid API key present
  return res.status(401).json({ message: 'Unauthorized access' });
};
