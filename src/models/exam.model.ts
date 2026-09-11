import { Schema, model, Document } from 'mongoose';

export interface IQuestion {
  id: string;
  questionText: string;
  options: string[];
  correctOptionIndex?: number;
  correctAnswer?: string;
  marks: number;
  explanation?: string;
}

export interface IExamSchedule {
  startWindow?: Date;
  endWindow?: Date;
}

export interface IExam extends Document {
  title: string;
  description: string;
  category: string;
  subject: string;
  teacherId: string;
  teacherName: string;
  teacherEmail: string;
  accessType: 'free' | 'paid' | 'subscription_only';
  status: 'draft' | 'published' | 'scheduled';
  price: number; // For 'paid' (one-time special exam)
  durationMinutes: number;
  totalMarks: number;
  passMarks: number;
  questions: IQuestion[];
  isPublished: boolean;
  totalEnrolled: number;
  completedCount: number;
  joinCode?: string;
  accessToken?: string;
  schedule?: IExamSchedule;
  startDateTime?: string;
  endDateTime?: string;
  date?: string;
  createdAt: Date;
  updatedAt: Date;
}

const questionSchema = new Schema<IQuestion>(
  {
    id: { type: String, required: true },
    questionText: { type: String, required: true },
    options: [{ type: String, required: true }],
    correctOptionIndex: { type: Number, default: 0 },
    correctAnswer: { type: String },
    marks: { type: Number, required: true, default: 1 },
    explanation: { type: String },
  },
  { _id: false, strict: false }
);

const examSchema = new Schema<IExam>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    category: { type: String, required: true, default: 'General' },
    subject: { type: String, default: 'General' },
    teacherId: { type: String, required: true, index: true },
    teacherName: { type: String, required: true },
    teacherEmail: { type: String, required: true },
    accessType: {
      type: String,
      enum: ['free', 'paid', 'subscription_only'],
      default: 'free',
      set: (v: string) => (v ? v.toLowerCase() : 'free'),
      index: true,
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'scheduled'],
      default: 'published',
      set: (v: string) => (v ? v.toLowerCase() : 'published'),
      index: true,
    },
    price: { type: Number, default: 0, min: 0 },
    durationMinutes: { type: Number, required: true, default: 30 },
    totalMarks: { type: Number, required: true, default: 100 },
    passMarks: { type: Number, required: true, default: 40 },
    questions: [questionSchema],
    isPublished: { type: Boolean, default: true, index: true },
    joinCode: { type: String, index: true },
    accessToken: { type: String, index: true },
    startDateTime: { type: String },
    endDateTime: { type: String },
    date: { type: String },
    totalEnrolled: { type: Number, default: 0 },
    completedCount: { type: Number, default: 0 },
    schedule: {
      startWindow: { type: Date },
      endWindow: { type: Date },
    },
  },
  { timestamps: true }
);

export const Exam = model<IExam>('Exam', examSchema);
