import mongoose from "mongoose";

export const PAY_FREQUENCY_OPTIONS = ["Monthly", "Bi-Weekly", "Weekly"];

export const CALCULATION_BASIS_OPTIONS = [
  "Actual Calendar Days",
  "30 Days Fixed",
  "Working Days (Excl. Weekends)",
];

export const SALARY_PAYOUT_OPTIONS = [
  "1st of next month",
  "5th of next month",
  "Last working day of month",
];

export const ATTENDANCE_CUTOFF_OPTIONS = [
  "25th of month",
  "Last day of month",
  "20th of month",
];

const PayrollSettingSchema = new mongoose.Schema(
  {
    payCycleAndSchedule: {
      payFrequency: {
        type: String,
        enum: PAY_FREQUENCY_OPTIONS,
        default: "Monthly",
        trim: true,
      },
      calculateOnBasis: {
        type: String,
        enum: CALCULATION_BASIS_OPTIONS,
        default: "Actual Calendar Days",
        trim: true,
      },
      salaryPayoutDate: {
        type: String,
        default: "1st of next month",
        trim: true,
      },
      attendanceCutoffDate: {
        type: String,
        default: "25th of month",
        trim: true,
      },
    },

    statutoryCompliance: {
      providentFund: {
        enabled: {
          type: Boolean,
          default: true,
        },
        employeeContributionRate: {
          type: Number,
          default: 12,
        },
        employerContributionRate: {
          type: Number,
          default: 12,
        },
        description: {
          type: String,
          default: "12% Employee + 12% Employer statutory deduction",
          trim: true,
        },
      },
      employeeStateInsurance: {
        enabled: {
          type: Boolean,
          default: true,
        },
        employeeContributionRate: {
          type: Number,
          default: 0.75,
        },
        employerContributionRate: {
          type: Number,
          default: 3.25,
        },
        wageCeiling: {
          type: Number,
          default: 21000,
        },
        description: {
          type: String,
          default:
            "0.75% Employee + 3.25% Employer contribution for eligible slabs",
          trim: true,
        },
      },
      professionalTax: {
        enabled: {
          type: Boolean,
          default: true,
        },
        monthlyAmount: {
          type: Number,
          default: 200,
        },
        description: {
          type: String,
          default: "State mandated deduction (₹200 / month)",
          trim: true,
        },
      },
      taxDeductedAtSource: {
        enabled: {
          type: Boolean,
          default: true,
        },
        description: {
          type: String,
          default:
            "Automated slab-wise TDS deduction according to current tax regime",
          trim: true,
        },
      },
    },

    salaryComponents: {
      basicSalaryPercentage: {
        type: Number,
        default: 40,
        min: 0,
        max: 100,
      },
      hraPercentage: {
        type: Number,
        default: 40,
        min: 0,
        max: 100,
      },
      specialAllowancePercentage: {
        type: Number,
        default: 20,
        min: 0,
        max: 100,
      },
    },

    approvalAndSecurity: {
      multiLevelAuthorization: {
        enabled: {
          type: Boolean,
          default: true,
        },
        description: {
          type: String,
          default:
            "Requires HR Manager and Finance Director sign-off before payout",
          trim: true,
        },
      },
      autoLockApprovedPayrollRuns: {
        enabled: {
          type: Boolean,
          default: true,
        },
        description: {
          type: String,
          default:
            "Prevent modifications once a monthly run has been finalized",
          trim: true,
        },
      },
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    id: false,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.id;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

const PayrollSettingModel = mongoose.model(
  "PayrollSetting",
  PayrollSettingSchema
);

export default PayrollSettingModel;
