import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import connectDB from './config/database';

dotenv.config();

connectDB();

const app: Application = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    message: 'CipherChat server is running',
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});