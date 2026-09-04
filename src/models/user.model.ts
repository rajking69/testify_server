import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string;
  role: 'student' | 'teacher' | 'admin';
  status: 'active' | 'inactive' | 'suspended';
  isPremium: boolean;
  premiumStatus: 'none' | 'active' | 'past_due' | 'canceled' | 'expired';
  premiumExpiresAt?: Date;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    emailVerified: { type: Boolean, default: false },
    image: { type: String },
    role: { type: String, enum: ['student', 'teacher', 'admin'], default: 'student' },
    status: { type: String, enum: ['active', 'inactive', 'suspended'], default: 'active' },
    isPremium: { type: Boolean, default: false },
    premiumStatus: {
      type: String,
      enum: ['none', 'active', 'past_due', 'canceled', 'expired'],
      default: 'none',
    },
    premiumExpiresAt: { type: Date },
    stripeCustomerId: { type: String },
    stripeSubscriptionId: { type: String },
  },
  { timestamps: true, collection: 'user' } // Matches Better Auth user collection
);

export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
