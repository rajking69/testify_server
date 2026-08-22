import { Schema, model, Document, Types } from 'mongoose';

export interface IExamPurchase extends Document {
  studentId: string;
  studentEmail: string;
  studentName?: string;
  examId: Types.ObjectId;
  pricePaid: number;
  paymentId?: string;
  status: 'completed' | 'pending' | 'failed';
  createdAt: Date;
  updatedAt: Date;
}

const examPurchaseSchema = new Schema<IExamPurchase>(
  {
    studentId: { type: String, required: true, index: true },
    studentEmail: { type: String, required: true },
    studentName: { type: String },
    examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
    pricePaid: { type: Number, required: true, min: 0 },
    paymentId: { type: String },
    status: {
      type: String,
      enum: ['completed', 'pending', 'failed'],
      default: 'completed',
    },
  },
  { timestamps: true }
);

// Prevent duplicate active purchases
examPurchaseSchema.index({ studentId: 1, examId: 1 }, { unique: true });

export const ExamPurchase = model<IExamPurchase>('ExamPurchase', examPurchaseSchema);
