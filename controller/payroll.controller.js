import PayrollSettingModel, {
  PAY_FREQUENCY_OPTIONS,
  CALCULATION_BASIS_OPTIONS,
  SALARY_PAYOUT_OPTIONS,
  ATTENDANCE_CUTOFF_OPTIONS,
} from "../model/payrollSetting.model.js";
import { recordAuditLog } from "../utils/auditLogger.js";
import {
  sendSuccessResponse,
  sendErrorResponse,
  sendBadRequestResponse,
} from "../utils/Response.utils.js";

const getOrCreatePayrollSetting = async (userId = null) => {
  let settings = await PayrollSettingModel.findOne().populate(
    "updatedBy",
    "name firstName lastName email role"
  );

  if (!settings) {
    settings = await PayrollSettingModel.create({
      updatedBy: userId,
    });
  }

  return settings;
};

const formatSettingsResponse = (settings) => {
  const plain = settings.toObject ? settings.toObject() : { ...settings };
  return {
    ...plain,
    dropdownOptions: {
      payFrequency: PAY_FREQUENCY_OPTIONS,
      calculateOnBasis: CALCULATION_BASIS_OPTIONS,
      salaryPayoutDate: SALARY_PAYOUT_OPTIONS,
      attendanceCutoffDate: ATTENDANCE_CUTOFF_OPTIONS,
    },
  };
};

export class PayrollController {
  static async getPayrollSettings(req, res) {
    try {
      const settings = await getOrCreatePayrollSetting(req.user?._id);
      return sendSuccessResponse(
        res,
        "Payroll settings fetched successfully",
        formatSettingsResponse(settings)
      );
    } catch (error) {
      console.error("Get Payroll Settings Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch payroll settings", error);
    }
  }

