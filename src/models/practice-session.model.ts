import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IPracticeAnswer {
  questionId: Types.ObjectId;
  selectedOption?: string;
  selectedOptionIndex?: number;
  isCorrect?: boolean;
  timeSpentSeconds?: number;
}

export interface IPracticeSession extends Document {
  userId: string;
  category: string;
  subject?: string;
  topic?: string;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
  totalQuestions: number;
  questions: Types.ObjectId[];
  answers: IPracticeAnswer[];
  score: number;
  correctAnswersCount: number;
  wrongAnswersCount: number;
  accuracyPercentage: number;
  totalTimeSeconds: number;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PracticeAnswerSchema = new Schema({
  questionId: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
  selectedOption: { type: String },
  selectedOptionIndex: { type: Number },
  isCorrect: { type: Boolean, default: false },
  timeSpentSeconds: { type: Number, default: 0 },
});

const PracticeSessionSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    category: { type: String, required: true },
    subject: { type: String },
    topic: { type: String },
    difficulty: { type: String, enum: ['EASY', 'MEDIUM', 'HARD'] },
    totalQuestions: { type: Number, required: true },
    questions: [{ type: Schema.Types.ObjectId, ref: 'Question' }],
    answers: [PracticeAnswerSchema],
    score: { type: Number, default: 0 },
    correctAnswersCount: { type: Number, default: 0 },
    wrongAnswersCount: { type: Number, default: 0 },
    accuracyPercentage: { type: Number, default: 0 },
    totalTimeSeconds: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['IN_PROGRESS', 'COMPLETED', 'ABANDONED'],
      default: 'IN_PROGRESS',
    },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

export const PracticeSession =
  mongoose.models.PracticeSession ||
  mongoose.model<IPracticeSession>('PracticeSession', PracticeSessionSchema);
