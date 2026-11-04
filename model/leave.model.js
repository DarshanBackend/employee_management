import mongoose from "mongoose";

const LeaveSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Employee is required"],
    },
    leaveType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LeaveType",
      required: [true, "Leave type is required"],
    },
    leaveTypeName: {
      type: String,
      required: [true, "Leave type name is required"],
      trim: true,
    },
    fromDate: {
      type: String,
      required: [true, "From date is required (YYYY-MM-DD)"],
      trim: true,
    },
    toDate: {
      type: String,
      required: [true, "To date is required (YYYY-MM-DD)"],
      trim: true,
    },
    formattedFromDate: {
      type: String,
      trim: true, // e.g. "25 Oct 2026"
    },
    formattedToDate: {
      type: String,
      trim: true, // e.g. "26 Oct 2026"
    },
    isHalfDay: {
      type: Boolean,
      default: false,
    },
    halfDaySession: {
      type: String,
      enum: ["First Half", "Second Half", null],
      default: null,
    },
    totalDays: {
      type: Number,
      required: [true, "Total days is required"],
      min: [0.5, "Total days must be at least 0.5"],
      default: 1,
    },
    reason: {
      type: String,
      required: [true, "Reason for leave is required"],
      trim: true,
    },
    emergencyContact: {
      type: String,
      trim: true,
      default: "",
    },
    documentUrl: {
      type: String,
      trim: true,
      default: null,
    },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected", "Cancelled"],
      default: "Pending",
    },
    actionBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    actionAt: {
      type: Date,
      default: null,
    },
    adminRemarks: {
      type: String,
      trim: true,
      default: "",
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: "",
    },
    appliedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

LeaveSchema.index({ employee: 1, fromDate: 1, toDate: 1 });
LeaveSchema.index({ status: 1 });
LeaveSchema.index({ leaveType: 1 });

const LeaveModel = mongoose.model("Leave", LeaveSchema);
export default LeaveModel;
