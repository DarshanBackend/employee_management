import mongoose from "mongoose";

const BranchSchema = new mongoose.Schema(
  {
    branchName: {
      type: String,
      required: [true, "Branch name is required"],
      trim: true,
    },
    isHeadquarters: {
      type: Boolean,
      default: false,
    },
    address: {
      type: String,
      required: [true, "Full address is required"],
      trim: true,
    },
    latitude: {
      type: Number,
      default: 0,
    },
    longitude: {
      type: Number,
      default: 0,
    },
    geofenceRadius: {
      type: Number,
      default: 200,
      min: [10, "Geofence radius must be at least 10 meters"],
    },
    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

BranchSchema.index({ branchName: 1, isDeleted: 1 });
BranchSchema.index({ isHeadquarters: 1, isDeleted: 1 });

const BranchModel = mongoose.model("Branch", BranchSchema);
export default BranchModel;
