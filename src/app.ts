import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';
import { errorHandler } from './middleware/error-handler';
import authRoutes from './modules/auth/auth.routes';
import userRoutes from './modules/users/user.routes';
import eventRoutes from './modules/events/event.routes';
import reminderRoutes from './modules/reminders/reminder.routes';
import deviceRoutes from './modules/devices/device.routes';
import reportRoutes from './modules/reports/report.routes';

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.',
  // Tests drive many requests from one IP; rate limiting would make them flaky.
  skip: () => process.env.NODE_ENV === 'test',
});
app.use('/api', limiter);

// Login is the highest-value brute-force target, so it gets a tighter budget.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Please try again later.',
  skip: () => process.env.NODE_ENV === 'test',
});

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'success', data: { uptime: process.uptime() } });
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  swaggerOptions: { persistAuthorization: true },
}));

app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/events', eventRoutes);
app.use('/api/v1/reminders', reminderRoutes);
app.use('/api/v1/devices', deviceRoutes);
app.use('/api/v1/reports', reportRoutes);

app.use((_req, res) => {
  res.status(404).json({ status: 'error', statusCode: 404, message: 'Route not found' });
});

app.use(errorHandler);

export default app;
