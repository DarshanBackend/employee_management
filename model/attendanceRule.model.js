import mongoose from "mongoose";

const AttendanceRuleSchema = new mongoose.Schema(
  {
    workingHours: {
      enableWorkingHours: {
        type: Boolean,
        default: true,
      },
      startTime: {
        type: String,
        default: "09:00 AM",
        trim: true,
      },
      endTime: {
        type: String,
        default: "06:00 PM",
        trim: true,
      },
      workingDays: {
        type: [String],
        default: ["Mon", "Tue", "Wed", "Thu", "Fri"],
      },
      totalHours: {
        type: String,
        default: "9h 00m",
        trim: true,
      },
    },

    graceTime: {
      enableGracePeriod: {
        type: Boolean,
        default: true,
      },
      graceDuration: {
        type: Number,
        default: 15,
      },
      maxGraceArrivalsPerMonth: {
        type: Number,
        default: 3,
      },
      actionIfLimitExceeded: {
        type: String,
        enum: [
          "Mark as Half Day",
          "Mark as Absent",
          "Deduct Leave",
          "Deduct Salary",
          "Warning Only",
        ],
        default: "Mark as Half Day",
      },
    },

    breakTime: {
      trackEmployeeBreaks: {
        type: Boolean,
        default: true,
      },
      lunchBreakAllowance: {
        type: Number,
        default: 60,
      },
      teaBreakAllowance: {
        type: Number,
        default: 15,
      },
      allowedShortBreaksPerShift: {
        type: Number,
        default: 2,
      },
      deductBreaksFromTotalHours: {
        type: Boolean,
        default: false,
      },
    },

    overtimeRules: {
      enableOvertimeTracking: {
        type: Boolean,
        default: true,
      },
      minimumMinutesForOvertime: {
        type: Number,
        default: 30,
      },
      weekdayOvertimeRateMultiplier: {
        type: Number,
        default: 1.5,
      },
      weekendHolidayOvertimeMultiplier: {
        type: Number,
        default: 2.0,
      },
      requireManagerApproval: {
        type: Boolean,
        default: true,
      },
    },

    autoAttendance: {
      autoCheckInAtShiftStart: {
        type: Boolean,
        default: false,
      },
      autoCheckOutAtShiftEnd: {
        type: Boolean,
        default: true,
      },
      bufferWindow: {
        type: Number,
        default: 30,
      },
      sendPushReminder: {
        type: Boolean,
        default: true,
      },
    },

    geofencing: {
      enableGeofenceCheckIn: {
        type: Boolean,
        default: true,
      },
      primaryOfficeLocation: {
        type: String,
        default: "Head Office - Mumbai",
        trim: true,
      },
      radius: {
        type: Number,
        default: 200,
      },
      exemptRemoteWorkers: {
        type: Boolean,
        default: true,
      },
      latitude: {
        type: Number,
        default: 19.076,
      },
      longitude: {
        type: Number,
        default: 72.8777,
      },
    },

    ipRestriction: {
      enableIpWhitelist: {
        type: Boolean,
        default: true,
      },
      allowedIpSubnets: {
        type: [String],
        default: ["192.168.1.0/24", "10.0.4.15"],
      },
      verifyWifiSsid: {
        type: Boolean,
        default: true,
      },
      allowedWifiSsids: {
        type: [String],
        default: ["Company_Office_Secure", "HeadOffice_5G"],
      },
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    id: false,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.id;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

const AttendanceRuleModel = mongoose.model(
  "AttendanceRule",
  AttendanceRuleSchema
);

export default AttendanceRuleModel;