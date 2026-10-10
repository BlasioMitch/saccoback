import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { models } from '../../models/index.js';
import  { AccountStatus } from '../../models/account.js';
import { sendAccountCreationEmail } from '../../lib/mailer.js';
import { bulkHandler } from '../../lib/bulk.js';
import { changeEmail, changePassword, createUser, findUserByEmail, MAX_AVATAR_LENGTH, toUserResponse, UPDATABLE_USER_FIELDS } from '../../services/users.js';
import { notifyUser } from '../../lib/notifications.js';
import { NotificationCategory, NotificationTarget } from '../../models/notification.js';
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
    const flag = ['twoFactorEnabled', 'notifyTransactions', 'notifyUpdates', 'notifyLoanDecisions'].find(
      field => changes[field] !== undefined && typeof changes[field] !== 'boolean'
    );
    if (flag) {
      return res.status(400).json({ error: `${flag} must be true or false` });
    }
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

// Member security changes; each leaves a notification so an unexpected change is noticed
router.post('/:id/password', async (req, res) => {
  try {
    const user = await changePassword(req.params.id, req.body);
    await notifyUser(user.id, NotificationCategory.UPDATE, {
      title: 'Password changed',
      body: 'Your password was changed. If this was not you, contact the SACCO office.',
      targetType: NotificationTarget.SECURITY,
    });
    res.status(200).json({ success: true });
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

router.post('/:id/email', async (req, res) => {
  try {
    const previous = (await models.User.findByPk(req.params.id))?.email;
    const user = await changeEmail(req.params.id, req.body);
    await notifyUser(user.id, NotificationCategory.UPDATE, {
      title: 'Email changed',
      body: `Your sign-in email changed${previous ? ` from ${previous}` : ''} to ${user.email}.`,
      targetType: NotificationTarget.PROFILE,
    });
    res.status(200).json(toUserResponse(user));
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

// A member's notifications, newest first, with the unread count. ?unread=true lists only unread ones
// (the app clears a notification from its list once it has been read; read ones are kept as history)
router.get('/:id/notifications', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const where = { userId: req.params.id };
    const unreadOnly = req.query.unread === 'true';
    const [items, unreadCount] = await Promise.all([
      models.Notification.findAll({ where: unreadOnly ? { ...where, readAt: null } : where, order: [['createdAt', 'DESC']], limit }),
      models.Notification.count({ where: { ...where, readAt: null } }),
    ]);
    res.status(200).json({ items, unreadCount });
  } catch (error) {
    const { status, message } = describeError(error);
    res.status(status).json({ error: message });
  }
});

// Marks the given notifications read, or all of them when no ids are sent
router.post('/:id/notifications/read', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : null;
    const [updated] = await models.Notification.update(
      { readAt: new Date() },
      { where: { userId: req.params.id, readAt: null, ...(ids && { id: ids }) } }
    );
    res.status(200).json({ updated });
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