import { syncDatabase } from './models/index.js';
import { seedDatabase } from './seed.js';
import dotenv from 'dotenv';
import { backfillAuditSubjects } from './lib/audit.js';
import { pruneIdempotencyKeys } from './routes/v1/idempotency.routes.js';
import { createApp } from './app.js';

// Load environment variables
dotenv.config();

const app = createApp();
const port = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Start server
const startServer = async () => {
  try {
    await syncDatabase();
    if (NODE_ENV === 'development' || process.env.SEED_ADMIN === 'true') {
      await seedDatabase()
    }
    
    void backfillAuditSubjects();
    void pruneIdempotencyKeys();
    app.listen(port, () => {
      console.log(`
Server started successfully!
Environment: ${NODE_ENV}
Port: ${port}
Time: ${new Date().toISOString()}
----------------------------------------
      `);
    });
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
};

startServer();
