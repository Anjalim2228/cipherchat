import { Router } from 'express';
import { getMessages, getUsers } from '../controllers/messageController';
import { protect } from '../middleware/authMiddleware';

const router = Router();

router.get('/users', protect, getUsers);
router.get('/:userId', protect, getMessages);

export default router;