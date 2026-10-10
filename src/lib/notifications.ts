import type { Transaction as DbTransaction } from 'sequelize';
import { Op } from 'sequelize';
import { models } from '../models/index.js';
import { NotificationCategory, NotificationTarget } from '../models/notification.js';
import { TransactionStatus, TransactionType } from '../models/transaction.js';
import { UserRole, UserStatus } from '../models/user.js';

interface NotificationContent {
  title: string;
  body: string;
  targetType?: NotificationTarget;
  targetId?: string;
}

// Member categories follow one of the member's settings (mobile app > Settings > Notifications);
// a category without a setting (staff requests) is always delivered
const SETTING_BY_CATEGORY: Partial<Record<NotificationCategory, 'notifyTransactions' | 'notifyLoanDecisions' | 'notifyUpdates'>> = {
  [NotificationCategory.TRANSACTION]: 'notifyTransactions',
  [NotificationCategory.LOAN_DECISION]: 'notifyLoanDecisions',
  [NotificationCategory.UPDATE]: 'notifyUpdates',
};

export const formatUGX = (amount: number | string) => `UGX ${Math.round(Number(amount) || 0).toLocaleString('en-US')}`;

// Records a notification for a member, unless they turned that kind off. Runs in the caller's DB transaction
// so a rolled-back change never leaves a notification behind.
export async function notifyUser(
  userId: string | null | undefined,
  category: NotificationCategory,
  content: NotificationContent,
  transaction?: DbTransaction,
) {
  if (!userId) return null;
  const setting = SETTING_BY_CATEGORY[category];
  const user = await models.User.findByPk(userId, { transaction, attributes: ['id', ...(setting ? [setting] : [])] });
  if (!user || (setting && (user as any)[setting] === false)) return null;
  return models.Notification.create({
    userId,
    category,
    title: content.title,
    body: content.body,
    targetType: content.targetType ?? null,
    targetId: content.targetId ?? null,
  }, { transaction });
}

// Every active ADMIN and MANAGER gets the same notification (e.g. a password reset request to handle)
export async function notifyStaff(content: NotificationContent, transaction?: DbTransaction) {
  const staff = await models.User.findAll({
    where: { role: [UserRole.ADMIN, UserRole.MANAGER], status: UserStatus.ACTIVE, is_deleted: { [Op.not]: true } },
    attributes: ['id'],
    transaction,
  });
  if (!staff.length) return [];
  return models.Notification.bulkCreate(staff.map(member => ({
    userId: member.id,
    category: NotificationCategory.STAFF_REQUEST,
    title: content.title,
    body: content.body,
    targetType: content.targetType ?? null,
    targetId: content.targetId ?? null,
  })), { transaction });
}

// Once one staff member has handled a request, it no longer waits in everyone else's bell
export async function clearStaffNotifications(targetType: NotificationTarget, targetId: string, transaction?: DbTransaction) {
  await models.Notification.update(
    { readAt: new Date() },
    { where: { category: NotificationCategory.STAFF_REQUEST, targetType, targetId, readAt: null }, transaction },
  );
}

export async function notifyAccountOwner(
  accountId: string,
  category: NotificationCategory,
  content: NotificationContent,
  transaction?: DbTransaction,
) {
  const account = await models.Account.findByPk(accountId, { transaction, attributes: ['id', 'userId'] });
  return notifyUser(account?.userId, category, content, transaction);
}

const TRANSACTION_TITLES: Record<TransactionType, string> = {
  [TransactionType.SAVINGS_DEPOSIT]: 'Savings deposit',
  [TransactionType.ACCOUNT_WITHDRAW]: 'Withdrawal from savings',
  [TransactionType.CLOSURE_WITHDRAW]: 'Account closure payout',
  [TransactionType.LOAN_PAYMENT]: 'Loan repayment',
  [TransactionType.MEMBERSHIP_FEE]: 'Membership fee',
};

const STATUS_WORDS: Record<TransactionStatus, string> = {
  [TransactionStatus.COMPLETED]: 'completed',
  [TransactionStatus.PENDING]: 'is pending',
  [TransactionStatus.FAILED]: 'failed',
};

// "Savings deposit of UGX 50,000 completed." — shown in the app's notification list
export function notifyTransaction(
  record: { id: string; accountId: string; type: TransactionType; amount: number | string; status: TransactionStatus },
  transaction?: DbTransaction,
  { statusChanged = false }: { statusChanged?: boolean } = {},
) {
  const title = TRANSACTION_TITLES[record.type] ?? 'Transaction';
  const verb = STATUS_WORDS[record.status] ?? record.status.toLowerCase();
  return notifyAccountOwner(record.accountId, NotificationCategory.TRANSACTION, {
    title: statusChanged ? `${title} ${verb}` : title,
    body: `${title} of ${formatUGX(record.amount)} ${verb}.`,
    targetType: NotificationTarget.TRANSACTION,
    targetId: record.id,
  }, transaction);
}
