import { Schema, model, Document } from 'mongoose';

export interface ISubscriptionPlan extends Document {
  name: string;
  targetRole: 'teacher' | 'student';
  interval: 'monthly' | 'yearly';
  price: number;
  durationDays: number;
  features: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const subscriptionPlanSchema = new Schema<ISubscriptionPlan>(
  {
    name: { type: String, required: true },
    targetRole: { type: String, enum: ['teacher', 'student'], required: true },
    interval: { type: String, enum: ['monthly', 'yearly'], required: true },
    price: { type: Number, required: true, min: 0 },
    durationDays: { type: Number, required: true, default: 30 },
    features: [{ type: String }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const SubscriptionPlan = model<ISubscriptionPlan>(
  'SubscriptionPlan',
  subscriptionPlanSchema
);