  static async updatePayrollSettings(req, res) {
    try {
      const settings = await getOrCreatePayrollSetting(req.user?._id);
      const {
        payCycleAndSchedule,
        payCycle,
        statutoryCompliance,
        salaryComponents,
        salaryStructure,
        approvalAndSecurity,
        approvalPolicies,

        payFrequency,
        calculateOnBasis,
        salaryPayoutDate,
        attendanceCutoffDate,

        providentFund,
        enableProvidentFund,
        pf,

        employeeStateInsurance,
        enableESI,
        esi,

        professionalTax,
        enablePT,
        pt,

        taxDeductedAtSource,
        enableTDS,
        tds,

        basicSalaryPercentage,
        hraPercentage,
        specialAllowancePercentage,

        multiLevelAuthorization,
        enableMultiLevelAuthorization,

        autoLockApprovedPayrollRuns,
        enableAutoLockApprovedPayrollRuns,
      } = req.body;

      const payCycleData = payCycleAndSchedule || payCycle || {};
      const targetFrequency = payCycleData.payFrequency ?? payFrequency;
      if (targetFrequency !== undefined) {
        if (!PAY_FREQUENCY_OPTIONS.includes(targetFrequency)) {
          return sendBadRequestResponse(
            res,
            `Invalid pay frequency. Allowed: ${PAY_FREQUENCY_OPTIONS.join(", ")}`
          );
        }
        settings.payCycleAndSchedule.payFrequency = targetFrequency;
      }

      const targetBasis = payCycleData.calculateOnBasis ?? calculateOnBasis;
      if (targetBasis !== undefined) {
        if (!CALCULATION_BASIS_OPTIONS.includes(targetBasis)) {
          return sendBadRequestResponse(
            res,
            `Invalid calculation basis. Allowed: ${CALCULATION_BASIS_OPTIONS.join(", ")}`
          );
        }
        settings.payCycleAndSchedule.calculateOnBasis = targetBasis;
      }

      const targetPayoutDate =
        payCycleData.salaryPayoutDate ?? salaryPayoutDate;
      if (targetPayoutDate !== undefined && String(targetPayoutDate).trim()) {
        settings.payCycleAndSchedule.salaryPayoutDate = String(
          targetPayoutDate
        ).trim();
      }

      const targetCutoffDate =
        payCycleData.attendanceCutoffDate ?? attendanceCutoffDate;
      if (targetCutoffDate !== undefined && String(targetCutoffDate).trim()) {
        settings.payCycleAndSchedule.attendanceCutoffDate = String(
          targetCutoffDate
        ).trim();
      }

      const statutoryData = statutoryCompliance || {};

      const pfInput =
        statutoryData.providentFund ??
        providentFund ??
        enableProvidentFund ??
        pf;
      if (pfInput !== undefined) {
        if (typeof pfInput === "boolean") {
          settings.statutoryCompliance.providentFund.enabled = pfInput;
        } else if (typeof pfInput === "object" && pfInput !== null) {
          if (pfInput.enabled !== undefined) {
            settings.statutoryCompliance.providentFund.enabled = Boolean(
              pfInput.enabled
            );
          }
          if (pfInput.employeeContributionRate !== undefined) {
            settings.statutoryCompliance.providentFund.employeeContributionRate =
              Number(pfInput.employeeContributionRate);
          }
          if (pfInput.employerContributionRate !== undefined) {
            settings.statutoryCompliance.providentFund.employerContributionRate =
              Number(pfInput.employerContributionRate);
          }
        }
      }

      const esiInput =
        statutoryData.employeeStateInsurance ??
        employeeStateInsurance ??
        enableESI ??
        esi;
      if (esiInput !== undefined) {
        if (typeof esiInput === "boolean") {
          settings.statutoryCompliance.employeeStateInsurance.enabled = esiInput;
        } else if (typeof esiInput === "object" && esiInput !== null) {
          if (esiInput.enabled !== undefined) {
            settings.statutoryCompliance.employeeStateInsurance.enabled =
              Boolean(esiInput.enabled);
          }
          if (esiInput.employeeContributionRate !== undefined) {
            settings.statutoryCompliance.employeeStateInsurance.employeeContributionRate =
              Number(esiInput.employeeContributionRate);
          }
          if (esiInput.employerContributionRate !== undefined) {
            settings.statutoryCompliance.employeeStateInsurance.employerContributionRate =
              Number(esiInput.employerContributionRate);
          }
          if (esiInput.wageCeiling !== undefined) {
            settings.statutoryCompliance.employeeStateInsurance.wageCeiling =
              Number(esiInput.wageCeiling);
          }
        }
      }

      const ptInput =
        statutoryData.professionalTax ??
        professionalTax ??
        enablePT ??
        pt;
      if (ptInput !== undefined) {
        if (typeof ptInput === "boolean") {
          settings.statutoryCompliance.professionalTax.enabled = ptInput;
        } else if (typeof ptInput === "object" && ptInput !== null) {
          if (ptInput.enabled !== undefined) {
            settings.statutoryCompliance.professionalTax.enabled = Boolean(
              ptInput.enabled
            );
          }
          if (ptInput.monthlyAmount !== undefined) {
            settings.statutoryCompliance.professionalTax.monthlyAmount =
              Number(ptInput.monthlyAmount);
          }
        }
      }

      const tdsInput =
        statutoryData.taxDeductedAtSource ??
        taxDeductedAtSource ??
        enableTDS ??
        tds;
      if (tdsInput !== undefined) {
        if (typeof tdsInput === "boolean") {
          settings.statutoryCompliance.taxDeductedAtSource.enabled = tdsInput;
        } else if (typeof tdsInput === "object" && tdsInput !== null) {
          if (tdsInput.enabled !== undefined) {
            settings.statutoryCompliance.taxDeductedAtSource.enabled = Boolean(
              tdsInput.enabled
            );
          }
        }
      }

      const salaryData = salaryComponents || salaryStructure || {};
      const targetBasic =
        salaryData.basicSalaryPercentage ?? basicSalaryPercentage;
      if (targetBasic !== undefined) {
        const val = Number(targetBasic);
        if (isNaN(val) || val < 0 || val > 100) {
          return sendBadRequestResponse(
            res,
            "Basic Salary percentage must be between 0 and 100"
          );
        }
        settings.salaryComponents.basicSalaryPercentage = val;
      }

      const targetHra = salaryData.hraPercentage ?? hraPercentage;
      if (targetHra !== undefined) {
        const val = Number(targetHra);
        if (isNaN(val) || val < 0 || val > 100) {
          return sendBadRequestResponse(
            res,
            "HRA percentage must be between 0 and 100"
          );
        }
        settings.salaryComponents.hraPercentage = val;
      }

      const targetSpecial =
        salaryData.specialAllowancePercentage ?? specialAllowancePercentage;
      if (targetSpecial !== undefined) {
        const val = Number(targetSpecial);
        if (!isNaN(val) && val >= 0 && val <= 100) {
          settings.salaryComponents.specialAllowancePercentage = val;
        }
      }

      const approvalData = approvalAndSecurity || approvalPolicies || {};

      const multiAuthInput =
        approvalData.multiLevelAuthorization ??
        multiLevelAuthorization ??
        enableMultiLevelAuthorization;
      if (multiAuthInput !== undefined) {
        if (typeof multiAuthInput === "boolean") {
          settings.approvalAndSecurity.multiLevelAuthorization.enabled =
            multiAuthInput;
        } else if (
          typeof multiAuthInput === "object" &&
          multiAuthInput !== null &&
          multiAuthInput.enabled !== undefined
        ) {
          settings.approvalAndSecurity.multiLevelAuthorization.enabled =
            Boolean(multiAuthInput.enabled);
        }
      }

      const autoLockInput =
        approvalData.autoLockApprovedPayrollRuns ??
        autoLockApprovedPayrollRuns ??
        enableAutoLockApprovedPayrollRuns;
      if (autoLockInput !== undefined) {
        if (typeof autoLockInput === "boolean") {
          settings.approvalAndSecurity.autoLockApprovedPayrollRuns.enabled =
            autoLockInput;
        } else if (
          typeof autoLockInput === "object" &&
          autoLockInput !== null &&
          autoLockInput.enabled !== undefined
        ) {
          settings.approvalAndSecurity.autoLockApprovedPayrollRuns.enabled =
            Boolean(autoLockInput.enabled);
        }
      }

      settings.updatedBy = req.user?._id || null;
      await settings.save();

      await recordAuditLog(req, {
        action: "Updated Payroll Settings",
        category: "Payroll",
        description: `Updated payroll cycle (${settings.payCycleAndSchedule?.payFrequency || "Monthly"}) and statutory rules`,
        targetResource: "Company Payroll Settings",
        diff: {
          before: "Previous Payroll Configuration",
          after: `Pay Frequency: ${settings.payCycleAndSchedule?.payFrequency || "Monthly"}, Basic: ${settings.salaryComponents?.basicSalaryPercentage || 40}%`,
        },
      });

      return sendSuccessResponse(
        res,
        "Payroll settings updated successfully",
        formatSettingsResponse(settings)
      );
    } catch (error) {
      console.error("Update Payroll Settings Error:", error);
      return sendErrorResponse(res, 500, "Failed to update payroll settings", error);
    }
  }

