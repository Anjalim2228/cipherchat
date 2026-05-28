import { Router } from 'express';
import { register, login } from '../controllers/authController';
import { protect, AuthRequest } from '../middleware/authMiddleware';
import { Response } from 'express';

const router = Router();

router.post('/register', register);
router.post('/login', login);

// Protected route - only logged in users can access
router.get('/me', protect, (req: AuthRequest, res: Response) => {
  res.status(200).json({
    user: req.user
  });
});

export default router;