import { Schema, model, Document, Types } from 'mongoose';

export interface ISubmissionAnswer {
  questionId: string;
  selectedOptionIndex: number;
  isCorrect?: boolean;
  marksObtained?: number;
}

export interface IExamSubmission extends Document {
  studentId: string;
  studentName: string;
  studentEmail: string;
  examId: Types.ObjectId;
  answers: ISubmissionAnswer[];
  score: number;
  totalMarks: number;
  percentage: number;
  isPassed: boolean;
  timeTakenSeconds?: number;
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const submissionAnswerSchema = new Schema<ISubmissionAnswer>(
  {
    questionId: { type: String, required: true },
    selectedOptionIndex: { type: Number, required: true },
    isCorrect: { type: Boolean },
    marksObtained: { type: Number, default: 0 },
  },
  { _id: false }
);

const examSubmissionSchema = new Schema<IExamSubmission>(
  {
    studentId: { type: String, required: true, index: true },
    studentName: { type: String, required: true },
    studentEmail: { type: String, required: true },
    examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
    answers: [submissionAnswerSchema],
    score: { type: Number, required: true, default: 0 },
    totalMarks: { type: Number, required: true },
    percentage: { type: Number, required: true, default: 0 },
    isPassed: { type: Boolean, required: true, default: false },
    timeTakenSeconds: { type: Number },
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const ExamSubmission = model<IExamSubmission>(
  'ExamSubmission',
  examSubmissionSchema
);