  static async calculateSalaryBreakdown(req, res) {
    try {
      const { ctc, annualCtc, monthlyCtc, isMonthly } = req.body;

      let yearlyCtc = 0;
      if (annualCtc !== undefined) {
        yearlyCtc = Number(annualCtc);
      } else if (monthlyCtc !== undefined) {
        yearlyCtc = Number(monthlyCtc) * 12;
      } else if (ctc !== undefined) {
        yearlyCtc = isMonthly ? Number(ctc) * 12 : Number(ctc);
      }

      if (!yearlyCtc || isNaN(yearlyCtc) || yearlyCtc <= 0) {
        return sendBadRequestResponse(
          res,
          "Please provide a valid numeric CTC (ctc, annualCtc, or monthlyCtc)"
        );
      }

      const settings = await getOrCreatePayrollSetting(req.user?._id);

      const monthlyGross = Math.round(yearlyCtc / 12);

      const basicPercent =
        settings.salaryComponents?.basicSalaryPercentage || 40;
      const monthlyBasic = Math.round((monthlyGross * basicPercent) / 100);

      const hraPercent = settings.salaryComponents?.hraPercentage || 40;
      const monthlyHra = Math.round((monthlyBasic * hraPercent) / 100);

      let monthlySpecial = monthlyGross - (monthlyBasic + monthlyHra);
      if (monthlySpecial < 0) monthlySpecial = 0;

      let pfEmployee = 0;
      let pfEmployer = 0;
      if (settings.statutoryCompliance?.providentFund?.enabled) {
        const empRate =
          settings.statutoryCompliance.providentFund.employeeContributionRate ||
          12;
        const orgRate =
          settings.statutoryCompliance.providentFund.employerContributionRate ||
          12;
        pfEmployee = Math.round((monthlyBasic * empRate) / 100);
        pfEmployer = Math.round((monthlyBasic * orgRate) / 100);
      }

      let esiEmployee = 0;
      let esiEmployer = 0;
      const wageCeiling =
        settings.statutoryCompliance?.employeeStateInsurance?.wageCeiling ||
        21000;
      if (
        settings.statutoryCompliance?.employeeStateInsurance?.enabled &&
        monthlyGross <= wageCeiling
      ) {
        const empRate =
          settings.statutoryCompliance.employeeStateInsurance
            .employeeContributionRate || 0.75;
        const orgRate =
          settings.statutoryCompliance.employeeStateInsurance
            .employerContributionRate || 3.25;
        esiEmployee = Math.round((monthlyGross * empRate) / 100);
        esiEmployer = Math.round((monthlyGross * orgRate) / 100);
      }

      let professionalTax = 0;
      if (settings.statutoryCompliance?.professionalTax?.enabled) {
        professionalTax =
          settings.statutoryCompliance.professionalTax.monthlyAmount || 200;
      }

      let estimatedTds = 0;
      if (settings.statutoryCompliance?.taxDeductedAtSource?.enabled) {
        if (yearlyCtc > 700000) {
          const taxablePortion = yearlyCtc - 700000;
          estimatedTds = Math.round((taxablePortion * 0.1) / 12);
        }
      }

      const totalEmployeeDeductions =
        pfEmployee + esiEmployee + professionalTax + estimatedTds;
      const netTakeHome = monthlyGross - totalEmployeeDeductions;

      return sendSuccessResponse(res, "Salary breakdown calculated successfully", {
        summary: {
          annualCtc: yearlyCtc,
          monthlyCtc: monthlyGross,
          monthlyGrossSalary: monthlyGross,
          totalEmployeeDeductions,
          netTakeHomeSalary: netTakeHome,
        },
        earnings: {
          basicSalary: monthlyBasic,
          hra: monthlyHra,
          specialAllowance: monthlySpecial,
          grossMonthlySalary: monthlyGross,
        },
        deductions: {
          providentFund: {
            enabled: settings.statutoryCompliance?.providentFund?.enabled,
            employeeShare: pfEmployee,
            employerShare: pfEmployer,
          },
          employeeStateInsurance: {
            enabled:
              settings.statutoryCompliance?.employeeStateInsurance?.enabled,
            eligible: monthlyGross <= wageCeiling,
            employeeShare: esiEmployee,
            employerShare: esiEmployer,
          },
          professionalTax: {
            enabled: settings.statutoryCompliance?.professionalTax?.enabled,
            amount: professionalTax,
          },
          taxDeductedAtSource: {
            enabled:
              settings.statutoryCompliance?.taxDeductedAtSource?.enabled,
            estimatedMonthlyTds: estimatedTds,
          },
          totalDeductions: totalEmployeeDeductions,
        },
        appliedSettings: {
          payFrequency: settings.payCycleAndSchedule?.payFrequency,
          calculateOnBasis: settings.payCycleAndSchedule?.calculateOnBasis,
          salaryPayoutDate: settings.payCycleAndSchedule?.salaryPayoutDate,
          attendanceCutoffDate:
            settings.payCycleAndSchedule?.attendanceCutoffDate,
          basicSalaryPercentage: basicPercent,
          hraPercentage: hraPercent,
        },
      });
    } catch (error) {
      console.error("Calculate Salary Breakdown Error:", error);
      return sendErrorResponse(res, 500, "Failed to calculate salary breakdown", error);
    }
  }
}
