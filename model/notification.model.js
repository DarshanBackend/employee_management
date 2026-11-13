import mongoose from "mongoose";

export const NOTIFICATION_CATEGORIES = [
  "Leave",
  "Attendance",
  "Payroll",
  "System",
];

const NotificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    senderName: {
      type: String,
      default: "System",
      trim: true,
    },
    senderAvatar: {
      type: String,
      default: null,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: NOTIFICATION_CATEGORIES,
      default: "System",
      index: true,
    },
    type: {
      type: String,
      default: "GENERAL",
      trim: true,
      index: true,
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    referenceModel: {
      type: String,
      default: null,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    formattedTime: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
    id: false,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.id;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.id;
        return ret;
      },
    },
  }
);

NotificationSchema.index({ recipient: 1, isRead: 1, isDeleted: 1 });
NotificationSchema.index({ recipient: 1, category: 1, isDeleted: 1 });
NotificationSchema.index({ createdAt: -1 });

const NotificationModel = mongoose.model("Notification", NotificationSchema);
export default NotificationModel;

