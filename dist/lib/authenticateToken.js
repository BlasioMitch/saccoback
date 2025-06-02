import jwt from 'jsonwebtoken';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret';
export const authenticateToken = (req, res, next) => {
    // Skip authentication for login and health routes
    if (req.path === '/api/auth/login' || req.path === '/health') {
        return next();
    }
    const token = req.cookies?.token;
    if (!token)
        return res.status(401).json({ message: 'No token provided' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // Ensure your TypeScript types allow this
        next();
    }
    catch (err) {
        return res.status(403).json({ message: 'Invalid or expired token' });
    }
};
