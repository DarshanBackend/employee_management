import mongoose from "mongoose";

const RoleSchema = new mongoose.Schema(
  {
    roleTitle: {
      type: String,
      required: [true, "Role title is required"],
      trim: true,
    },
    slug: {
      type: String,
      trim: true,
      lowercase: true,
    },
    roleScopeDescription: {
      type: String,
      trim: true,
      default: "",
    },
    category: {
      type: String,
      trim: true,
      default: "",
    },
    badgeColor: {
      type: String,
      trim: true,
      default: "",
    },
    icon: {
      type: String,
      trim: true,
      default: "",
    },
    permissions: [
      {
        type: String,
        trim: true,
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    isSystemRole: {
      type: Boolean,
      default: false,
    },
    assignedUsersCount: {
      type: Number,
      default: 0,
      min: 0,
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

RoleSchema.index({ roleTitle: 1, isDeleted: 1 });
RoleSchema.index({ category: 1, isDeleted: 1 });
RoleSchema.index({ slug: 1, isDeleted: 1 });

const RoleModel = mongoose.model("Role", RoleSchema);
export default RoleModel;
