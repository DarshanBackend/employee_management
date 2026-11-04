import mongoose from "mongoose";

const AttendanceSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Employee is required"],
    },
    // Normalized date format: YYYY-MM-DD
    date: {
      type: String,
      required: [true, "Date (YYYY-MM-DD) is required"],
      trim: true,
    },
    formattedDate: {
      type: String,
      trim: true, // e.g. "08 Oct 2026"
    },
    shift: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shift",
      default: null,
    },
    checkInTime: {
      type: Date,
      default: null,
    },
    checkInDisplay: {
      type: String,
      default: null,
      trim: true, // e.g. "09:30 AM"
    },
    checkOutTime: {
      type: Date,
      default: null,
    },
    checkOutDisplay: {
      type: String,
      default: null,
      trim: true, // e.g. "06:30 PM"
    },
    status: {
      type: String,
      enum: ["Present", "Late", "Half Day", "Absent", "On Leave", "Regularized"],
      default: "Present",
    },
    isCheckInRegularized: {
      type: Boolean,
      default: false,
    },
    isCheckOutRegularized: {
      type: Boolean,
      default: false,
    },
    totalWorkMinutes: {
      type: Number,
      default: 0,
    },
    totalWorkHoursDisplay: {
      type: String,
      default: "0h 00m",
      trim: true,
    },
    requiredWorkMinutes: {
      type: Number,
      default: 540, // 9 hours (or configured shift duration)
    },
    earliestAllowedCheckOut: {
      type: Date,
      default: null,
    },
    earliestAllowedCheckOutDisplay: {
      type: String,
      default: null,
      trim: true, // e.g. "06:10 PM"
    },
    isEarlyOutApproved: {
      type: Boolean,
      default: false,
    },
    approvedEarlyOutTime: {
      type: String,
      default: null,
      trim: true, // e.g. "03:25 PM"
    },
    leaveRecord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Leave",
      default: null,
    },
    overtimeMinutes: {
      type: Number,
      default: 0,
    },
    // Tracker & Break Automation Fields
    trackerStatus: {
      type: String,
      enum: [
        "NOT_STARTED",
        "RUNNING",
        "ON_BREAK",
        "BREAK_ENDED_PENDING_START",
        "PAUSED",
        "STOPPED",
        "COMPLETED",
      ],
      default: "NOT_STARTED",
    },
    trackerLastStartedAt: {
      type: Date,
      default: null,
    },
    totalBreakLateMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalManualPauseMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    originalEarliestAllowedCheckOut: {
      type: Date,
      default: null,
    },
    originalEarliestAllowedCheckOutDisplay: {
      type: String,
      default: null,
      trim: true,
    },
    activeBreak: {
      breakType: { type: String, default: null },
      name: { type: String, default: null },
      scheduledStartTime: { type: String, default: null },
      scheduledEndTime: { type: String, default: null },
      scheduledDurationMinutes: { type: Number, default: 0 },
      autoStopped: { type: Boolean, default: false },
      stoppedAt: { type: Date, default: null },
      stoppedAtDisplay: { type: String, default: null },
      isOverdue: { type: Boolean, default: false },
      currentLateMinutes: { type: Number, default: 0 },
    },
    activePause: {
      pausedAt: { type: Date, default: null },
      pausedAtDisplay: { type: String, default: null },
      reason: { type: String, default: "Manual Pause" },
    },
    manualPauses: [
      {
        pausedAt: { type: Date, default: null },
        pausedAtDisplay: { type: String, default: null },
        resumedAt: { type: Date, default: null },
        resumedAtDisplay: { type: String, default: null },
        durationMinutes: { type: Number, default: 0 },
        reason: { type: String, default: "Manual Pause" },
      },
    ],
    breaks: [
      {
        breakType: {
          type: String,
          default: "Tea Break",
        },
        name: {
          type: String,
          trim: true,
          default: "Tea Break",
        },
        scheduledStartTime: {
          type: String,
          trim: true,
        },
        scheduledEndTime: {
          type: String,
          trim: true,
        },
        scheduledDurationMinutes: {
          type: Number,
          default: 15,
        },
        autoStopped: {
          type: Boolean,
          default: false,
        },
        stoppedAt: {
          type: Date,
          default: null,
        },
        stoppedAtDisplay: {
          type: String,
          default: null,
        },
        resumedAt: {
          type: Date,
          default: null,
        },
        resumedAtDisplay: {
          type: String,
          default: null,
        },
        lateResumeMinutes: {
          type: Number,
          default: 0,
        },
        status: {
          type: String,
          enum: ["Scheduled", "Active", "Pending Resume", "Completed", "Skipped"],
          default: "Scheduled",
        },
      },
    ],
    notes: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true }
);

AttendanceSchema.index({ employee: 1, date: 1 }, { unique: true });
AttendanceSchema.index({ date: 1 });
AttendanceSchema.index({ status: 1 });

const AttendanceModel = mongoose.model("Attendance", AttendanceSchema);
export default AttendanceModel;
