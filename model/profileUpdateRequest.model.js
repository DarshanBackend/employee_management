import mongoose from "mongoose";

const ProfileUpdateRequestSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Employee reference is required"],
    },
    fieldToUpdate: {
      type: String,
      required: [true, "Field to update is required"],
      enum: [
        "Legal Name Correction",
        "Bank Account Number",
        "PAN / Tax Identification",
        "Educational Degree Update",
        "Department",
        "Designation",
        "Work Email",
        "Employment Type",
        "Other",
      ],
      default: "Legal Name Correction",
    },
    currentValue: {
      type: String,
      default: "",
      trim: true,
    },
    proposedValue: {
      type: String,
      required: [true, "Proposed new value is required"],
      trim: true,
    },
    reason: {
      type: String,
      required: [true, "Reason and justification is required"],
      trim: true,
    },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending",
    },
    adminRemarks: {
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
  },
  { timestamps: true }
);

const ProfileUpdateRequestModel = mongoose.model(
  "ProfileUpdateRequest",
  ProfileUpdateRequestSchema
);

export default ProfileUpdateRequestModel;

