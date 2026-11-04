import mongoose from "mongoose";

export const DOCUMENT_CATEGORIES = [
  "Identity Proof",
  "Contracts",
  "Tax & Compliance",
  "Certificates",
];

export const VERIFICATION_STATUSES = [
  "Verified",
  "Pending Review",
  "Rejected",
];

const DocumentSchema = new mongoose.Schema(
  {
    documentTitle: {
      type: String,
      required: [true, "Document title is required"],
      trim: true,
    },
    documentCategory: {
      type: String,
      enum: DOCUMENT_CATEGORIES,
      required: [true, "Document category is required"],
      default: "Identity Proof",
      trim: true,
    },
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Assigned employee is required"],
      index: true,
    },
    fileName: {
      type: String,
      required: [true, "File name is required"],
      trim: true,
    },
    fileUrl: {
      type: String,
      required: [true, "File URL is required"],
      trim: true,
    },
    fileKey: {
      type: String,
      default: "",
      trim: true,
    },
    fileSize: {
      type: Number,
      default: 0,
    },
    formattedSize: {
      type: String,
      default: "",
      trim: true,
    },
    fileType: {
      type: String,
      default: "pdf",
      trim: true,
    },
    mimeType: {
      type: String,
      default: "application/pdf",
      trim: true,
    },
    verificationStatus: {
      type: String,
      enum: VERIFICATION_STATUSES,
      default: "Pending Review",
      trim: true,
      index: true,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    rejectionReason: {
      type: String,
      default: "",
      trim: true,
    },
    badgeColor: {
      type: String,
      default: "#10B981",
      trim: true,
    },
    icon: {
      type: String,
      default: "id-card",
      trim: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
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

DocumentSchema.index({ documentCategory: 1, isDeleted: 1 });
DocumentSchema.index({ employee: 1, isDeleted: 1 });
DocumentSchema.index({ verificationStatus: 1, isDeleted: 1 });

const DocumentModel = mongoose.model("Document", DocumentSchema);
export default DocumentModel;
