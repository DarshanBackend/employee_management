import mongoose from "mongoose";

const AttendanceRuleSchema = new mongoose.Schema(
  {
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