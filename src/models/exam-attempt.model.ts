import { Schema, model, Document, Types } from 'mongoose';

export interface IExamAttemptProctoring {
  currentQuestionIndex?: number;
  answersCount?: number;
  cameraActive?: boolean;
  tabSwitchCount?: number;
  faceDetected?: boolean;
  lastPingAt?: Date;
}

export interface IExamAttempt extends Document {
  studentId: string;
  studentName: string;
  studentEmail: string;
  examId: Types.ObjectId;
  startedAt: Date;
  expiresAt: Date;
  status: 'in_progress' | 'submitted' | 'expired';
  proctoringData: IExamAttemptProctoring;
  createdAt: Date;
  updatedAt: Date;
}

const examAttemptSchema = new Schema<IExamAttempt>(
  {
    studentId: { type: String, required: true, index: true },
    studentName: { type: String, required: true },
    studentEmail: { type: String, required: true },
    examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
    startedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['in_progress', 'submitted', 'expired'],
      default: 'in_progress',
    },
    proctoringData: {
      currentQuestionIndex: { type: Number, default: 0 },
      answersCount: { type: Number, default: 0 },
      cameraActive: { type: Boolean, default: true },
      tabSwitchCount: { type: Number, default: 0 },
      faceDetected: { type: Boolean, default: true },
      lastPingAt: { type: Date, default: Date.now },
    },
  },
  { timestamps: true }
);

export const ExamAttempt = model<IExamAttempt>('ExamAttempt', examAttemptSchema);
