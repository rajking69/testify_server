import { Schema, model, Document, Types } from 'mongoose';

export interface IExamPurchase extends Document {
  studentId: string;
  studentEmail: string;
  studentName?: string;
  examId: Types.ObjectId;
  teacherId: string;
  teacherEmail?: string;
  pricePaid: number;
  paymentId?: string;
  transactionId?: string;
  paymentProvider?: string;
  status: 'completed' | 'pending' | 'failed' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}

const examPurchaseSchema = new Schema<IExamPurchase>(
  {
    studentId: { type: String, required: true, index: true },
    studentEmail: { type: String, required: true },
    studentName: { type: String },
    examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
    teacherId: { type: String, required: true, index: true },
    teacherEmail: { type: String },
    pricePaid: { type: Number, required: true, min: 0 },
    paymentId: { type: String },
    transactionId: { type: String },
    paymentProvider: { type: String, default: 'STRIPE' },
    status: {
      type: String,
      enum: ['completed', 'pending', 'failed', 'cancelled'],
      default: 'completed',
    },
  },
  { timestamps: true }
);

// Indexes for fast revenue queries & deduplication
examPurchaseSchema.index({ studentId: 1, examId: 1 }, { unique: true });
examPurchaseSchema.index({ teacherId: 1, createdAt: -1 });

export const ExamPurchase = model<IExamPurchase>('ExamPurchase', examPurchaseSchema);
