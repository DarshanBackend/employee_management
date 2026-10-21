import mongoose from "mongoose";

const OrganizationSchema = new mongoose.Schema(
  {
    companyLegalName: {
      type: String,
      required: [true, "Company full legal name is required"],
      trim: true,
      default: "Digital HRS Infotech Private Limited",
    },
    registrationNumber: {
      type: String,
      trim: true,
      default: "",
    },
    gstin: {
      type: String,
      trim: true,
      default: "",
    },
    officialEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    companyWebsite: {
      type: String,
      trim: true,
      default: "",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

const OrganizationModel = mongoose.model("Organization", OrganizationSchema);
export default OrganizationModel;
