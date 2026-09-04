import mongoose, { Schema, Document } from 'mongoose';

export interface IFeatureFlag extends Document {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  roles: string[];
  createdAt: Date;
  updatedAt: Date;
}

const FeatureFlagSchema: Schema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    roles: [{ type: String }],
  },
  { timestamps: true }
);

export default mongoose.models.FeatureFlag || mongoose.model<IFeatureFlag>('FeatureFlag', FeatureFlagSchema);
