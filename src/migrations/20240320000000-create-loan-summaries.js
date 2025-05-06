'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // First, create the loan_summaries table
    await queryInterface.createTable('loan_summaries', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      loanId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'loans',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      monthlyPayment: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      totalInterest: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      remainingBalance: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    // Add unique constraint on loanId
    await queryInterface.addConstraint('loan_summaries', {
      fields: ['loanId'],
      type: 'unique',
      name: 'loan_summaries_loanId_unique',
    });

    // Remove columns from loans table
    await queryInterface.removeColumn('loans', 'monthlyPayment');
    await queryInterface.removeColumn('loans', 'totalInterest');
    await queryInterface.removeColumn('loans', 'remainingBalance');
  },

  async down(queryInterface, Sequelize) {
    // Add columns back to loans table
    await queryInterface.addColumn('loans', 'monthlyPayment', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('loans', 'totalInterest', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('loans', 'remainingBalance', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });

    // Drop the loan_summaries table
    await queryInterface.dropTable('loan_summaries');
  },
}; 