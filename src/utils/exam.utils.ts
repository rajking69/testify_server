import { Exam } from '../models/exam.model';
import { ExamSubmission } from '../models/exam-submission.model';
import { IQuestion } from '../models/exam.model';

export interface SanitizedQuestion {
  _id?: string;
  id: string;
  questionText: string;
  options: string[];
  marks: number;
  correctOptionIndex?: number;
  correctAnswer?: string;
  explanation?: string;
}

export interface FormattedExam {
  id: string;
  examId: string;
  title: string;
  description: string;
  category: string;
  subject: string;
  duration: number;
  durationMinutes: number;
  totalMarks: number;
  passMarks: number;
  passMark: number;
  accessType: string;
  price: number;
  teacherId: string;
  teacherName: string;
  teacherEmail?: string;
  isPublished: boolean;
  isUnlocked: boolean;
  enrolledCount: number;
  completedCount: number;
  joinCode?: string;
  accessToken?: string;
  startDateTime?: string;
  endDateTime?: string;
  status: string;
  questions?: SanitizedQuestion[];
  questionsCount: number;
  createdBy?: string;
}

export function sanitizeQuestions(questions: IQuestion[], includeAnswers: boolean = false): SanitizedQuestion[] {
  if (!Array.isArray(questions)) return [];
  
  return questions.map((q) => {
    const sanitized: SanitizedQuestion = {
      _id: (q as any)._id || q.id,
      id: q.id || (q as any)._id?.toString() || '',
      questionText: q.questionText || 'Question text',
      options: q.options || [],
      marks: Number(q.marks) || 1,
    };
    
    if (includeAnswers) {
      sanitized.correctOptionIndex = q.correctOptionIndex;
      sanitized.correctAnswer = q.correctAnswer;
      sanitized.explanation = q.explanation;
    }
    
    return sanitized;
  });
}

export function formatExamResponse(
  exam: any,
  includeQuestions: boolean = true,
  includeAnswers: boolean = false
): FormattedExam {
  const questions = exam.questions || [];
  const sanitizedQuestions = sanitizeQuestions(questions, includeAnswers);
  
  return {
    id: exam._id?.toString() || exam.id,
    examId: exam._id?.toString() || exam.id,
    title: exam.title,
    description: exam.description || '',
    category: exam.category || exam.subject || 'General',
    subject: exam.subject || exam.category || 'General',
    duration: exam.durationMinutes || 30,
    durationMinutes: exam.durationMinutes || 30,
    totalMarks: exam.totalMarks || 100,
    passMarks: exam.passMarks || Math.round((exam.totalMarks || 50) * 0.4),
    passMark: exam.passMarks || Math.round((exam.totalMarks || 50) * 0.4),
    accessType: exam.accessType || 'free',
    price: exam.price || 0,
    teacherId: exam.teacherId,
    teacherName: exam.teacherName || 'Instructor',
    teacherEmail: exam.teacherEmail,
    isPublished: exam.isPublished !== false,
    isUnlocked: exam.accessType === 'free',
    enrolledCount: exam.totalEnrolled || 0,
    completedCount: exam.completedCount || 0,
    joinCode: exam.joinCode,
    accessToken: exam.accessToken,
    startDateTime: exam.startDateTime,
    endDateTime: exam.endDateTime,
    status: exam.status || (exam.isPublished ? 'published' : 'draft'),
    questions: includeQuestions ? sanitizedQuestions : undefined,
    questionsCount: questions.length,
    createdBy: exam.teacherName || 'Instructor',
  };
}

export function formatExamListResponse(
  exams: any[],
  user: any | null = null,
  includeUnlockInfo: boolean = true
): FormattedExam[] {
  return exams.map((exam) => {
    const formatted = formatExamResponse(exam, false, false);
    
    if (includeUnlockInfo && user && user.role === 'student') {
      // This would be computed based on subscription/purchase status
      // Left as-is to preserve existing behavior
    }
    
    return formatted;
  });
}

export function calculateGrade(percentage: number): { grade: 'A+' | 'A' | 'B' | 'C' | 'F'; gradePoint: number } {
  if (percentage >= 80) return { grade: 'A+', gradePoint: 4.0 };
  if (percentage >= 70) return { grade: 'A', gradePoint: 3.5 };
  if (percentage >= 60) return { grade: 'B', gradePoint: 3.0 };
  if (percentage >= 50) return { grade: 'C', gradePoint: 2.0 };
  return { grade: 'F', gradePoint: 0.0 };
}

export function evaluateAnswer(
  question: IQuestion,
  selectedOptionIndex: number,
  submittedAnswer: string | number | undefined
): { isCorrect: boolean; marksObtained: number } {
  let isCorrect = false;
  
  if (question.correctOptionIndex !== undefined && selectedOptionIndex >= 0) {
    isCorrect = question.correctOptionIndex === selectedOptionIndex;
  } else if (question.correctAnswer && submittedAnswer !== undefined) {
    isCorrect = String(question.correctAnswer).trim().toLowerCase() === String(submittedAnswer).trim().toLowerCase();
  } else if (question.correctOptionIndex !== undefined && question.options && question.options[question.correctOptionIndex]) {
    const correctText = String(question.options[question.correctOptionIndex]).trim().toLowerCase();
    if (submittedAnswer !== undefined && String(submittedAnswer).trim().toLowerCase() === correctText) {
      isCorrect = true;
    }
  }
  
  const marksObtained = isCorrect ? (question.marks || 1) : 0;
  return { isCorrect, marksObtained };
}