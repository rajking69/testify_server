import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string;
  avatarUrl?: string;
  department?: string;
  lastActive?: Date;
  role: 'student' | 'teacher' | 'admin';
  status: 'active' | 'inactive' | 'suspended' | 'deactivated';
  isPremium: boolean;
  premiumStatus: 'none' | 'active' | 'past_due' | 'canceled' | 'expired';
  premiumExpiresAt?: Date;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  bookmarkedQuestions: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    emailVerified: { type: Boolean, default: false },
    image: { type: String },
    avatarUrl: { type: String },
    department: { type: String, default: '' },
    lastActive: { type: Date },
    role: { type: String, enum: ['student', 'teacher', 'admin'], default: 'student' },
    status: { type: String, enum: ['active', 'inactive', 'suspended', 'deactivated'], default: 'active' },
    isPremium: { type: Boolean, default: false },
    premiumStatus: {
      type: String,
      enum: ['none', 'active', 'past_due', 'canceled', 'expired'],
      default: 'none',
    },
    premiumExpiresAt: { type: Date },
    stripeCustomerId: { type: String },
    stripeSubscriptionId: { type: String },
    bookmarkedQuestions: [{ type: Schema.Types.ObjectId, ref: 'Question' }],
  },
  {
    timestamps: true,
    collection: 'user',
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : ret.id;
        ret.avatarUrl = ret.avatarUrl || ret.image || '';
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (_doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : ret.id;
        ret.avatarUrl = ret.avatarUrl || ret.image || '';
        return ret;
      },
    },
  }
);

export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
