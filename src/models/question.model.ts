import { Schema, model, Document } from 'mongoose';

export type QuestionType = 'MCQ' | 'TRUE_FALSE' | 'SHORT_ANSWER' | 'FILL_IN_THE_BLANK';
export type QuestionDifficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type QuestionStatus = 'DRAFT' | 'READY' | 'ARCHIVED';

export interface IQuestion extends Document {
  questionText: string;
  questionType: QuestionType;
  options: string[];
  correctAnswer: string;
  correctOptionIndex?: number;
  explanation?: string;
  category: string;
  subject?: string;
  topic?: string;
  difficulty: QuestionDifficulty;
  marks: number;
  tags: string[];
  status: QuestionStatus;
  version: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const questionSchema = new Schema<IQuestion>(
  {
    questionText: { type: String, required: true, trim: true },
    questionType: {
      type: String,
      enum: ['MCQ', 'TRUE_FALSE', 'SHORT_ANSWER', 'FILL_IN_THE_BLANK'],
      required: true,
      index: true,
    },
    options: [{ type: String, trim: true }],
    correctAnswer: { type: String, required: true, trim: true },
    correctOptionIndex: { type: Number, default: 0 },
    explanation: { type: String, default: '', trim: true },
    category: { type: String, required: true, default: 'General', trim: true, index: true },
    subject: { type: String, default: 'General', trim: true, index: true },
    topic: { type: String, default: '', trim: true, index: true },
    difficulty: {
      type: String,
      enum: ['EASY', 'MEDIUM', 'HARD'],
      default: 'MEDIUM',
      index: true,
    },
    marks: { type: Number, required: true, default: 1, min: 1 },
    tags: [{ type: String, trim: true }],
    status: {
      type: String,
      enum: ['DRAFT', 'READY', 'ARCHIVED'],
      default: 'READY',
      index: true,
    },
    version: { type: Number, default: 1 },
    createdBy: { type: String, required: true, index: true },
  },
  { timestamps: true }
);

questionSchema.index({ createdBy: 1, createdAt: -1 });
questionSchema.index({ questionText: 'text', category: 'text', subject: 'text', topic: 'text', tags: 'text' });

export const Question = model<IQuestion>('Question', questionSchema);