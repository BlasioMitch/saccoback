import { models, syncDatabase } from './models/index.js';
import bcrypt from 'bcryptjs';
import { UserRole, UserStatus, Gender } from './models/user.js';
import { AccountType, AccountStatus } from './models/account.js';
import { TransactionType, TransactionStatus } from './models/transaction.js';
import { LoanStatus } from './models/loan.js';
import { PaymentStatus } from './models/payment.js';

const seedDatabase = async () => {
  try {
    console.log('Starting database seeding...');
    
    // Sync database schema first
    console.log('Syncing database schema...');
    await syncDatabase();
    console.log('Database schema synced successfully');

    // Clear existing data
    console.log('Clearing existing data...');
    await models.Payment.destroy({ where: {} });
    await models.Transaction.destroy({ where: {} });
    await models.Loan.destroy({ where: {} });
    await models.Account.destroy({ where: {} });
    await models.User.destroy({ where: {} });
    console.log('Existing data cleared successfully');

    // Create users
    console.log('Creating users...');
    const adminPassword = await bcrypt.hash('admin123', 10);
    const userPassword = await bcrypt.hash('user123', 10);

    const admin = await models.User.create({
      first_name: 'John',
      last_name: 'Doe',
      other_name: 'Admin',
      email: 'admin@example.com',
      password: adminPassword,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      contact: '1234567890',
      gender: Gender.MALE,
      dob: new Date('1990-01-01'),
      joinDate: new Date(),
    });
    console.log('Admin user created:', admin.id);

    const user = await models.User.create({
      first_name: 'Jane',
      last_name: 'Smith',
      other_name: undefined,
      email: 'user@example.com',
      password: userPassword,
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
      contact: '0987654321',
      gender: Gender.FEMALE,
      dob: new Date('1995-05-05'),
      joinDate: new Date(),
    });
    console.log('Regular user created:', user.id);
    console.log('Users created successfully');

    // Create accounts
    console.log('Creating accounts...');
    const adminAccount = await models.Account.create({
      userId: admin.id,
      userName: `${admin.first_name} ${admin.last_name}`,
      type: AccountType.SAVINGS,
      balance: 10000.00,
      status: AccountStatus.ACTIVE,
    });
    console.log('Admin account created:', adminAccount.id);

    const userAccount = await models.Account.create({
      userId: user.id,
      userName: `${user.first_name} ${user.last_name}`,
      type: AccountType.SAVINGS,
      balance: 5000.00,
      status: AccountStatus.ACTIVE,
    });
    console.log('User account created:', userAccount.id);
    console.log('Accounts created successfully');

    // Create transactions
    console.log('Creating transactions...');
    const adminTransaction = await models.Transaction.create({
      accountId: adminAccount.id,
      accountName: adminAccount.userName,
      type: TransactionType.SAVINGS_DEPOSIT,
      amount: 10000.00,
      status: TransactionStatus.COMPLETED,
      reference: 'Initial deposit',
    });
    console.log('Admin transaction created:', adminTransaction.id);

    const userTransaction = await models.Transaction.create({
      accountId: userAccount.id,
      accountName: userAccount.userName,
      type: TransactionType.SAVINGS_DEPOSIT,
      amount: 5000.00,
      status: TransactionStatus.COMPLETED,
      reference: 'Initial deposit',
    });
    console.log('User transaction created:', userTransaction.id);
    console.log('Transactions created successfully');

    // Create a loan
    console.log('Creating loan...');
    const loan = await models.Loan.create({
      borrowerId: user.id,
      amount: 2000.00,
      interestRate: 5.00,
      term: 12,
      status: LoanStatus.ACTIVE,
      monthlyPayment: 175.00,
      totalInterest: 100.00,
      remainingBalance: 2000.00,
      startDate: new Date(),
      endDate: new Date(new Date().setMonth(new Date().getMonth() + 12)),
    });
    console.log('Loan created:', loan.id);
    console.log('Loan created successfully');

    // Create a payment
    console.log('Creating payment...');
    const payment = await models.Payment.create({
      loanId: loan.id,
      payerId: user.id,
      amount: 175.00,
      status: PaymentStatus.COMPLETED,
      date: new Date(),
    });
    console.log('Payment created:', payment.id);
    console.log('Payment created successfully');

    console.log('Database seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error details:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Stack trace:', error.stack);
      if ('parent' in error) {
        console.error('Database error:', error.parent);
      }
    }
    process.exit(1);
  }
};

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

seedDatabase(); 