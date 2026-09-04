import mongoose, { Schema, Document } from 'mongoose';

export interface IPaymentEvent extends Document {
  eventId: string;
  eventType: string;
  processedAt: Date;
  metadata?: Record<string, any>;
}

const PaymentEventSchema = new Schema(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    eventType: { type: String, required: true },
    processedAt: { type: Date, default: Date.now },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

export const PaymentEvent =
  mongoose.models.PaymentEvent ||
  mongoose.model<IPaymentEvent>('PaymentEvent', PaymentEventSchema);
