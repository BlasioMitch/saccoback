import swaggerJsDoc from 'swagger-jsdoc';

const swaggerOptions = {
  swaggerDefinition: {
    openapi: '3.0.0',
    info: {
      title: 'Graph API',
      version: '1.0.0',
      description: 'API documentation for Graph',
    },
    servers: [
      {
        url: process.env.API_BASE_URL || 'http://localhost:3001/api',
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer', // Use 'bearer' for JWT tokens 
            bearerFormat: 'JWT',
        },
      },
    },
    security: [
      {
        BearerAuth: [],
      },
    ],
  },
  apis: ['./src/routes/v1/*.ts'], // Path to the API docs
};

export const swaggerSpec = swaggerJsDoc(swaggerOptions);