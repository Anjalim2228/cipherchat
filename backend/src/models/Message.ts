import mongoose, { Document, Schema } from 'mongoose';

// ─── Reaction sub-type ──────────────────────────────
export interface IReaction {
  emoji: string;
  userId: mongoose.Types.ObjectId;
  username: string;
}

export interface IMessage extends Document {
  sender: mongoose.Types.ObjectId;
  receiver?: mongoose.Types.ObjectId;
  group?: mongoose.Types.ObjectId;
  message: string;
  messageType: 'text' | 'image' | 'file';
  isRead: boolean;
  reactions: IReaction[];   // ← NEW
  createdAt: Date;
}

const ReactionSchema = new Schema<IReaction>(
  {
    emoji:    { type: String, required: true },
    userId:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
  },
  { _id: false }
);

const MessageSchema = new Schema<IMessage>(
  {
    sender: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    receiver: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    group: {
      type: Schema.Types.ObjectId,
      ref: 'Group',
      default: null,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    messageType: {
      type: String,
      enum: ['text', 'image', 'file'],
      default: 'text',
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    // ─── NEW: reactions array ─────────────────────
    reactions: {
      type: [ReactionSchema],
      default: [],
    },
  },
  { timestamps: true }
);

const Message = mongoose.model<IMessage>('Message', MessageSchema);
export default Message;