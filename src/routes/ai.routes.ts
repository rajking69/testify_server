import { Router } from 'express';
import { chatWithGekko, aiChatRateLimiter } from '../controllers/ai.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

router.post('/chat', requireAuth, aiChatRateLimiter, chatWithGekko);

export default router;