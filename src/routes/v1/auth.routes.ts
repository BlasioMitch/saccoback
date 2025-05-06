import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { models } from '../../models/index.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'my-secret-key';

interface SessionRequest extends Request {
  session?: {
    destroy: (callback: (err?: any) => void) => void;
  };
}

// Login route
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user by email
    const user = await models.User.findOne({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Update last login
    await user.update({ lastLogin: new Date() });

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Return user data and token
    res.json({
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        otherName: user.other_name,
        fullName: user.getFullName(),
        fullNameWithOtherName: user.getFullName(),
        email: user.email,
        role: user.role,
        status: user.status,
        contact: user.contact,
        gender: user.gender,
        dob: user.dob,
        joinDate: user.joinDate,
        lastLogin: user.lastLogin
      },
      token,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout
router.post('/logout', (req: SessionRequest, res: Response) => {
  if (!req.session) {
    return res.status(400).json({ error: 'Session not found' });
  }
  req.session.destroy((err: Error | null) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Internal server error, Logout failed' });
    }
    res.clearCookie('token');
    res.json({ message: 'Logged out successfully' });
  });
});

export default router; 