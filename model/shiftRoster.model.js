import mongoose from "mongoose";

const DayScheduleSchema = new mongoose.Schema(
  {
    shift: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shift",
      default: null,
    },
    isOff: {
      type: Boolean,
      default: false,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { _id: false }
);

const ShiftRosterSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Employee is required"],
    },
    // YYYY-MM-DD format (Monday of the target week)
    weekStartDate: {
      type: String,
      required: [true, "Week start date (YYYY-MM-DD) is required"],
      trim: true,
    },
    // YYYY-MM-DD format (Sunday of the target week)
    weekEndDate: {
      type: String,
      required: [true, "Week end date (YYYY-MM-DD) is required"],
      trim: true,
    },
    schedule: {
      monday: { type: DayScheduleSchema, default: () => ({ shift: null, isOff: false }) },
      tuesday: { type: DayScheduleSchema, default: () => ({ shift: null, isOff: false }) },
      wednesday: { type: DayScheduleSchema, default: () => ({ shift: null, isOff: false }) },
      thursday: { type: DayScheduleSchema, default: () => ({ shift: null, isOff: false }) },
      friday: { type: DayScheduleSchema, default: () => ({ shift: null, isOff: false }) },
      saturday: { type: DayScheduleSchema, default: () => ({ shift: null, isOff: true }) },
      sunday: { type: DayScheduleSchema, default: () => ({ shift: null, isOff: true }) },
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

ShiftRosterSchema.index({ employee: 1, weekStartDate: 1 }, { unique: true });

const ShiftRosterModel = mongoose.model("ShiftRoster", ShiftRosterSchema);
export default ShiftRosterModel;
