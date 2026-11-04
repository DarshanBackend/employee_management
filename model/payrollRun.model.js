import mongoose from "mongoose";

const PayslipSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    employeeId: {
      type: String,
      default: "",
      trim: true,
    },
    name: {
      type: String,
      default: "",
      trim: true,
    },
    avatarUrl: {
      type: String,
      default: null,
    },
    department: {
      type: String,
      default: "General",
      trim: true,
    },
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
    },
    designation: {
      type: String,
      default: "Employee",
      trim: true,
    },
    designationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Designation",
      default: null,
    },
    grade: {
      type: String,
      default: "Grade SB-01",
      trim: true,
    },

    cycle: {
      type: String,
      required: true, // e.g. "April 2026"
      trim: true,
    },
    month: {
      type: String,
      required: true, // e.g. "April"
      trim: true,
    },
    year: {
      type: Number,
      required: true, // e.g. 2026
    },

    days: {
      type: String,
      default: "22/22", // worked / total days
      trim: true,
    },
    workingDays: {
      type: Number,
      default: 22,
    },
    payableDays: {
      type: Number,
      default: 22,
    },

    annualCtc: {
      type: Number,
      default: 0,
    },
    grossPay: {
      type: Number,
      default: 0,
    },

    earnings: {
      basicSalary: { type: Number, default: 0 },
      hra: { type: Number, default: 0 },
      specialAllowance: { type: Number, default: 0 },
      otherAllowances: { type: Number, default: 0 },
    },

    deductions: {
      providentFund: { type: Number, default: 0 },
      professionalTax: { type: Number, default: 200 },
      employeeStateInsurance: { type: Number, default: 0 },
      taxDeductedAtSource: { type: Number, default: 0 },
      leaveDeductions: { type: Number, default: 0 },
      totalDeductions: { type: Number, default: 0 },
    },

    netPay: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: ["Ready", "Generated", "Paid"],
      default: "Ready",
    },

    bankDetails: {
      paymentMethod: { type: String, default: "Bank Transfer" },
      bankName: { type: String, default: "" },
      accountNumber: { type: String, default: "" },
      ifscCode: { type: String, default: "" },
    },

    payoutDate: {
      type: String,
      default: "1st of next month",
    },
    generatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

const PayrollRunSchema = new mongoose.Schema(
  {
    cycle: {
      type: String,
      required: [true, "Payroll cycle is required"], // e.g. "April 2026"
      trim: true,
    },
    month: {
      type: String,
      required: [true, "Month is required"],
      trim: true,
    },
    year: {
      type: Number,
      required: [true, "Year is required"],
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
    },
    departmentName: {
      type: String,
      default: "All Departments",
      trim: true,
    },

    indicators: {
      attendanceSynchronized: {
        type: Boolean,
        default: true,
      },
      leavesAccounted: {
        type: Boolean,
        default: true,
      },
      taxSlabsCalculated: {
        type: Boolean,
        default: true,
      },
    },

    grossTotal: {
      type: Number,
      default: 0,
    },
    totalDeductions: {
      type: Number,
      default: 0,
    },
    netDisbursement: {
      type: Number,
      default: 0,
    },
    totalEmployees: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: ["Draft", "Ready", "Completed"],
      default: "Completed",
    },

    executedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    executedAt: {
      type: Date,
      default: Date.now,
    },

    payslips: [PayslipSchema],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

PayrollRunSchema.index({ cycle: 1, department: 1 });

const PayrollRunModel = mongoose.model("PayrollRun", PayrollRunSchema);
export default PayrollRunModel;
