import mongoose from "mongoose";

export const ANNOUNCEMENT_PRIORITIES = ["Low", "Normal", "High", "Urgent"];
export const ANNOUNCEMENT_STATUSES = ["Active", "Archived", "Draft"];
export const ANNOUNCEMENT_TARGET_TYPES = [
  "All Employees",
  "Department",
  "Individual",
  "Admin Only",
];

const AnnouncementSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Announcement title is required"],
      trim: true,
    },
    description: {
      type: String,
      required: [true, "Announcement description is required"],
      trim: true,
    },
    recipient: {
      type: String,
      default: "All Employees",
      trim: true,
    },
    targetType: {
      type: String,
      enum: ANNOUNCEMENT_TARGET_TYPES,
      default: "All Employees",
      index: true,
    },
    targetEmployees: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        index: true,
      },
    ],
    targetEmployee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
      index: true,
    },
    departmentName: {
      type: String,
      default: "",
      trim: true,
    },
    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    publishedByName: {
      type: String,
      default: "Admin",
      trim: true,
    },
    publishDate: {
      type: Date,
      default: Date.now,
    },
    formattedDate: {
      type: String,
      default: "",
      trim: true,
    },
    priority: {
      type: String,
      enum: ANNOUNCEMENT_PRIORITIES,
      default: "Normal",
    },
    status: {
      type: String,
      enum: ANNOUNCEMENT_STATUSES,
      default: "Active",
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    id: false,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.id;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.id;
        return ret;
      },
    },
  }
);

AnnouncementSchema.index({ recipient: 1, isDeleted: 1 });
AnnouncementSchema.index({ targetEmployees: 1, isDeleted: 1 });
AnnouncementSchema.index({ targetType: 1, isDeleted: 1 });
AnnouncementSchema.index({ createdAt: -1 });

const AnnouncementModel = mongoose.model("Announcement", AnnouncementSchema);
export default AnnouncementModel;

