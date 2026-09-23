import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.middleware';
import {
  startPracticeSession,
  submitPracticeAnswer,
  finishPracticeSession,
  getPracticeHistory,
  getPracticeSessionById,
  getPracticeSubjects,
} from '../controllers/practice.controller';

const router = Router();

// Require login for practice session features
router.use(requireAuth);

router.get('/subjects', getPracticeSubjects);
router.post('/start', startPracticeSession);
router.get('/history', getPracticeHistory);
router.get('/:id', getPracticeSessionById);
router.post('/:id/answer', submitPracticeAnswer);
router.post('/:id/finish', finishPracticeSession);

export default router;
