import express from 'express';
import cors, {CorsOptions} from 'cors';
import v1Routes from './routes/v1/index.js';
import { authenticateToken } from './lib/authenticateToken.js';
import { auditMiddleware } from './lib/audit.js';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './lib/swagger.js';

// The Express app without starting it: server.ts boots it, the API tests drive it with supertest
export function createApp() {
  const app = express();

  // Request logging middleware
  const requestLogger = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const timestamp = new Date().toISOString();
    const method = req.method;
    const url = req.url;
    const body = req.body && Object.keys(req.body).length > 0 ? JSON.stringify(req.body, null, 2) : 'No body';
  
    console.log(`
[${timestamp}] ${method} ${url}
----------------------------------------
`);
    // Body: ${body}
  
    next();
  };

  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:5173', // direct from frontend
    'http://localhost:4000', // direct from GraphQL server
    'https://sacco-graphql-server.onrender.com', // direct from GraphQL production server
  ];

  // CORS configuration
  const corsOptions: CorsOptions = {
    origin: (origin, callback) =>{ // Allow your frontend URL
    // Allow requests from tools or browsers that omit origin (like curl or mobile apps)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      console.error(`CORS error: ${origin} not allowed`);
      return callback(new Error('Not allowed by CORS'));
    }
    },
    // origin: '*', // Allow all origins for development
    methods: ['GET', 'POST', 'PUT', 'DELETE','PATCH'],
    allowedHeaders: ['Content-Type'],
    credentials: true, // Allow cookies and authentication headers
  };

  // Middleware
  app.use(cors(corsOptions));
  app.use(express.json({ limit: '2mb' })); // bulk CSV imports and avatar images
  if (process.env.NODE_ENV !== 'test') app.use(requestLogger); // Add request logging middleware
  app.use(cookieParser()); // Parse cookies
  app.use(authenticateToken); // Add authentication middleware globally
  app.use(auditMiddleware); // Audit trail: every successful change, with the gateway-forwarded actor

  // Routes
  app.use('/api', v1Routes);

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/debug/users', (req, res) => {
    res.json({ status: 'alright', headers: req.headers });
  });

  // Swagger documentation
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  // Error handling middleware
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something broke!' });
  });

  return app;
}
