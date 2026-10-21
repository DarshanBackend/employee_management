import mongoose from "mongoose";

const AuditLogSchema = new mongoose.Schema(
  {
    auditCode: {
      type: String,
      unique: true,
      trim: true,
      required: true,
    },
    action: {
      type: String,
      required: [true, "Audit action title is required"],
      trim: true,
    },
    actorName: {
      type: String,
      required: [true, "Actor name is required"],
      trim: true,
    },
    actorRole: {
      type: String,
      trim: true,
      default: "User",
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    category: {
      type: String,
      enum: ["Employees", "Payroll", "Leave", "Security", "Other"],
      default: "Security",
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    targetResource: {
      type: String,
      trim: true,
      default: "",
    },
    ipAddress: {
      type: String,
      trim: true,
      default: "127.0.0.1",
    },
    diff: {
      before: {
        type: String,
        default: "",
        trim: true,
      },
      after: {
        type: String,
        default: "",
        trim: true,
      },
    },
    badgeColor: {
      type: String,
      trim: true,
      default: "#10B981",
    },
    icon: {
      type: String,
      trim: true,
      default: "clock",
    },
    eventDate: {
      type: Date,
      default: Date.now,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

AuditLogSchema.index({ category: 1, isDeleted: 1 });
AuditLogSchema.index({ eventDate: -1 });

const AuditLogModel = mongoose.model("AuditLog", AuditLogSchema);
export default AuditLogModel;