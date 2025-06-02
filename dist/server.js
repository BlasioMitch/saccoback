import express from 'express';
import cors from 'cors';
import { syncDatabase } from './models/index.js';
import { seedDatabase } from './seed.js';
import dotenv from 'dotenv';
import v1Routes from './routes/v1/index.js';
import { authenticateToken } from './lib/authenticateToken.js';
import cookieParser from 'cookie-parser';
// Load environment variables
dotenv.config();
const app = express();
const port = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';
// Request logging middleware
const requestLogger = (req, res, next) => {
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
    'http://localhost:3000',
    'http://localhost:3002',
    'http://localhost:5173'
];
// CORS configuration
const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests from tools or browsers that omit origin (like curl or mobile apps)
        if (!origin)
            return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        else {
            console.error(`CORS error: ${origin} not allowed`);
            return callback(new Error('Not allowed by CORS'));
        }
    },
    // origin: '*', // Allow all origins for development
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type'],
    credentials: true, // Allow cookies and authentication headers
};
// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(requestLogger); // Add request logging middleware
app.use(cookieParser()); // Parse cookies
app.use(authenticateToken); // Add authentication middleware globally
// Routes
app.use('/api', v1Routes);
// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});
// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something broke!' });
});
// Start server
const startServer = async () => {
    try {
        await syncDatabase();
        if (NODE_ENV === 'development' || process.env.SEED_ADMIN === 'true') {
            await seedDatabase();
        }
        app.listen(port, () => {
            console.log(`
Server started successfully!
Environment: ${NODE_ENV}
Port: ${port}
Time: ${new Date().toISOString()}
----------------------------------------
      `);
        });
    }
    catch (error) {
        console.error('Error starting server:', error);
        process.exit(1);
    }
};
startServer();
