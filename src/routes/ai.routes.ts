import { Router } from 'express';
import { chatWithGekko } from '../controllers/ai.controller';
import { requireAuth } from '../middlewares/auth.middleware';

const router = Router();

// Protected AI Chat endpoint (Only authenticated users)
router.post('/chat', requireAuth, chatWithGekko);

export default router;
