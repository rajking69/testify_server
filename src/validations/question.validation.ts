import { QuestionType, QuestionDifficulty, QuestionStatus } from '../models/question.model';

export interface CreateQuestionInput {
  questionText: string;
  questionType: QuestionType;
  options?: string[];
  correctAnswer: string;
  correctOptionIndex?: number;
  explanation?: string;
  category?: string;
  subject?: string;
  topic?: string;
  difficulty?: QuestionDifficulty;
  marks?: number;
  tags?: string[];
  status?: QuestionStatus;
}

export function validateQuestionPayload(data: Partial<CreateQuestionInput>): { valid: boolean; message?: string } {
  const { questionText, questionType, options = [], correctAnswer, marks, difficulty, status } = data;

  if (!questionText || typeof questionText !== 'string' || !questionText.trim()) {
    return { valid: false, message: 'Question text is required.' };
  }

  const validTypes: QuestionType[] = ['MCQ', 'TRUE_FALSE', 'SHORT_ANSWER', 'FILL_IN_THE_BLANK'];
  if (!questionType || !validTypes.includes(questionType)) {
    return { valid: false, message: `Question type must be one of: ${validTypes.join(', ')}.` };
  }

  if (marks !== undefined && (typeof marks !== 'number' || marks < 1)) {
    return { valid: false, message: 'Marks must be a positive number greater than or equal to 1.' };
  }

  if (difficulty && !['EASY', 'MEDIUM', 'HARD'].includes(difficulty)) {
    return { valid: false, message: 'Difficulty must be EASY, MEDIUM, or HARD.' };
  }

  if (status && !['DRAFT', 'READY', 'ARCHIVED'].includes(status)) {
    return { valid: false, message: 'Status must be DRAFT, READY, or ARCHIVED.' };
  }

  if (correctAnswer === undefined || correctAnswer === null || String(correctAnswer).trim() === '') {
    return { valid: false, message: 'Correct answer is required.' };
  }

  const trimmedAnswer = String(correctAnswer).trim();

  switch (questionType) {
    case 'MCQ': {
      if (!Array.isArray(options) || options.length !== 4) {
        return { valid: false, message: 'MCQ must have exactly 4 options.' };
      }
      const nonEmpOpts = options.filter((opt) => typeof opt === 'string' && opt.trim().length > 0);
      if (nonEmpOpts.length !== 4) {
        return { valid: false, message: 'All 4 options for MCQ must be non-empty strings.' };
      }
      break;
    }
    case 'TRUE_FALSE': {
      if (!Array.isArray(options) || options.length !== 2) {
        return { valid: false, message: 'TRUE_FALSE must have exactly 2 options ("True", "False").' };
      }
      const lowerCorrect = trimmedAnswer.toLowerCase();
      if (lowerCorrect !== 'true' && lowerCorrect !== 'false' && lowerCorrect !== '0' && lowerCorrect !== '1' && lowerCorrect !== 'a' && lowerCorrect !== 'b') {
        return { valid: false, message: 'TRUE_FALSE correct answer must specify True or False.' };
      }
      break;
    }
    case 'SHORT_ANSWER': {
      break;
    }
    case 'FILL_IN_THE_BLANK': {
      if (!Array.isArray(options) || options.length !== 4) {
        return { valid: false, message: 'FILL_IN_THE_BLANK must have exactly 4 options.' };
      }
      const nonEmpOpts = options.filter((opt) => typeof opt === 'string' && opt.trim().length > 0);
      if (nonEmpOpts.length !== 4) {
        return { valid: false, message: 'All 4 options for FILL_IN_THE_BLANK must be non-empty strings.' };
      }
      break;
    }
  }

  return { valid: true };
}