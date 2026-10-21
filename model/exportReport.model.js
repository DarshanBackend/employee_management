import mongoose from "mongoose";

export const DATA_CATEGORIES = [
  "Employees Directory",
  "Attendance Log",
  "Leave Requests & Quotas",
  "Payroll & Salary Register",
  "Task Assignments",
];

export const OUTPUT_FORMATS = [
  "Excel Spreadsheet (.xlsx)",
  "CSV Document (.csv)",
  "PDF Report (.pdf)",
];

export const DATE_RANGES = [
  "Current Month (October 2026)",
  "Last 3 Months (Q3)",
  "Year-to-Date (2026)",
  "All Time Records",
];

const ExportReportSchema = new mongoose.Schema(
  {
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    dataCategory: {
      type: String,
      required: true,
      trim: true,
    },
    outputFormat: {
      type: String,
      required: true,
      trim: true,
    },
    formatType: {
      type: String,
      enum: ["xlsx", "csv", "pdf"],
      default: "xlsx",
    },
    dateRange: {
      type: String,
      default: "Current Month (October 2026)",
      trim: true,
    },
    department: {
      type: String,
      default: "All Departments",
      trim: true,
    },
    includeArchived: {
      type: Boolean,
      default: false,
    },
    fileSize: {
      type: String,
      default: "1.0 MB",
      trim: true,
    },
    fileSizeBytes: {
      type: Number,
      default: 0,
    },
    totalRecords: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["Completed", "Processing", "Failed"],
      default: "Completed",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.__v;
        return ret;
      },
    },
  }
);

const ExportReportModel = mongoose.model("ExportReport", ExportReportSchema);
export default ExportReportModel;
