import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 5000;

// ─── Middleware ────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());

// ─── Health Check Route ────────────────────────────────
app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    message: 'CipherChat server is running',
  });
});

// ─── Start Server ──────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});