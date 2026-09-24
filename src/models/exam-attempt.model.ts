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
  status: 'in_progress' | 'submitted' | 'expired' | 'abandoned';
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
      enum: ['in_progress', 'submitted', 'expired', 'abandoned'],
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

// Compound index for live monitoring queries: find attempts by status + examId
examAttemptSchema.index({ status: 1, examId: 1 });

// TTL Index: Automatically delete expired/abandoned attempts after 24 hours
// Only applies to documents where status is 'expired' or 'abandoned'
examAttemptSchema.index(
  { updatedAt: 1 },
  { expireAfterSeconds: 86400, partialFilterExpression: { status: { $in: ['expired', 'abandoned'] } } }
);

// TTL Index: Automatically delete in_progress attempts that are stale (no heartbeat for 2 hours)
// This handles abandoned attempts where student closed tab without submitting
examAttemptSchema.index(
  { 'proctoringData.lastPingAt': 1 },
  { expireAfterSeconds: 7200, partialFilterExpression: { status: 'in_progress' } }
);

export const ExamAttempt = model<IExamAttempt>('ExamAttempt', examAttemptSchema);
