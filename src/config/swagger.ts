import swaggerJsdoc from 'swagger-jsdoc';
import { config } from './config';

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Reminder Alarm & Meeting Management API',
      version: '1.0.0',
      description:
        'Backend for alarm-style reminders, meetings and acknowledgement tracking.',
    },
    servers: [{ url: `${config.apiUrl}/api/v1` }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
  },
  apis: ['./src/modules/**/*.routes.ts'],
});
