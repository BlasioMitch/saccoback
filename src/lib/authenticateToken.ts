import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

// Extend the Request interface to include the user property
export interface AuthenticatedRequest extends Request {
  user?: any; // Replace 'any' with a specific type if you know the structure of the decoded token
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret';

export const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // Skip authentication for login and health routes
  if (req.path === '/api/auth/login' || req.path === '/health') {
    return next();
  }

  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ message: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // Ensure your TypeScript types allow this
    next();
  } catch (err) {
    return res.status(403).json({ message: 'Invalid or expired token' });
  }
};