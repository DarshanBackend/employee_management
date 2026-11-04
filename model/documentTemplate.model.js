import mongoose from "mongoose";

export const TEMPLATE_CATEGORIES = [
  "Recruitment",
  "Exit Management",
  "Legal & Compliance",
  "Verification",
  "HR Operations",
  "General",
];

export const TEMPLATE_STATUSES = ["Active", "Draft", "Archived"];

export const SMART_VARIABLES = [
  {
    key: "{EMPLOYEE_NAME}",
    label: "Employee Name",
    description: "Full name of the employee",
    sample: "Darshan Kalathiya",
  },
  {
    key: "{EMPLOYEE_ID}",
    label: "Employee ID",
    description: "Unique employee identification code",
    sample: "EMP-1024",
  },
  {
    key: "{DESIGNATION}",
    label: "Designation",
    description: "Current job title / position of the employee",
    sample: "Senior Full-Stack Engineer",
  },
  {
    key: "{DEPARTMENT}",
    label: "Department",
    description: "Assigned department / team",
    sample: "Information Technology",
  },
  {
    key: "{JOINING_DATE}",
    label: "Joining Date",
    description: "Date when employee officially joined company",
    sample: "15 Jan 2024",
  },
  {
    key: "{SALARY_CTC}",
    label: "Salary (Annual CTC)",
    description: "Total annual cost-to-company package",
    sample: "₹ 8,40,000",
  },
  {
    key: "{SALARY_MONTHLY}",
    label: "Salary (Monthly Gross)",
    description: "Monthly gross salary",
    sample: "₹ 70,000",
  },
  {
    key: "{REPORTING_MANAGER}",
    label: "Reporting Manager",
    description: "Assigned direct supervisor or HR manager",
    sample: "Mehul Kalathiya",
  },
  {
    key: "{WORK_LOCATION}",
    label: "Work Location",
    description: "Official workplace, branch, or Remote",
    sample: "Surat, Gujarat (Headquarters)",
  },
  {
    key: "{CURRENT_DATE}",
    label: "Current Date",
    description: "Date of document generation / issuance",
    sample: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
  },
  {
    key: "{COMPANY_NAME}",
    label: "Company Name",
    description: "Registered corporate legal entity name",
    sample: "Digital HRS Infotech Private Limited",
  },
];

const DocumentTemplateSchema = new mongoose.Schema(
  {
    templateTitle: {
      type: String,
      required: [true, "Template title is required"],
      trim: true,
      index: true,
    },
    category: {
      type: String,
      enum: {
        values: TEMPLATE_CATEGORIES,
        message: "Invalid template category",
      },
      default: "Recruitment",
      required: [true, "Template category is required"],
      index: true,
    },
    version: {
      type: String,
      default: "v1.0 (2026)",
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    bodyContent: {
      type: String,
      required: [true, "Template body content is required"],
      trim: true,
    },
    icon: {
      type: String,
      default: "file-text",
      trim: true,
    },
    badgeColor: {
      type: String,
      default: "#10B981",
      trim: true,
    },
    attachmentUrl: {
      type: String,
      default: null,
      trim: true,
    },
    attachmentName: {
      type: String,
      default: null,
      trim: true,
    },
    attachmentKey: {
      type: String,
      default: null,
      trim: true,
    },
    attachmentSize: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: TEMPLATE_STATUSES,
      default: "Active",
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
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
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

DocumentTemplateSchema.index({ category: 1, isDeleted: 1 });
DocumentTemplateSchema.index({ templateTitle: "text", description: "text" });

const DocumentTemplateModel = mongoose.model(
  "DocumentTemplate",
  DocumentTemplateSchema
);

export default DocumentTemplateModel;
