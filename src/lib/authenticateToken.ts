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
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

const publicRoutes = [
  '/api/auth/login',
  '/api/auth/token-login',
  '/health',
  '/api-docs',
];

export const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // Skip auth for public routes
  if (publicRoutes.includes(req.path)) return next();

// console.log('Incoming graph-api-key header: ', req.headers['graph-api-key']);
  const apiKey = req.headers['graph-api-key'] as string | undefined;

  // ✅ 1. Allow internal service-to-service requests with signed API key (JWT)
  if (apiKey) {
    try {

      if (apiKey === INTERNAL_API_KEY) {
      console.log('Internal service authenticated via API key');
        req.user = { role: 'internal-service', service: 'graphql' };
        return next();
      } else {
        console.warn('❌ Invalid API Key provided');
        return res.status(403).json({ message: 'Invalid API key' });
      }
    } catch (err: any) {
      console.warn('❌ API key verification failed:', err.message);
      return res.status(403).json({ message: 'Invalid or expired API key' });
    }
  }

  // ❌ Neither token nor valid API key present
  return res.status(401).json({ message: 'Unauthorized access' });
};
