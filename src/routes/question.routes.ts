import { Router } from 'express';
import { requireAuth, requireRole } from '../middlewares/auth.middleware';
import {
  createQuestion,
  getQuestions,
  getQuestionById,
  updateQuestion,
  toggleArchiveQuestion,
  deleteQuestion,
  selectQuestionsForExam,
} from '../controllers/question.controller';

const router = Router();

// Protect all question bank routes for authorized teachers/admins
router.use(requireAuth);
router.use(requireRole('teacher', 'admin'));

router.post('/', createQuestion);
router.get('/', getQuestions);
router.post('/select-for-exam', selectQuestionsForExam);
router.get('/:id', getQuestionById);
router.patch('/:id', updateQuestion);
router.patch('/:id/archive', toggleArchiveQuestion);
router.delete('/:id', deleteQuestion);

export default router;