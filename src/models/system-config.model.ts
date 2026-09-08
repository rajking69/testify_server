import mongoose, { Schema, Document } from 'mongoose';

export interface ISystemConfig extends Document {
  key: string;
  name: string;
  value: string;
  category: 'general' | 'auth' | 'exam' | 'payment' | 'notification';
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

const SystemConfigSchema: Schema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    value: { type: String, required: true },
    category: {
      type: String,
      enum: ['general', 'auth', 'exam', 'payment', 'notification'],
      default: 'general',
    },
    description: { type: String, required: true },
  },
  { timestamps: true }
);

export default mongoose.models.SystemConfig || mongoose.model<ISystemConfig>('SystemConfig', SystemConfigSchema);
