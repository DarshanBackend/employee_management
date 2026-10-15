import mongoose from "mongoose";

const LeaveTypeSchema = new mongoose.Schema(
  {
    leaveTypeName: {
      type: String,
      required: [true, "Leave type name is required"],
      trim: true,
    },
    leaveBalance: {
      type: Number,
      required: [true, "Leave balance in days is required"],
      min: [0, "Leave balance cannot be negative"],
      default: 0,
    },
    icon: {
      type: String,
      default: null,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    allowHalfDay: {
      type: Boolean,
      default: true,
    },
    requiresApproval: {
      type: Boolean,
      default: true,
    },
    color: {
      type: String,
      trim: true,
      default: "#EF4444",
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

LeaveTypeSchema.virtual("allowance").get(function () {
  return `${this.leaveBalance} days/year`;
});

LeaveTypeSchema.virtual("approvalProcess").get(function () {
  return this.requiresApproval ? "Approval Required" : "No Approval Required";
});

LeaveTypeSchema.index({ leaveTypeName: 1, isDeleted: 1 });

const LeaveTypeModel = mongoose.model("LeaveType", LeaveTypeSchema);
export default LeaveTypeModel;