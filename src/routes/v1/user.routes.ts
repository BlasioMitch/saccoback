import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { models } from '../../models/index.js';
import  { AccountStatus } from '../../models/account.js';
import { sendAccountCreationEmail } from '../../lib/mailer.js';
import { bulkHandler } from '../../lib/bulk.js';
import { createUser, findUserByEmail, MAX_AVATAR_LENGTH, toUserResponse, UPDATABLE_USER_FIELDS } from '../../services/users.js';
import { describeError } from '../../services/errors.js';

const router = Router();

// Get all users
router.get('/', async (req, res) => {
  const { userId } = req.query;
  try {
  if (userId) {
    const user = await models.User.findByPk(userId as string);
    if (!user || user.is_deleted) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.status(200).json(toUserResponse(user));
  }
    const users = await models.User.findAll({where: {is_deleted: false}});
    return users
      ? res.status(200).json(users.map(toUserResponse))
      : res.status(404).json({ error: 'No users found' });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get one user profile
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    const user = await models.User.findByPk(id);
    if (!user || user.is_deleted) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.status(200).json(toUserResponse(user));
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create user
router.post('/', async (req, res) => {
  try {
    const newUser = await createUser(req.body);

    // Send welcome email
    try {
      await sendAccountCreationEmail({
        email: 'blaminsi@gmail.com',
        name: newUser.getFullName(),
        accountId: newUser.id
      });
    } catch (emailError) {
      console.error('Error sending welcome email:', emailError);
      // Don't fail the request if email fails
    }

    res.status(201).json(toUserResponse(newUser));
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

// Bulk import (CSV): one user per row, no welcome emails
router.post('/bulk', bulkHandler(async (row, transaction) => {
  const user = await createUser(row, { transaction });
  return user.id;
}));

// Update user
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const user = await models.User.findByPk(id);
    if (!user || user.is_deleted) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Only profile, avatar, role and status are editable here (never password or flags)
    const changes = Object.fromEntries(
      UPDATABLE_USER_FIELDS.filter(field => req.body[field] !== undefined).map(field => [field, req.body[field]])
    );
    if (typeof changes.avatar === 'string' && changes.avatar.length > MAX_AVATAR_LENGTH) {
      return res.status(400).json({ error: 'Avatar image is too large' });
    }
    if (changes.email) {
      const existing = await findUserByEmail(String(changes.email));
      if (existing && existing.id !== user.id) {
        return res.status(409).json({ error: `A user with email ${changes.email} already exists` });
      }
    }

    await user.update(changes);
    res.status(200).json(toUserResponse(user));
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

// Delete user
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const user = await models.User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    // this is a hard delete
    // await user.destroy();
    // Delete softly
    await user.update({
      is_deleted: true,
      deleted_at: new Date(),
    });
    // soft Delete  account associated with the user
    const account = await models.Account.findOne({ where: { userId: id } });
    await account?.update({
      is_deleted: true,
      status: AccountStatus.CLOSED,
      deleted_at: new Date(),
    });
    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;