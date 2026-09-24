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
  scheduleType?: 'scheduled' | 'flexible';
  status: 'draft' | 'published' | 'scheduled';
  price: number; // For 'paid' (one-time special exam)
  durationMinutes: number;
  totalMarks: number;
  passMarks: number;
  questions: IQuestion[];
  isPublished: boolean;
  resultsPublished?: boolean;
  totalEnrolled: number;
  completedCount: number;
  joinCode?: string;
  accessToken?: string;
  schedule?: IExamSchedule;
  startDateTime?: string;
  endDateTime?: string;
  date?: string;
  requireCamera?: boolean;
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
    scheduleType: {
      type: String,
      enum: ['scheduled', 'flexible'],
      default: 'flexible',
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
    resultsPublished: { type: Boolean, default: true, index: true },
    joinCode: { type: String, index: true },
    accessToken: { type: String, index: true },
    startDateTime: { type: String },
    endDateTime: { type: String },
    date: { type: String },
    requireCamera: { type: Boolean, default: false },
    totalEnrolled: { type: Number, default: 0 },
    completedCount: { type: Number, default: 0 },
    schedule: {
      startWindow: { type: Date },
      endWindow: { type: Date },
    },
  },
  { timestamps: true }
);

// Keep status and isPublished always in sync: draft => not published, otherwise published
examSchema.pre('save', function (next) {
  if (this.isModified('status')) {
    this.isPublished = this.status !== 'draft';
  } else if (this.isModified('isPublished')) {
    if (this.isPublished && this.status === 'draft') this.status = 'published';
    if (!this.isPublished && this.status !== 'draft') this.status = 'draft';
  }
  if (this.isNew) {
    this.isPublished = this.status !== 'draft';
  }

  const MAX_QUESTIONS = 100;
  const MAX_DOCUMENT_SIZE_BYTES = 16 * 1024 * 1024; // 16MB

  if (this.questions && this.questions.length > MAX_QUESTIONS) {
    return next(new Error(`Exam cannot have more than ${MAX_QUESTIONS} questions. Current: ${this.questions.length}`));
  }

  const docSize = Buffer.byteLength(JSON.stringify(this.toObject()));
  if (docSize > MAX_DOCUMENT_SIZE_BYTES) {
    return next(new Error(`Exam document size (${Math.round(docSize / 1024 / 1024)}MB) exceeds MongoDB 16MB limit`));
  }

  next();
});

// Ensure findOneAndUpdate also keeps isPublished/status in sync
examSchema.pre('findOneAndUpdate', function (next) {
  const update: any = this.getUpdate();
  const set = update.$set || update;
  if (set.status !== undefined) {
    const st = String(set.status).toLowerCase();
    set.status = st;
    set.isPublished = st !== 'draft';
    if (update.$set) update.$set = set; else this.setUpdate(set);
  } else if (set.isPublished !== undefined) {
    const pub = Boolean(set.isPublished);
    set.isPublished = pub;
    set.status = pub ? 'published' : 'draft';
    if (update.$set) update.$set = set; else this.setUpdate(set);
  }
  next();
});

export const Exam = model<IExam>('Exam', examSchema);
