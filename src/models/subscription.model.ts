import { Schema, model, Document, Types } from 'mongoose';

export interface IUserSubscription extends Document {
  userId: string;
  userEmail: string;
  userName?: string;
  role: 'teacher' | 'student';
  planId: Types.ObjectId;
  planName: string;
  interval: 'monthly' | 'yearly';
  pricePaid: number;
  startDate: Date;
  endDate: Date;
  status: 'active' | 'expired' | 'cancelled';
  paymentId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const userSubscriptionSchema = new Schema<IUserSubscription>(
  {
    userId: { type: String, required: true, index: true },
    userEmail: { type: String, required: true },
    userName: { type: String },
    role: { type: String, enum: ['teacher', 'student'], required: true },
    planId: { type: Schema.Types.ObjectId, ref: 'SubscriptionPlan', required: true },
    planName: { type: String, required: true },
    interval: { type: String, enum: ['monthly', 'yearly'], required: true },
    pricePaid: { type: Number, required: true },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ['active', 'expired', 'cancelled'],
      default: 'active',
      index: true,
    },
    paymentId: { type: String },
  },
  { timestamps: true }
);

export const UserSubscription = model<IUserSubscription>(
  'UserSubscription',
  userSubscriptionSchema
);
