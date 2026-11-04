import mongoose from "mongoose";

const LeavePolicySchema = new mongoose.Schema(
  {
    leaveType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LeaveType",
      required: [true, "Leave Type is required"],
    },
    policyTitle: {
      type: String,
      trim: true,
      default: "",
    },
    // Annual Leave Quota (Year-wise Quota)
    leaveQuota: {
      type: Number,
      required: [true, "Annual leave quota / allowed days is required"],
      min: [0, "Leave quota cannot be negative"],
      default: 0,
    },
    // Accrual Mode: "Annual Upfront...", "Monthly Accrual...", "Quarterly Accrual..."
    accrualMode: {
      type: String,
      trim: true,
      default: "Annual Upfront (All leaves credited upfront at year start)",
    },
    // Carry Forward Cap: Toggle switch + max days
    isCarryForwardEnabled: {
      type: Boolean,
      default: true,
    },
    maxCarryForwardDays: {
      type: Number,
      default: 5,
      min: [0, "Max carry forward days cannot be negative"],
    },
    carryForwardCap: {
      type: String,
      trim: true,
      default: "5 Days",
    },
    // Advance Notice Period: e.g. 2 Days Before (0 for same-day/emergency)
    advanceNoticeDays: {
      type: Number,
      default: 2,
      min: [0, "Notice period cannot be negative"],
    },
    noticePeriod: {
      type: String,
      trim: true,
      default: "2 Days Before",
    },
    // Max Consecutive Days
    maxConsecutiveDays: {
      type: Number,
      default: 5,
      min: [1, "Max consecutive days must be at least 1"],
    },
    // Approval Workflow: "Reporting Manager", "Department Head", "HR Department", "Auto-Approved"
    approvalWorkflow: {
      type: String,
      trim: true,
      default: "Reporting Manager",
    },
    approvalChain: {
      type: String,
      trim: true,
      default: "Reporting Manager",
    },
    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active",
    },
    isDeleted: {
      type: Boolean,
      default: false,
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

LeavePolicySchema.virtual("annualLeaveQuota").get(function () {
  return this.leaveQuota;
});

LeavePolicySchema.virtual("annualDaysDisplay").get(function () {
  return `${this.leaveQuota} Days / Year`;
});

LeavePolicySchema.virtual("annualAllowedDays").get(function () {
  return this.leaveQuota;
});

LeavePolicySchema.virtual("maxConsecutiveDaysDisplay").get(function () {
  return `${this.maxConsecutiveDays} Days`;
});

LeavePolicySchema.virtual("advanceNoticePeriod").get(function () {
  return this.advanceNoticeDays === 0
    ? "0 Days (Same-day)"
    : `${this.advanceNoticeDays} Days Before`;
});

LeavePolicySchema.index({ leaveType: 1, isDeleted: 1 });

const LeavePolicyModel = mongoose.model("LeavePolicy", LeavePolicySchema);
export default LeavePolicyModel;
