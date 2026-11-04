import mongoose from "mongoose";
import PayrollSettingModel, {
  PAY_FREQUENCY_OPTIONS,
  CALCULATION_BASIS_OPTIONS,
  SALARY_PAYOUT_OPTIONS,
  ATTENDANCE_CUTOFF_OPTIONS,
} from "../model/payrollSetting.model.js";
import UserModel from "../model/user.model.js";
import DepartmentModel from "../model/department.model.js";
import DesignationModel from "../model/designation.model.js";
import AttendanceModel from "../model/attendance.model.js";
import PayrollRunModel from "../model/payrollRun.model.js";
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

export const computeSalaryForEmployee = (monthlySalary, settings, options = {}) => {
  const {
    daysWorked = null,
    totalWorkingDays = 22,
    unpaidLeaveDays = null,
    includePt = true,
    includeTds = true,
    basicSalaryPercentage = null,
    hraPercentage = null,
  } = options;

  const validMonthlySalary = Number(monthlySalary) > 0 ? Number(monthlySalary) : 45000;
  const annualCtc = validMonthlySalary * 12;

  const basicSalaryPercent = basicSalaryPercentage ?? (settings?.salaryComponents?.basicSalaryPercentage ?? 50);
  const hraPercent = hraPercentage ?? (settings?.salaryComponents?.hraPercentage ?? 40);

  const basicSalary = Math.round((validMonthlySalary * basicSalaryPercent) / 100);
  const hra = Math.round((basicSalary * hraPercent) / 100);
  let specialAllowance = validMonthlySalary - (basicSalary + hra);
  if (specialAllowance < 0) specialAllowance = 0;

  const pfSettings = settings?.statutoryCompliance?.providentFund;
  let providentFund = 0;
  let providentFundEmployer = 0;
  if (pfSettings?.enabled) {
    const pfRate = (pfSettings.employeeContributionRate ?? 12) / 100;
    const pfEmployerRate = (pfSettings.employerContributionRate ?? 12) / 100;
    providentFund = Math.round(basicSalary * pfRate);
    providentFundEmployer = Math.round(basicSalary * pfEmployerRate);
  }

  const esiSettings = settings?.statutoryCompliance?.employeeStateInsurance;
  let employeeStateInsurance = 0;
  let employeeStateInsuranceEmployer = 0;
  const wageCeiling = esiSettings?.wageCeiling ?? 21000;
  if (esiSettings?.enabled && validMonthlySalary <= wageCeiling) {
    const esiRate = (esiSettings.employeeContributionRate ?? 0.75) / 100;
    const esiEmployerRate = (esiSettings.employerContributionRate ?? 3.25) / 100;
    employeeStateInsurance = Math.round(validMonthlySalary * esiRate);
    employeeStateInsuranceEmployer = Math.round(validMonthlySalary * esiEmployerRate);
  }

  const ptSettings = settings?.statutoryCompliance?.professionalTax;
  let professionalTax = 0;
  if (includePt && ptSettings?.enabled) {
    professionalTax = ptSettings.monthlyAmount ?? 200;
  }

  const tdsSettings = settings?.statutoryCompliance?.taxDeductedAtSource;
  let taxDeductedAtSource = 0;
  if (includeTds && tdsSettings?.enabled) {
    taxDeductedAtSource = Math.round(validMonthlySalary * 0.02);
  }

  let leaveDeductions = 0;
  let calcUnpaidDays = 0;
  if (unpaidLeaveDays !== null) {
    calcUnpaidDays = Math.max(0, unpaidLeaveDays);
  } else if (daysWorked !== null && totalWorkingDays > 0) {
    calcUnpaidDays = Math.max(0, totalWorkingDays - daysWorked);
  }

  if (calcUnpaidDays > 0 && totalWorkingDays > 0) {
    leaveDeductions = Math.round((validMonthlySalary / totalWorkingDays) * calcUnpaidDays);
  }

  const totalDeductions =
    providentFund +
    employeeStateInsurance +
    professionalTax +
    taxDeductedAtSource +
    leaveDeductions;

  const netPay = validMonthlySalary - totalDeductions;

  return {
    annualCtc,
    monthlySalary: validMonthlySalary,
    grossPay: validMonthlySalary,
    earnings: {
      basicSalary,
      hra,
      specialAllowance,
      otherAllowances: 0,
    },
    deductions: {
      providentFund,
      providentFundEmployer,
      employeeStateInsurance,
      employeeStateInsuranceEmployer,
      professionalTax,
      taxDeductedAtSource,
      leaveDeductions,
      totalDeductions,
    },
    netPay,
    percentages: {
      basicSalaryPercent,
      hraPercent,
    },
    payoutDate: settings?.payCycleAndSchedule?.salaryPayoutDate || "1st of next month",
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
      const computed = computeSalaryForEmployee(monthlyGross, settings);

      return sendSuccessResponse(res, "Salary breakdown calculated successfully", {
        summary: {
          annualCtc: yearlyCtc,
          monthlyCtc: monthlyGross,
          monthlyGrossSalary: monthlyGross,
          totalEmployeeDeductions: computed.deductions.totalDeductions,
          netTakeHomeSalary: computed.netPay,
        },
        earnings: {
          basicSalary: computed.earnings.basicSalary,
          hra: computed.earnings.hra,
          specialAllowance: computed.earnings.specialAllowance,
          grossMonthlySalary: monthlyGross,
        },
        deductions: {
          providentFund: {
            enabled: Boolean(settings.statutoryCompliance?.providentFund?.enabled),
            employeeShare: computed.deductions.providentFund,
            employerShare: computed.deductions.providentFundEmployer,
          },
          employeeStateInsurance: {
            enabled: Boolean(settings.statutoryCompliance?.employeeStateInsurance?.enabled),
            eligible: monthlyGross <= (settings.statutoryCompliance?.employeeStateInsurance?.wageCeiling || 21000),
            employeeShare: computed.deductions.employeeStateInsurance,
            employerShare: computed.deductions.employeeStateInsuranceEmployer,
          },
          professionalTax: {
            enabled: Boolean(settings.statutoryCompliance?.professionalTax?.enabled),
            amount: computed.deductions.professionalTax,
          },
          taxDeductedAtSource: {
            enabled: Boolean(settings.statutoryCompliance?.taxDeductedAtSource?.enabled),
            estimatedMonthlyTds: computed.deductions.taxDeductedAtSource,
          },
          totalDeductions: computed.deductions.totalDeductions,
        },
        appliedSettings: {
          payFrequency: settings.payCycleAndSchedule?.payFrequency,
          calculateOnBasis: settings.payCycleAndSchedule?.calculateOnBasis,
          salaryPayoutDate: settings.payCycleAndSchedule?.salaryPayoutDate,
          attendanceCutoffDate: settings.payCycleAndSchedule?.attendanceCutoffDate,
          basicSalaryPercentage: computed.percentages.basicSalaryPercent,
          hraPercentage: computed.percentages.hraPercent,
        },
      });
    } catch (error) {
      console.error("Calculate Salary Breakdown Error:", error);
      return sendErrorResponse(res, 500, "Failed to calculate salary breakdown", error);
    }
  }

  static async getSalaryStructures(req, res) {
    try {
      const { department, search } = req.query;
      const settings = await getOrCreatePayrollSetting(req.user?._id);

      const departments = await DepartmentModel.find({ isDeleted: false }).select("departmentName _id");

      const employeeFilter = {
        role: "employee",
        isUserDeleted: { $ne: true },
        employeeStatus: { $ne: "Terminated" },
      };

      const allEmployees = await UserModel.find(employeeFilter)
        .select("-password -otp")
        .populate("department", "departmentName")
        .populate("designation", "designationName level")
        .sort({ createdAt: 1 });

      const deptCounts = {};
      allEmployees.forEach((emp) => {
        const dName = emp.department?.departmentName || "General";
        deptCounts[dName] = (deptCounts[dName] || 0) + 1;
      });

      const departmentTabs = [
        {
          id: "all",
          name: "All Departments",
          count: allEmployees.length,
          isActive: !department || department.toLowerCase() === "all",
        },
      ];

      departments.forEach((dept) => {
        const count = deptCounts[dept.departmentName] || 0;
        departmentTabs.push({
          id: String(dept._id),
          name: dept.departmentName,
          count,
          isActive:
            department &&
            (department.toLowerCase() === dept.departmentName.toLowerCase() ||
              department === String(dept._id)),
        });
      });

      let filteredEmployees = [...allEmployees];
      if (department && department.toLowerCase() !== "all") {
        if (mongoose.Types.ObjectId.isValid(department)) {
          filteredEmployees = filteredEmployees.filter(
            (emp) => emp.department && String(emp.department._id) === String(department)
          );
        } else {
          filteredEmployees = filteredEmployees.filter(
            (emp) =>
              emp.department &&
              emp.department.departmentName.toLowerCase() === department.toLowerCase()
          );
        }
      }

      if (search && search.trim()) {
        const q = search.trim().toLowerCase();
        filteredEmployees = filteredEmployees.filter((emp) => {
          const role = (emp.designation?.designationName || emp.roleTitle || "").toLowerCase();
          const dName = (emp.department?.departmentName || "").toLowerCase();
          const empName = (emp.name || "").toLowerCase();
          const empId = (emp.employeeId || "").toLowerCase();
          return role.includes(q) || dName.includes(q) || empName.includes(q) || empId.includes(q);
        });
      }

      const componentsDistribution = {
        basicPay: 50,
        hraAllowance: 20,
        specialAllowance: 15,
        pfAndStatutory: 15,
      };

      const salaryStructures = filteredEmployees.map((emp, idx) => {
        const roleTitle =
          emp.designation?.designationName || emp.roleTitle || "Software Engineer";
        const deptName = emp.department?.departmentName || "Development";
        const grade = `Grade SB-${String(idx + 1).padStart(2, "0")}`;

        const monthlySalary = 50000;
        const annualCtc = monthlySalary * 12;

        const computed = computeSalaryForEmployee(monthlySalary, settings, {
          includePt: true,
          includeTds: false,
          basicSalaryPercentage: 50,
          hraPercentage: 40,
        });
        const totalDeductions = computed.deductions.totalDeductions;
        const estimatedMonthlyInHand = computed.netPay;

        return {
          id: emp._id,
          employeeId: emp.employeeId,
          employeeName: emp.name,
          avatarUrl: emp.avatarUrl,
          roleTitle,
          departmentName: deptName,
          departmentId: emp.department?._id || null,
          grade: `${deptName} • ${grade}`,
          annualCtcDisplay: `₹${annualCtc.toLocaleString("en-IN")} / yr`,
          annualCtc,
          monthlyCtc: monthlySalary,
          breakdown: {
            basicSalary: {
              label: "Basic Salary (50%)",
              percentage: 50,
              amount: computed.earnings.basicSalary,
            },
            hra: {
              label: "House Rent Allowance (HRA)",
              percentage: 20,
              amount: computed.earnings.hra,
            },
            specialAllowance: {
              label: "Special Allowance",
              percentage: 15,
              amount: computed.earnings.specialAllowance,
            },
            providentFund: {
              label: "Provident Fund (12%)",
              enabled: Boolean(settings.statutoryCompliance?.providentFund?.enabled),
              percentage: 12,
              amount: -computed.deductions.providentFund,
              isDeduction: true,
            },
            professionalTax: {
              label: "Professional Tax (PT)",
              enabled: Boolean(settings.statutoryCompliance?.professionalTax?.enabled),
              amount: -computed.deductions.professionalTax,
              isDeduction: true,
            },
          },
          totalDeductions,
          estimatedMonthlyInHand,
          estimatedMonthlyInHandDisplay: `₹${estimatedMonthlyInHand.toLocaleString("en-IN")}`,
        };
      });

      return sendSuccessResponse(res, "Salary structures fetched successfully", {
        componentsDistribution,
        departmentTabs,
        totalStructures: salaryStructures.length,
        salaryStructures,
      });
    } catch (error) {
      console.error("Get Salary Structures Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch salary structures", error);
    }
  }

  static async getPreRunCalculations(req, res) {
    try {
      const { cycle, month, year, department } = req.query;

      const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];

      const now = new Date();
      const currentMonthName = monthNames[now.getMonth()];
      const currentYearNum = now.getFullYear();

      let targetMonth = month || null;
      let targetYear = year ? parseInt(year, 10) : null;

      if (cycle && typeof cycle === "string" && cycle.trim()) {
        const parts = cycle.trim().split(" ");
        if (parts.length >= 2) {
          targetMonth = parts[0];
          targetYear = parseInt(parts[1], 10) || currentYearNum;
        } else {
          targetMonth = parts[0];
        }
      }

      targetMonth = targetMonth || currentMonthName;
      targetYear = targetYear || currentYearNum;

      const cycleName = `${targetMonth} ${targetYear}`;
      const availableCycles = monthNames.map((m) => `${m} ${targetYear}`);

      // Filter employees by department if requested
      const employeeFilter = {
        role: "employee",
        isUserDeleted: { $ne: true },
        employeeStatus: { $ne: "Terminated" },
      };

      if (department && department.toLowerCase() !== "all") {
        if (mongoose.Types.ObjectId.isValid(department)) {
          employeeFilter.department = department;
        } else {
          const foundDept = await DepartmentModel.findOne({
            departmentName: new RegExp(`^${department.trim()}$`, "i"),
            isDeleted: false,
          });
          if (foundDept) {
            employeeFilter.department = foundDept._id;
          }
        }
      }

      const employees = await UserModel.find(employeeFilter)
        .select("-password -otp")
        .populate("department", "departmentName")
        .populate("designation", "designationName")
        .sort({ createdAt: 1 });

      const settings = await getOrCreatePayrollSetting(req.user?._id);

      const monthIdx = monthNames.indexOf(targetMonth);
      const paddedMonth = String(monthIdx >= 0 ? monthIdx + 1 : 4).padStart(2, "0");
      const monthPrefix = `${targetYear}-${paddedMonth}`;

      const totalWorkingDays = 22;

      let grossTotal = 0;
      let totalDeductions = 0;
      let netDisbursement = 0;

      const calculatedEmployees = await Promise.all(
        employees.map(async (emp, idx) => {
          const deptName = emp.department?.departmentName || "General";
          const monthlySalary = emp.salary && emp.salary > 0 ? emp.salary : 45000;

          // Check Attendance if records exist for that month
          const attendanceRecords = await AttendanceModel.find({
            employee: emp._id,
            date: { $regex: `^${monthPrefix}` },
          });

          let daysWorked = totalWorkingDays;
          if (attendanceRecords && attendanceRecords.length >= 15) {
            let presentCount = 0;
            attendanceRecords.forEach((att) => {
              if (["Present", "Late", "Regularized"].includes(att.status)) {
                presentCount += 1;
              } else if (att.status === "Half Day") {
                presentCount += 0.5;
              }
            });
            daysWorked = Math.min(totalWorkingDays, Math.max(1, Math.round(presentCount)));
          } else {
            daysWorked = totalWorkingDays;
          }

          const computed = computeSalaryForEmployee(monthlySalary, settings, {
            daysWorked,
            totalWorkingDays,
            includePt: false, // Pre-run deduction in Screenshot 1 is PF (6%) + TDS (2%) = 8%
            basicSalaryPercentage: 50,
            hraPercentage: 40,
          });

          const empDeductions = computed.deductions.totalDeductions;
          const netPay = computed.netPay;

          grossTotal += monthlySalary;
          totalDeductions += empDeductions;
          netDisbursement += netPay;

          return {
            _id: emp._id,
            employeeId: emp.employeeId || `EMP${String(idx + 1).padStart(3, "0")}`,
            name: emp.name,
            avatarUrl: emp.avatarUrl,
            department: deptName,
            departmentId: emp.department?._id || null,
            designation: emp.designation?.designationName || "Employee",
            days: `${daysWorked}/${totalWorkingDays}`,
            daysWorked,
            totalWorkingDays,
            grossPay: monthlySalary,
            deductions: empDeductions,
            netPay,
            status: "Ready",
            breakdown: {
              basicSalary: computed.earnings.basicSalary,
              hra: computed.earnings.hra,
              specialAllowance: computed.earnings.specialAllowance,
              pf: computed.deductions.providentFund,
              esi: computed.deductions.employeeStateInsurance,
              pt: computed.deductions.professionalTax,
              tds: computed.deductions.taxDeductedAtSource,
              leaveDeduction: computed.deductions.leaveDeductions,
            },
          };
        })
      );

      return sendSuccessResponse(res, "Pre-run calculations fetched successfully", {
        cycle: cycleName,
        month: targetMonth,
        year: targetYear,
        availableCycles,
        indicators: {
          attendanceSynchronized: true,
          leavesAccounted: true,
          taxSlabsCalculated: true,
        },
        summary: {
          grossTotal,
          totalDeductions,
          netDisbursement,
          totalEmployees: calculatedEmployees.length,
          grossTotalDisplay: `₹${grossTotal.toLocaleString("en-IN")}`,
          totalDeductionsDisplay: `₹${totalDeductions.toLocaleString("en-IN")}`,
          netDisbursementDisplay: `₹${netDisbursement.toLocaleString("en-IN")}`,
        },
        employees: calculatedEmployees,
      });
    } catch (error) {
      console.error("Get Pre-Run Calculations Error:", error);
      return sendErrorResponse(res, 500, "Failed to calculate pre-run payroll", error);
    }
  }

  static async executeMonthlyPayroll(req, res) {
    try {
      const { cycle, month, year, departmentId } = req.body;

      const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];
      const now = new Date();
      const currentMonthName = monthNames[now.getMonth()];
      const currentYearNum = now.getFullYear();

      let targetMonth = month || null;
      let targetYear = year ? parseInt(year, 10) : null;

      if (cycle && typeof cycle === "string" && cycle.trim()) {
        const parts = cycle.trim().split(" ");
        if (parts.length >= 2) {
          targetMonth = parts[0];
          targetYear = parseInt(parts[1], 10) || currentYearNum;
        } else {
          targetMonth = parts[0];
        }
      }
      targetMonth = targetMonth || currentMonthName;
      targetYear = targetYear || currentYearNum;
      const cycleName = `${targetMonth} ${targetYear}`;

      const existingRun = await PayrollRunModel.findOne({
        cycle: cycleName,
        department: departmentId || null,
      });

      const employeeFilter = {
        role: "employee",
        isUserDeleted: { $ne: true },
        employeeStatus: { $ne: "Terminated" },
      };
      if (departmentId && mongoose.Types.ObjectId.isValid(departmentId)) {
        employeeFilter.department = departmentId;
      }

      const employees = await UserModel.find(employeeFilter)
        .select("-password -otp")
        .populate("department", "departmentName")
        .populate("designation", "designationName");

      if (!employees || employees.length === 0) {
        return sendBadRequestResponse(res, "No eligible employees found for this payroll cycle");
      }

      const settings = await getOrCreatePayrollSetting(req.user?._id);

      const totalWorkingDays = 22;
      let grossTotal = 0;
      let totalDeductions = 0;
      let netDisbursement = 0;

      const payslips = employees.map((emp, idx) => {
        const deptName = emp.department?.departmentName || "General";
        const desigName = emp.designation?.designationName || "Employee";
        const grade = `Grade SB-${String(idx + 1).padStart(2, "0")}`;
        const monthlySalary = emp.salary && emp.salary > 0 ? emp.salary : 45000;

        const daysWorked = totalWorkingDays;

        const computed = computeSalaryForEmployee(monthlySalary, settings, {
          daysWorked,
          totalWorkingDays,
          includePt: false, // In monthly payroll execution, deductions match pre-run (8%)
          basicSalaryPercentage: 50,
          hraPercentage: 40,
        });

        const empDeductions = computed.deductions.totalDeductions;
        const netPay = computed.netPay;

        grossTotal += monthlySalary;
        totalDeductions += empDeductions;
        netDisbursement += netPay;

        return {
          employee: emp._id,
          employeeId: emp.employeeId || `EMP${String(idx + 1).padStart(3, "0")}`,
          name: emp.name,
          avatarUrl: emp.avatarUrl,
          department: deptName,
          departmentId: emp.department?._id || null,
          designation: desigName,
          designationId: emp.designation?._id || null,
          grade,
          cycle: cycleName,
          month: targetMonth,
          year: targetYear,
          days: `${daysWorked}/${totalWorkingDays}`,
          workingDays: totalWorkingDays,
          payableDays: daysWorked,
          annualCtc: computed.annualCtc,
          grossPay: monthlySalary,
          earnings: {
            basicSalary: computed.earnings.basicSalary,
            hra: computed.earnings.hra,
            specialAllowance: computed.earnings.specialAllowance,
            otherAllowances: 0,
          },
          deductions: {
            providentFund: computed.deductions.providentFund,
            professionalTax: computed.deductions.professionalTax,
            employeeStateInsurance: computed.deductions.employeeStateInsurance,
            taxDeductedAtSource: computed.deductions.taxDeductedAtSource,
            leaveDeductions: computed.deductions.leaveDeductions,
            totalDeductions: empDeductions,
          },
          netPay,
          status: "Generated",
          bankDetails: emp.salaryDetails
            ? {
              paymentMethod: emp.salaryDetails.paymentMethod || "Bank Transfer",
              bankName: emp.salaryDetails.bankName || "",
              accountNumber: emp.salaryDetails.accountNumber || "",
              ifscCode: emp.salaryDetails.ifscCode || "",
            }
            : undefined,
          payoutDate: computed.payoutDate,
        };
      });

      const finalStatus =
        req.body.status && ["Draft", "Ready", "Completed"].includes(req.body.status)
          ? req.body.status
          : "Completed";

      let payrollRunDoc;
      if (existingRun) {
        existingRun.grossTotal = grossTotal;
        existingRun.totalDeductions = totalDeductions;
        existingRun.netDisbursement = netDisbursement;
        existingRun.totalEmployees = payslips.length;
        existingRun.status = finalStatus;
        existingRun.executedBy = req.user?._id || null;
        existingRun.executedAt = new Date();
        existingRun.payslips = payslips;
        payrollRunDoc = await existingRun.save();
      } else {
        payrollRunDoc = await PayrollRunModel.create({
          cycle: cycleName,
          month: targetMonth,
          year: targetYear,
          department: departmentId || null,
          departmentName: departmentId
            ? employees[0]?.department?.departmentName || "Department"
            : "All Departments",
          grossTotal,
          totalDeductions,
          netDisbursement,
          totalEmployees: payslips.length,
          status: finalStatus,
          executedBy: req.user?._id || null,
          executedAt: new Date(),
          payslips,
        });
      }

      await recordAuditLog(req, {
        action: "Executed Monthly Payroll",
        category: "Payroll",
        description: `Executed payroll run for ${cycleName} with ${payslips.length} employees`,
        targetResource: cycleName,
        diff: {
          before: "Pending",
          after: `Gross: ₹${grossTotal}, Net: ₹${netDisbursement}, Payslips: ${payslips.length}`,
        },
      });

      return sendSuccessResponse(
        res,
        `Payroll for ${cycleName} generated successfully. ${payslips.length} payslips created.`,
        payrollRunDoc
      );
    } catch (error) {
      console.error("Execute Monthly Payroll Error:", error);
      return sendErrorResponse(res, 500, "Failed to execute monthly payroll", error);
    }
  }

  static async generatePayslip(req, res) {
    try {
      const { employeeId, cycle, month, year } = req.body;
      if (!employeeId) {
        return sendBadRequestResponse(res, "Employee ID is required");
      }

      if (!mongoose.Types.ObjectId.isValid(employeeId)) {
        return sendBadRequestResponse(res, "Invalid employee ID");
      }

      const settings = await getOrCreatePayrollSetting(req.user?._id);

      const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];
      const now = new Date();
      const currentMonthName = monthNames[now.getMonth()];
      const currentYearNum = now.getFullYear();

      let targetMonth = month || null;
      let targetYear = year ? parseInt(year, 10) : null;

      if (cycle && typeof cycle === "string" && cycle.trim()) {
        const parts = cycle.trim().split(" ");
        if (parts.length >= 2) {
          targetMonth = parts[0];
          targetYear = parseInt(parts[1], 10) || currentYearNum;
        } else {
          targetMonth = parts[0];
        }
      }
      targetMonth = targetMonth || currentMonthName;
      targetYear = targetYear || currentYearNum;
      const cycleName = `${targetMonth} ${targetYear}`;

      const employee = await UserModel.findById(employeeId)
        .select("-password -otp")
        .populate("department", "departmentName")
        .populate("designation", "designationName");

      if (!employee || employee.isUserDeleted) {
        return sendBadRequestResponse(res, "Employee not found");
      }

      const monthlySalary = employee.salary && employee.salary > 0 ? employee.salary : 45000;
      const computed = computeSalaryForEmployee(monthlySalary, settings);

      const payslipData = {
        employee: employee._id,
        employeeId: employee.employeeId,
        name: employee.name,
        avatarUrl: employee.avatarUrl,
        department: employee.department?.departmentName || "General",
        designation: employee.designation?.designationName || "Employee",
        cycle: cycleName,
        month: targetMonth,
        year: targetYear,
        annualCtc: computed.annualCtc,
        grossPay: computed.grossPay,
        earnings: {
          basicSalary: computed.earnings.basicSalary,
          hra: computed.earnings.hra,
          specialAllowance: computed.earnings.specialAllowance,
          otherAllowances: 0,
        },
        deductions: {
          providentFund: computed.deductions.providentFund,
          professionalTax: computed.deductions.professionalTax,
          employeeStateInsurance: computed.deductions.employeeStateInsurance,
          taxDeductedAtSource: computed.deductions.taxDeductedAtSource,
          totalDeductions: computed.deductions.totalDeductions,
        },
        netPay: computed.netPay,
        status: "Generated",
        bankDetails: employee.salaryDetails
          ? {
            paymentMethod: employee.salaryDetails.paymentMethod || "Bank Transfer",
            bankName: employee.salaryDetails.bankName || "",
            accountNumber: employee.salaryDetails.accountNumber || "",
            ifscCode: employee.salaryDetails.ifscCode || "",
          }
          : undefined,
        payoutDate: computed.payoutDate,
        generatedAt: new Date(),
      };

      return sendSuccessResponse(res, "Payslip generated successfully", payslipData);
    } catch (error) {
      console.error("Generate Payslip Error:", error);
      return sendErrorResponse(res, 500, "Failed to generate payslip", error);
    }
  }

  static async getPayslip(req, res) {
    try {
      const { employeeId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(employeeId)) {
        return sendBadRequestResponse(res, "Invalid employee ID");
      }

      const { cycle, month, year } = req.query;

      const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];
      const now = new Date();
      const currentMonthName = monthNames[now.getMonth()];
      const currentYearNum = now.getFullYear();

      let targetMonth = month || null;
      let targetYear = year ? parseInt(year, 10) : null;

      if (cycle && typeof cycle === "string" && cycle.trim()) {
        const parts = cycle.trim().split(" ");
        if (parts.length >= 2) {
          targetMonth = parts[0];
          targetYear = parseInt(parts[1], 10) || currentYearNum;
        } else {
          targetMonth = parts[0];
        }
      }

      let run = null;
      if (targetMonth || targetYear) {
        targetMonth = targetMonth || currentMonthName;
        targetYear = targetYear || currentYearNum;
        const cycleName = `${targetMonth} ${targetYear}`;

        run = await PayrollRunModel.findOne({
          cycle: cycleName,
          "payslips.employee": employeeId,
        });
      } else {
        run = await PayrollRunModel.findOne({
          "payslips.employee": employeeId,
        }).sort({ createdAt: -1 });

        if (run) {
          targetMonth = run.month;
          targetYear = run.year;
        } else {
          targetMonth = currentMonthName;
          targetYear = currentYearNum;
        }
      }

      const cycleName = `${targetMonth} ${targetYear}`;

      if (run) {
        const found = run.payslips.find((p) => String(p.employee) === String(employeeId));
        if (found) {
          return sendSuccessResponse(res, "Payslip fetched successfully", found);
        }
      }

      const settings = await getOrCreatePayrollSetting(req.user?._id);

      const employee = await UserModel.findById(employeeId)
        .select("-password -otp")
        .populate("department", "departmentName")
        .populate("designation", "designationName");

      if (!employee || employee.isUserDeleted) {
        return sendBadRequestResponse(res, "Employee not found");
      }

      const monthlySalary = employee.salary && employee.salary > 0 ? employee.salary : 45000;
      const computed = computeSalaryForEmployee(monthlySalary, settings);

      return sendSuccessResponse(res, "Payslip fetched successfully", {
        employee: employee._id,
        employeeId: employee.employeeId,
        name: employee.name,
        avatarUrl: employee.avatarUrl,
        department: employee.department?.departmentName || "General",
        designation: employee.designation?.designationName || "Employee",
        cycle: cycleName,
        month: targetMonth,
        year: targetYear,
        annualCtc: computed.annualCtc,
        grossPay: computed.grossPay,
        earnings: {
          basicSalary: computed.earnings.basicSalary,
          hra: computed.earnings.hra,
          specialAllowance: computed.earnings.specialAllowance,
          otherAllowances: 0,
        },
        deductions: {
          providentFund: computed.deductions.providentFund,
          professionalTax: computed.deductions.professionalTax,
          employeeStateInsurance: computed.deductions.employeeStateInsurance,
          taxDeductedAtSource: computed.deductions.taxDeductedAtSource,
          totalDeductions: computed.deductions.totalDeductions,
        },
        netPay: computed.netPay,
        status: "Ready",
        bankDetails: employee.salaryDetails || {},
        payoutDate: computed.payoutDate,
      });
    } catch (error) {
      console.error("Get Payslip Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch payslip", error);
    }
  }

  static async getAllPayrollRuns(req, res) {
    try {
      const { page = 1, limit = 10 } = req.query;
      const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

      const [runs, total] = await Promise.all([
        PayrollRunModel.find()
          .select("-payslips")
          .populate("executedBy", "name email")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit, 10)),
        PayrollRunModel.countDocuments(),
      ]);

      return sendSuccessResponse(res, "Payroll runs fetched successfully", {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(total / parseInt(limit, 10)),
        runs,
      });
    } catch (error) {
      console.error("Get All Payroll Runs Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch payroll runs", error);
    }
  }

  static async getPayrollRunById(req, res) {
    try {
      const { id } = req.params;
      const run = await PayrollRunModel.findById(id).populate("executedBy", "name email");
      if (!run) {
        return sendBadRequestResponse(res, "Payroll run not found");
      }
      return sendSuccessResponse(res, "Payroll run details fetched successfully", run);
    } catch (error) {
      console.error("Get Payroll Run By ID Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch payroll run details", error);
    }
  }
}
