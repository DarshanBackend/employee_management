import mongoose from "mongoose";

const ShiftSchema = new mongoose.Schema(
  {
    shiftName: {
      type: String,
      required: [true, "Shift name is required"],
      trim: true,
    },
    shiftCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: function () {
        if (!this.shiftName) return "";
        return this.shiftName
          .split(" ")
          .map((w) => w.charAt(0))
          .join("")
          .toUpperCase();
      },
    },
    startTime: {
      type: String,
      required: [true, "Start time is required (e.g. '09:00 AM')"],
      trim: true,
    },
    endTime: {
      type: String,
      required: [true, "End time is required (e.g. '06:00 PM')"],
      trim: true,
    },
    durationHours: {
      type: Number,
      default: 9,
    },
    workHoursDisplay: {
      type: String,
      trim: true,
      default: "9 Hours",
    },
    // Lunch / Main Break Time
    breakTime: {
      name: {
        type: String,
        trim: true,
        default: "Meal Break",
      },
      startTime: {
        type: String,
        trim: true,
        default: "01:00 PM",
      },
      endTime: {
        type: String,
        trim: true,
        default: "02:00 PM",
      },
      durationMinutes: {
        type: Number,
        default: 60,
      },
    },
    // Tea Breaks Configuration (Optional / Not Compulsory)
    teaBreakCount: {
      type: Number,
      default: 0,
      min: [0, "Tea break count cannot be negative"],
    },
    teaBreakDuration: {
      type: Number,
      default: 15, // in minutes per tea break
      min: [0, "Tea break duration cannot be negative"],
    },
    teaBreaks: [
      {
        name: {
          type: String,
          trim: true,
          default: "Tea Break",
        },
        startTime: {
          type: String,
          trim: true,
        },
        endTime: {
          type: String,
          trim: true,
        },
        durationMinutes: {
          type: Number,
          default: 15,
        },
        position: {
          type: String,
          enum: ["before_break", "after_break", "custom"],
          default: "custom",
        },
      },
    ],
    color: {
      type: String,
      default: "#3B82F6",
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    isDefault: {
      type: Boolean,
      default: false,
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
  { timestamps: true }
);

ShiftSchema.index({ shiftName: 1 });
ShiftSchema.index({ status: 1 });

const ShiftModel = mongoose.model("Shift", ShiftSchema);
export default ShiftModel;
