# SaccoBack

Backend to the SaccoApp, a financial management application designed to handle user accounts, loans, transactions, and more. This backend is built using **Node.js**, **Express**, and **Sequelize** with **PostgreSQL** as the database.

---

## Features

- User authentication and authorization using JWT.
- CRUD operations for users, accounts, loans, and transactions.
- Loan management with summaries for monthly payments, total interest, and remaining balance.
- Transaction management for deposits, withdrawals, and loan payments.
- Middleware for request logging and CORS configuration.
- Database seeding for initial admin and default users.

---

## Technologies Used

- **Node.js**: JavaScript runtime for building scalable server-side applications.
- **Express**: Web framework for building RESTful APIs.
- **Sequelize**: ORM for managing PostgreSQL database interactions.
- **PostgreSQL**: Relational database for storing application data.
- **dotenv**: For managing environment variables.
- **cors**: Middleware for handling Cross-Origin Resource Sharing.

---

## Project Structure

```
.
├── .gitignore
├── LICENSE
├── nodemon.json
├── package.json
├── README.md
├── tsconfig.json
├── src/
│   ├── seed.ts
│   ├── server.ts
│   ├── lib/
│   │   ├── env.ts
│   │   ├── sequelize.ts
│   │   └── utils.ts
│   ├── migrations/
│   ├── models/
│   │   ├── account.ts
│   │   ├── associations.ts
│   │   ├── base.ts
│   │   ├── index.ts
│   │   ├── loan.ts
│   │   ├── loanSummary.ts
│   │   ├── payment.ts
│   │   ├── transaction.ts
│   │   └── user.ts
│   ├── requests/
│   ├── routes/
│   │   └── v1/
│   │       ├── account.routes.ts
│   │       ├── auth.routes.ts
│   │       ├── loan.routes.ts
│   │       ├── transaction.routes.ts
│   │       └── user.routes.ts
```

---

## Setup and Installation

### Prerequisites

- **Node.js** (v18 or higher)
- **PostgreSQL** (v12 or higher)
- **npm** (v8 or higher)

### Steps

1. Clone the repository:
   ```bash
   git clone https://github.com/BlasioMitch/saccoback.git
   cd saccoback
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   - Copy `.env.example` to `.env`:
     ```bash
     cp src/.env.example src/.env
     ```
   - Update the `.env` file with your database connection details and other configurations.

4. Run database migrations:
   ```bash
   npx sequelize-cli db:migrate
   ```

5. Seed the database (optional):
   ```bash
   npm run db:seed
   ```

6. Start the development server:
   ```bash
   npm run dev
   ```

---

## Database

### Models and Relationships

1. **User**
   - Attributes: `id`, `first_name`, `last_name`, `email`, `password`, `role`, `status`, `contact`, `gender`, `dob`, `hasAccount`.

2. **Account**
   - Attributes: `id`, `userId`, `accountNumber`, `balance`, `status`, `paidMembership`, `hasLoan`.

3. **Loan**
   - Attributes: `id`, `accountId`, `amount`, `interestRate`, `term`, `status`, `startDate`, `endDate`.

4. **LoanSummary**
   - Attributes: `id`, `loanId`, `monthlyPayment`, `totalInterest`, `remainingBalance`.

5. **Transaction**
   - Attributes: `id`, `accountId`, `type`, `amount`, `status`, `loanId`.

---

## API Documentation

### Users
- `GET /api/users` - Get all users.
- `GET /api/users/:id` - Get a user by ID.
- `POST /api/users` - Create a new user.
- `PATCH /api/users/:id` - Update a user.
- `DELETE /api/users/:id` - Delete a user.

### Accounts
- `GET /api/accounts` - Get all accounts.
- `POST /api/accounts` - Create a new account.
- `PATCH /api/accounts/:id` - Update an account.
- `DELETE /api/accounts/:id` - Delete an account.

### Loans
- `GET /api/loans` - Get all loans.
- `POST /api/loans` - Create a new loan.
- `PATCH /api/loans/:id` - Update a loan.
- `DELETE /api/loans/:id` - Delete a loan.
- `GET /api/loans/summary` - Get loan summaries.

### Transactions
- `GET /api/transactions` - Get all transactions.
- `POST /api/transactions` - Create a new transaction.
- `PATCH /api/transactions/:id` - Update a transaction.
- `DELETE /api/transactions/:id` - Delete a transaction.

### Authentication
- `POST /api/auth/login` - Login.
- `POST /api/auth/logout` - Logout.

### Health Check
- `GET /health` - Check server health.

---

## Authentication

The backend uses **JWT (JSON Web Tokens)** for authentication. Users must log in to receive a token, which should be included in the `Authorization` header of subsequent requests.

Example:
```bash
Authorization: Bearer <your-token>
```

---

## Error Handling

Errors are handled using middleware. If an error occurs, the server responds with a JSON object containing the error message and a status code.

Example:
```json
{
  "error": "Something broke!"
}
```

---

## Testing

You can test the API using tools like **Postman** or `.rest` files included in the `src/requests` directory. These files contain pre-configured requests for various endpoints.

---

## Deployment

To deploy the backend to a production environment:

1. Build the project:
   ```bash
   npm run build
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Ensure the environment variables are correctly configured for production.

---

## License

This project is licensed under the MIT License.
