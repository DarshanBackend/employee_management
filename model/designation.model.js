import mongoose from "mongoose";

export const DESIGNATION_LEVELS = [
  "Junior",
  "Senior",
  "TL",
  "Main TL",
  "Manager",
];

const DesignationSchema = new mongoose.Schema(
  {
    designationName: {
      type: String,
      required: [true, "Designation name is required"],
      trim: true,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: [true, "Department is required"],
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
    level: {
      type: String,
      enum: {
        values: [...DESIGNATION_LEVELS, ""],
        message: "Level must be one of: Junior, Senior, TL, Main TL, Manager",
      },
      trim: true,
      default: "",
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

DesignationSchema.index({ designationName: 1, department: 1, isDeleted: 1 });

const DesignationModel = mongoose.model("Designation", DesignationSchema);
export default DesignationModel;
