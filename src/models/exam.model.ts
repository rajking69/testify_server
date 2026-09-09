import { Schema, model, Document } from 'mongoose';

export interface IQuestion {
  id: string;
  questionText: string;
  options: string[];
  correctOptionIndex: number;
  marks: number;
  explanation?: string;
}

export interface IExam extends Document {
  title: string;
  description: string;
  category: string;
  teacherId: string;
  teacherName: string;
  teacherEmail: string;
  accessType: 'free' | 'paid' | 'subscription_only';
  price: number; // For 'paid' (one-time special exam)
  durationMinutes: number;
  totalMarks: number;
  passMarks: number;
  questions: IQuestion[];
  isPublished: boolean;
  status?: string;
  joinCode?: string;
  accessToken?: string;
  subject?: string;
  startDateTime?: string;
  endDateTime?: string;
  date?: string;
  totalEnrolled?: number;
  createdAt: Date;
  updatedAt: Date;
}

const questionSchema = new Schema<IQuestion>(
  {
    id: { type: String, default: () => Math.random().toString(36).substring(2, 9) },
    questionText: { type: String, default: 'Question' },
    options: [{ type: String }],
    correctOptionIndex: { type: Number, default: 0 },
    marks: { type: Number, default: 1 },
    explanation: { type: String },
  },
  { _id: false, strict: false }
);

const examSchema = new Schema<IExam>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    category: { type: String, required: true, default: 'General' },
    teacherId: { type: String, required: true, index: true },
    teacherName: { type: String, required: true },
    teacherEmail: { type: String, required: true },
    accessType: {
      type: String,
      enum: ['free', 'paid', 'subscription_only'],
      default: 'free',
      index: true,
    },
    price: { type: Number, default: 0, min: 0 },
    durationMinutes: { type: Number, required: true, default: 30 },
    totalMarks: { type: Number, required: true, default: 100 },
    passMarks: { type: Number, required: true, default: 40 },
    questions: [questionSchema],
    isPublished: { type: Boolean, default: true, index: true },
    status: { type: String, default: 'PUBLISHED' },
    joinCode: { type: String, index: true },
    accessToken: { type: String, index: true },
    subject: { type: String, default: 'General' },
    startDateTime: { type: String },
    endDateTime: { type: String },
    date: { type: String },
    totalEnrolled: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Exam = model<IExam>('Exam', examSchema);
