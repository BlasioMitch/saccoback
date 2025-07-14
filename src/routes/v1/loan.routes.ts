import { Router, Request, Response } from 'express';
import { models } from '../../models/index.js';
import { calculateMonthlyPayment, calculateTotalInterest, calculateRemainingBalance } from '../../lib/utils.js';
import { LoanStatus } from '../../models/loan.js';
import { sendLoanCreationEmail, sendLoanCompletionEmail } from '../../lib/mailer.js';

const router = Router();

// Get all loans
// Get all loans /loans?accountId=1
router.get('/', async (req, res) => {
  const { accountId } = req.query;
  try {
  if (accountId) {
      const loans = await models.Loan.findAll({
        where: { accountId: accountId as string },
      });
      return res.status(200).json(loans);
  }
    const loans = await models.Loan.findAll();
    
    return res.status(200).json(loans);
  } catch (error) {
    console.error('Get loan error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a lona summary
router.get('/:id/summary', async (req, res) => {
  const { id } = req.params;
  try {
    if (!id) {
      return res.status(400).json({ error: 'Loan ID is required' });
    }
    const loanSummary = await models.LoanSummary.findOne({
      where: { loanId: id as string },
    });
    if (!loanSummary) {
      return res.status(404).json({ error: 'Loan summary not found' });
    }
    res.status(200).json(loanSummary);
  } catch (error) {
    console.error('Get loan summary error:', error);
    if (error instanceof Error && error.name === 'SequelizeDatabaseError') {
      return res.status(400).json({ error: 'Database error' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});
// Create loan
router.post('/', async (req, res) => {
  try {
    const { accountId, amount, interestRate, term, status, startDate, endDate } = req.body;

    // Validate input
    if (!accountId || !amount || !interestRate || !term || !status || !startDate || !endDate) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if account exists
    const account = await models.Account.findByPk(accountId, {
      include: [
        {
          model: models.User,
          as: 'owner',
          attributes: ['id', 'first_name', 'last_name', 'other_name', 'email'],
        },
      ],
    });
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Create new loan
    const newLoan = await models.Loan.create({
      accountId,
      amount,
      interestRate,
      term,
      status,
      startDate,
      endDate,
    });

    // Update Account hasLoan to true
    await models.Account.update(
      { hasLoan: true },
      { where: { id: accountId } }
    );

    // Calculate Loan Summary
    const monthlyPayment = calculateMonthlyPayment(amount, interestRate, term);
    const totalInterest = calculateTotalInterest(amount, interestRate, term);
    const remainingBalance = calculateRemainingBalance(amount*(1+interestRate/100), 0);

    await models.LoanSummary.create({
      loanId: newLoan.id,
      monthlyPayment,
      totalInterest,
      remainingBalance,
    });

    // Send loan creation email
    try {
      const owner = (account as any).owner;
      if (owner && owner.email) {
        await sendLoanCreationEmail({
          // email: owner.email,
          email: 'blaminsi@gmail.com',
          name: `${owner.first_name} ${owner.last_name}`,
          loanId: newLoan.id,
          accountNumber: account.accountNumber,
          loanAmount: amount,
          interestRate: interestRate,
          term: term,
          monthlyPayment: monthlyPayment,
          totalInterest: totalInterest,
          totalAmount: Number(amount) + Number(totalInterest),
        });
      }
    } catch (emailError) {
      console.error('Error sending loan creation email:', emailError);
      // Don't fail the request if email fails
    }

    // Return created loan with account details and loan summary
    const loan = await models.Loan.findByPk(newLoan.id, {
      include: [
        {
          model: models.Account,
          as: 'account',
          attributes: ['id', 'accountNumber'],
          include: [
            {
              model: models.User,
              as: 'owner',
              attributes: ['first_name', 'last_name', 'other_name'],
            },
          ],
        },
        {
          model: models.LoanSummary,
          as: 'summary',
          attributes: ['monthlyPayment', 'totalInterest', 'remainingBalance'],
        },
      ],
    });

    res.status(201).json(loan);
  } catch (error) {
    console.error('Create loan error:', error);
    if (error instanceof Error) {
      if (error.name === 'SequelizeValidationError') {
        const validationError = error as any;
        return res.status(400).json({ error: 'Validation error', details: validationError.errors });
      }
      if (error.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ error: 'Loan already exists' });
      }
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update loan
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { accountId, amount, interestRate, term, status, startDate, endDate } = req.body;

    // Find loan by ID
    const loan = await models.Loan.findByPk(id, {
      include: [
        {
          model: models.Account,
          as: 'account',
          attributes: ['id', 'accountNumber'],
          include: [
            {
              model: models.User,
              as: 'owner',
              attributes: ['id', 'first_name', 'last_name', 'other_name', 'email'],
            },
          ],
        },
        {
          model: models.LoanSummary,
          as: 'summary',
          attributes: ['monthlyPayment', 'totalInterest', 'remainingBalance'],
        },
      ],
    });
    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    // If status is completed, update the account to false for hasLoan
    if (status === LoanStatus.PAID) {
      await models.Account.update(
        { hasLoan: false },
        { where: { id: loan.accountId } }
      );

      // Send loan completion email
      try {
        const owner = (loan as any).account?.owner;
        if (owner && owner.email) {
          // Get all loan payment transactions
          const transactions = await models.Transaction.findAll({
            where: {
              loanId: id,
              type: 'LOAN_PAYMENT',
              status: 'COMPLETED'
            },
            order: [['createdAt', 'ASC']]
          });

          await sendLoanCompletionEmail({
            // email: owner.email,
            email:'blaminsi@gmail.com',
            name: `${owner.first_name} ${owner.last_name}`,
            loanId: loan.id,
            accountNumber: (loan as any).account.accountNumber,
            loanAmount: loan.amount,
            interestRate: loan.interestRate,
            term: loan.term,
            totalInterest: loan.summary?.totalInterest || 0,
            totalAmount: Number(loan.amount) + Number(loan.summary?.totalInterest || 0),
            completionDate: new Date().toLocaleDateString(),
            transactions: transactions.map(t => ({
              date: new Date(t.createdAt).toLocaleDateString(),
              amount: t.amount,
              type: 'Loan Payment'
            }))
          });
        }
      } catch (emailError) {
        console.error('Error sending loan completion email:', emailError);
        // Don't fail the request if email fails
      }
    }

    // Update loan
    await loan.update({
      accountId,
      amount,
      interestRate,
      term,
      status,
      startDate,
      endDate,
    });

    // Update Loan Summary
    const loanSummary = await models.LoanSummary.findOne({
      where: { loanId: id },
    });
    if (loanSummary) {
      const monthlyPayment = calculateMonthlyPayment(amount, interestRate, term);
      const totalInterest = calculateTotalInterest(amount, interestRate, term);
      const remainingBalance = calculateRemainingBalance(amount, 0);
      await loanSummary.update({
        monthlyPayment,
        totalInterest,
        remainingBalance,
      });
    } else {
      const monthlyPayment = calculateMonthlyPayment(amount, interestRate, term);
      const totalInterest = calculateTotalInterest(amount, interestRate, term);
      const remainingBalance = calculateRemainingBalance(amount*(1+interestRate/100), 0);
      await models.LoanSummary.create({
        loanId: id,
        monthlyPayment,
        totalInterest,
        remainingBalance,
      });
    }

    // Return updated loan
    const updatedLoan = await models.Loan.findByPk(id);
    
    res.status(200).json(updatedLoan);
  } catch (error) {
    console.error('Update loan error:', error);
    if (error instanceof Error && error.name === 'SequelizeValidationError') {
      const validationError = error as any;
      return res.status(400).json({ error: 'Validation error', details: validationError.errors });
    }
    if (error instanceof Error && error.name === 'SequelizeDatabaseError') {
      return res.status(400).json({ error: 'Database error' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete loan
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate input
    if (!id) {
      return res.status(400).json({ error: 'Loan ID is required' });
    }

    // Find loan by ID
    const loan = await models.Loan.findByPk(id);
    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    // Update the account to false for hasLoan
    await models.Account.update(
      { hasLoan: false },
      { where: { id: loan.accountId } }
    );
    // Delete loan summary
    await models.LoanSummary.destroy({
      where: { loanId: id },
    });

    // Delete loan
    await loan.destroy();
    res.status(200).json({ message: 'Loan deleted successfully' });
  } catch (error) {
    console.error('Delete loan error:', error);
    if (error instanceof Error && error.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(400).json({ error: 'Cannot delete loan with existing dependencies' });
    }
    if (error instanceof Error && error.name === 'SequelizeDatabaseError') {
      return res.status(400).json({ error: 'Database error' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/summary/', async (req, res) => {
  const summary = await models.LoanSummary.findAll( {
    include: [
      {
        model: models.Loan,
        as: 'loan',
      },
    ],
  });
  res.status(200).json(summary);
});
export default router;
