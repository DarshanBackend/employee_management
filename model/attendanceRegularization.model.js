import mongoose from "mongoose";

const AttendanceRegularizationSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Employee is required"],
    },
    // YYYY-MM-DD
    date: {
      type: String,
      required: [true, "Date is required"],
      trim: true,
    },
    formattedDate: {
      type: String,
      trim: true, // e.g. "08 Oct 2026"
    },
    correctionType: {
      type: String,
      required: [true, "Correction type is required"],
      enum: [
        "Missed Check-In",
        "Missed Check-Out",
        "Late In Regularization",
        "Early Out Regularization",
        "Leave",
        "Half Day Leave",
        "Early Departure",
      ],
    },
    originalPunch: {
      type: String,
      default: function () {
        if (this.correctionType === "Missed Check-In") return "Missed Check-In";
        if (this.correctionType === "Missed Check-Out") return "Missed Check-Out";
        if (
          [
            "Early Out Regularization",
            "Leave",
            "Half Day Leave",
            "Early Departure",
          ].includes(this.correctionType)
        ) {
          return "Early Departure / Leave";
        }
        return "Discrepancy";
      },
      trim: true,
    },
    requestedTimestamp: {
      type: String,
      required: [true, "Requested timestamp is required"],
      trim: true,
    },
    reason: {
      type: String,
      required: [true, "Reason for regularization is required"],
      trim: true,
    },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending",
    },
    managerNote: {
      type: String,
      default: "",
      trim: true,
    },
    rejectionReason: {
      type: String,
      default: "",
      trim: true,
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
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

AttendanceRegularizationSchema.index({ employee: 1, date: 1 });
AttendanceRegularizationSchema.index({ status: 1 });
AttendanceRegularizationSchema.index({ createdAt: -1 });

const AttendanceRegularizationModel = mongoose.model(
  "AttendanceRegularization",
  AttendanceRegularizationSchema
);

export default AttendanceRegularizationModel;
