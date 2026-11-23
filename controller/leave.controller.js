import mongoose from "mongoose";
import LeaveModel from "../model/leave.model.js";
import LeaveTypeModel from "../model/leaveType.model.js";
import LeavePolicyModel from "../model/leavePolicy.model.js";
import AttendanceModel from "../model/attendance.model.js";
import UserModel from "../model/user.model.js";
import { recordAuditLog } from "../utils/auditLogger.js";
import { notifyAdmins, notifyUser } from "../utils/notification.util.js";
import {
  getNormalizedDateString,
  formatDisplayDate,
} from "./attendance.controller.js";
import {
  sendCreatedResponse,
  sendSuccessResponse,
  sendErrorResponse,
  sendBadRequestResponse,
  sendNotFoundResponse,
} from "../utils/Response.utils.js";

export const calculateLeaveDays = (fromDateStr, toDateStr, isHalfDay = false) => {
  if (isHalfDay) return 0.5;

  const [y1, m1, d1] = fromDateStr.split("-").map(Number);
  const [y2, m2, d2] = toDateStr.split("-").map(Number);

  const start = new Date(y1, m1 - 1, d1);
  const end = new Date(y2, m2 - 1, d2);

  const diffTime = end.getTime() - start.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(1, diffDays);
};

export const parseNoticeDays = (noticePeriodStr) => {
  if (!noticePeriodStr) return 0;
  const str = String(noticePeriodStr).toLowerCase().trim();
  if (str.includes("immediate") || str.includes("same day") || str.includes("no notice")) return 0;
  const match = str.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
};

export const validateCalendarDateString = (dateVal, fieldName = "Date") => {
  if (!dateVal || typeof dateVal !== "string") {
    return { error: `${fieldName} is required and must be in YYYY-MM-DD format!` };
  }
  const clean = dateVal.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return { error: `Invalid ${fieldName} format! Use YYYY-MM-DD format.` };
  }
  const parts = clean.split("-");
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  if (isNaN(year) || year < 1900 || year > 2100) {
    return { error: `Invalid year in ${fieldName}!` };
  }
  if (isNaN(month) || month < 1 || month > 12) {
    return { error: `Invalid month in ${fieldName}! Must be between 1 and 12.` };
  }
  const maxDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (isNaN(day) || day < 1 || day > maxDays) {
    return {
      error: `Invalid date '${dateVal}'! Day must be between 1 and ${maxDays} for month ${month}.`,
    };
  }
  return { dateString: clean };
};

export class LeaveController {
  static async applyLeave(req, res) {
    try {
      const employeeId = req.user?._id;
      if (!employeeId) {
        return sendBadRequestResponse(res, "Authentication required");
      }

      const {
        leaveTypeId,
        leaveType: leaveTypeNameInput,
        fromDate,
        toDate,
        isHalfDay = false,
        halfDaySession = null,
        reason,
        emergencyContact = "",
        documentUrl = null,
      } = req.body;

      if (!fromDate || !String(fromDate).trim()) {
        return sendBadRequestResponse(res, "From date is required (e.g. '2026-10-25' or '25 Oct 2026')");
      }

      if (!toDate || !String(toDate).trim()) {
        return sendBadRequestResponse(res, "To date is required (e.g. '2026-10-26' or '26 Oct 2026')");
      }

      if (!reason || !String(reason).trim()) {
        return sendBadRequestResponse(res, "Reason for leave is required");
      }

      let leaveTypeDoc = null;
      if (leaveTypeId && mongoose.Types.ObjectId.isValid(String(leaveTypeId).trim())) {
        leaveTypeDoc = await LeaveTypeModel.findOne({
          _id: String(leaveTypeId).trim(),
          isDeleted: false,
        });
      } else if (leaveTypeNameInput && String(leaveTypeNameInput).trim()) {
        const cleanName = String(leaveTypeNameInput).trim();
        leaveTypeDoc = await LeaveTypeModel.findOne({
          leaveTypeName: { $regex: new RegExp(`^${cleanName}$`, "i") },
          isDeleted: false,
        });
      }

      if (!leaveTypeDoc) {
        return sendBadRequestResponse(
          res,
          "Invalid or non-existent leave type. Please select a valid leave type."
        );
      }

      if (leaveTypeDoc.status === "Inactive") {
        return sendBadRequestResponse(
          res,
          `The leave type '${leaveTypeDoc.leaveTypeName}' is currently inactive.`
        );
      }

      const fromVal = validateCalendarDateString(fromDate, "fromDate");
      if (fromVal.error) {
        return sendBadRequestResponse(res, fromVal.error);
      }
      const toVal = validateCalendarDateString(toDate, "toDate");
      if (toVal.error) {
        return sendBadRequestResponse(res, toVal.error);
      }

      const fromDateNorm = fromVal.dateString;
      const toDateNorm = toVal.dateString;

      if (fromDateNorm > toDateNorm) {
        return sendBadRequestResponse(res, "From date cannot be after To date!");
      }

      const todayNorm = getNormalizedDateString(new Date());
      if (fromDateNorm < todayNorm) {
        return sendBadRequestResponse(
          res,
          `Cannot apply for leave on past dates! From date must be today (${todayNorm}) or a future date.`
        );
      }

      const formattedFromDate = formatDisplayDate(new Date(fromDateNorm));
      const formattedToDate = formatDisplayDate(new Date(toDateNorm));

      const policyDoc = await LeavePolicyModel.findOne({
        leaveType: leaveTypeDoc._id,
        isDeleted: false,
      });

      const effectiveNoticePeriod = policyDoc?.noticePeriod || leaveTypeDoc.noticePeriod || "2 Days in Advance";
      const effectiveMaxConsecutiveDays = policyDoc?.maxConsecutiveDays || leaveTypeDoc.maxConsecutiveDays || 7;
      const effectiveAccrualMode = policyDoc?.accrualMode || leaveTypeDoc.accrualMode || "Monthly accrual (half day allowed)";
      const effectiveAnnualQuota = policyDoc?.leaveQuota ?? leaveTypeDoc.leaveBalance ?? 0;

      const requiredNoticeDays = parseNoticeDays(effectiveNoticePeriod);
      if (requiredNoticeDays > 0) {
        const todayNorm = getNormalizedDateString(new Date());
        const [yT, mT, dT] = todayNorm.split("-").map(Number);
        const [yF, mF, dF] = fromDateNorm.split("-").map(Number);
        const todayUtc = Date.UTC(yT, mT - 1, dT);
        const fromUtc = Date.UTC(yF, mF - 1, dF);
        const advanceDays = Math.round((fromUtc - todayUtc) / (1000 * 60 * 60 * 24));

        if (advanceDays < requiredNoticeDays) {
          return res.status(400).json({
            success: false,
            message: `Notice period policy requirement not met! '${leaveTypeDoc.leaveTypeName}' requires at least ${effectiveNoticePeriod} (${requiredNoticeDays} day(s) advance notice). You applied with only ${advanceDays < 0 ? 0 : advanceDays} day(s) advance notice.`,
            requiredNoticeDays,
            advanceDaysApplied: Math.max(0, advanceDays),
            leaveType: leaveTypeDoc.leaveTypeName,
          });
        }
      }

      const isHalf =
        typeof isHalfDay === "boolean"
          ? isHalfDay
          : String(isHalfDay).toLowerCase() === "true";

      if (isHalf && !leaveTypeDoc.allowHalfDay) {
        return sendBadRequestResponse(
          res,
          `Half day leave is not permitted for '${leaveTypeDoc.leaveTypeName}'.`
        );
      }

      if (isHalf && fromDateNorm !== toDateNorm) {
        return sendBadRequestResponse(
          res,
          "Half day leave can only be applied for a single date (From Date and To Date must be the same)."
        );
      }

      const totalDays = calculateLeaveDays(fromDateNorm, toDateNorm, isHalf);

      if (effectiveMaxConsecutiveDays && totalDays > effectiveMaxConsecutiveDays) {
        return res.status(400).json({
          success: false,
          message: `Maximum consecutive days limit exceeded! '${leaveTypeDoc.leaveTypeName}' allows at most ${effectiveMaxConsecutiveDays} consecutive days per application, but you requested ${totalDays} days.`,
          maxConsecutiveDays: effectiveMaxConsecutiveDays,
          requestedDays: totalDays,
          leaveType: leaveTypeDoc.leaveTypeName,
        });
      }

      const overlappingLeave = await LeaveModel.findOne({
        employee: employeeId,
        status: { $in: ["Pending", "Approved"] },
        $or: [
          {
            fromDate: { $lte: toDateNorm },
            toDate: { $gte: fromDateNorm },
          },
        ],
      });

      if (overlappingLeave) {
        return res.status(409).json({
          success: false,
          message: `You already have an active leave application (${overlappingLeave.status}) overlapping between ${overlappingLeave.formattedFromDate} and ${overlappingLeave.formattedToDate} (${overlappingLeave.leaveTypeName}).`,
          conflictingLeave: overlappingLeave,
        });
      }

      const isUnpaid =
        leaveTypeDoc.leaveTypeName.toLowerCase().includes("unpaid") ||
        effectiveAnnualQuota === 0;

      if (!isUnpaid) {
        const [fromYear, fromMonth] = fromDateNorm.split("-").map(Number);
        const startOfYear = `${fromYear}-01-01`;
        const endOfYear = `${fromYear}-12-31`;

        const approvedLeaves = await LeaveModel.find({
          employee: employeeId,
          leaveType: leaveTypeDoc._id,
          status: "Approved",
          fromDate: { $gte: startOfYear, $lte: endOfYear },
        });

        const usedDays = approvedLeaves.reduce((acc, l) => acc + (l.totalDays || 0), 0);
        const annualQuota = effectiveAnnualQuota;
        const remainingAnnualBalance = Math.max(0, annualQuota - usedDays);

        if (totalDays > remainingAnnualBalance) {
          return res.status(400).json({
            success: false,
            message: `Insufficient annual leave balance! You have ${remainingAnnualBalance} day(s) remaining for '${leaveTypeDoc.leaveTypeName}' this year (Annual Quota: ${annualQuota} days, Used: ${usedDays} days), but requested ${totalDays} day(s).`,
            totalQuota: annualQuota,
            usedDays,
            remainingBalance: remainingAnnualBalance,
            requestedDays: totalDays,
          });
        }

        const isMonthlyAccrual =
          effectiveAccrualMode &&
          String(effectiveAccrualMode).toLowerCase().includes("monthly");
        const isQuarterlyAccrual =
          effectiveAccrualMode &&
          String(effectiveAccrualMode).toLowerCase().includes("quarterly");

        if (isMonthlyAccrual && annualQuota > 0) {
          const monthlyRate = annualQuota / 12;
          const accruedDaysUpToMonth = Math.min(
            annualQuota,
            Math.round(monthlyRate * fromMonth * 2) / 2
          );
          const availableAccruedBalance = Math.max(0, accruedDaysUpToMonth - usedDays);

          if (totalDays > availableAccruedBalance) {
            return res.status(400).json({
              success: false,
              message: `Monthly accrual limit reached! Under '${leaveTypeDoc.leaveTypeName}' policy (${effectiveAccrualMode}), leaves accrue at ${monthlyRate.toFixed(2)} days/month. As of Month ${fromMonth}, your accrued quota is ${accruedDaysUpToMonth} day(s). With ${usedDays} day(s) already used, your currently available balance is ${availableAccruedBalance} day(s). Unearned leaves for future months cannot be taken in advance.`,
              accrualMode: effectiveAccrualMode,
              monthlyRate: Number(monthlyRate.toFixed(2)),
              targetMonth: fromMonth,
              accruedDaysUpToMonth,
              usedDays,
              availableAccruedBalance,
              requestedDays: totalDays,
              annualQuota,
            });
          }
        } else if (isQuarterlyAccrual && annualQuota > 0) {
          const currentQuarter = Math.ceil(fromMonth / 3);
          const quarterlyRate = annualQuota / 4;
          const accruedDaysUpToQuarter = Math.min(
            annualQuota,
            Math.round(quarterlyRate * currentQuarter * 2) / 2
          );
          const availableAccruedBalance = Math.max(0, accruedDaysUpToQuarter - usedDays);

          if (totalDays > availableAccruedBalance) {
            return res.status(400).json({
              success: false,
              message: `Quarterly accrual limit reached! Under '${leaveTypeDoc.leaveTypeName}' policy (${effectiveAccrualMode}), leaves accrue quarterly (${quarterlyRate.toFixed(1)} days/quarter). For Quarter ${currentQuarter}, your accrued quota is ${accruedDaysUpToQuarter} day(s). With ${usedDays} day(s) already used, your currently available balance is ${availableAccruedBalance} day(s).`,
              accrualMode: effectiveAccrualMode,
              quarterlyRate: Number(quarterlyRate.toFixed(2)),
              targetQuarter: currentQuarter,
              accruedDaysUpToQuarter,
              usedDays,
              availableAccruedBalance,
              requestedDays: totalDays,
              annualQuota,
            });
          }
        }
      }

      const isAutoApproved =
        policyDoc?.approvalWorkflow === "Auto-Approved" ||
        policyDoc?.approvalChain === "Auto-Approved" ||
        !leaveTypeDoc.requiresApproval;

      const initialStatus = isAutoApproved ? "Approved" : "Pending";

      const newLeave = await LeaveModel.create({
        employee: employeeId,
        leaveType: leaveTypeDoc._id,
        leaveTypeName: leaveTypeDoc.leaveTypeName,
        fromDate: fromDateNorm,
        toDate: toDateNorm,
        formattedFromDate,
        formattedToDate,
        isHalfDay: isHalf,
        halfDaySession: isHalf ? halfDaySession || "First Half" : null,
        totalDays,
        reason: String(reason).trim(),
        emergencyContact: emergencyContact ? String(emergencyContact).trim() : "",
        documentUrl: documentUrl ? String(documentUrl).trim() : null,
        status: initialStatus,
        appliedAt: new Date(),
      });

      await recordAuditLog(req, {
        action: "Applied for Leave",
        category: "Leave Management",
        description: `Applied for ${totalDays} day(s) ${leaveTypeDoc.leaveTypeName} (${formattedFromDate} to ${formattedToDate})`,
        targetResource: `${formattedFromDate} to ${formattedToDate} - ${leaveTypeDoc.leaveTypeName}`,
      });

      const empUser = await UserModel.findById(employeeId)
        .select("name firstName lastName employeeId avatarUrl email department")
        .populate("department", "departmentName")
        .lean();

      const empName =
        empUser?.name ||
        `${empUser?.firstName || ""} ${empUser?.lastName || ""}`.trim() ||
        req.user?.name ||
        req.user?.employeeId ||
        "Employee";

      const deptName = empUser?.department?.departmentName ? ` (${empUser.department.departmentName})` : "";

<<<<<<< HEAD
      // 1. Send Notification ONLY to Admins (In-app + FCM Push)
=======
>>>>>>> cd4c45e775025ef8a070866634ede561b7b11dd3
      try {
        await notifyAdmins({
          title: "New Leave Application",
          message: `${empName}${deptName} has applied for ${totalDays} day(s) ${leaveTypeDoc.leaveTypeName} (${formattedFromDate} to ${formattedToDate}). Reason: "${String(reason).trim()}"`,
          category: "Leave",
          type: "LEAVE_APPLIED",
          sender: employeeId,
          senderName: empName,
          senderAvatar: empUser?.avatarUrl || req.user?.avatarUrl || null,
          referenceId: newLeave._id,
          referenceModel: "Leave",
        });
      } catch (notifErr) {
        console.error("Leave apply notification error:", notifErr);
      }

      const populated = await LeaveModel.findById(newLeave._id)
        .populate("employee", "name firstName lastName employeeId avatarUrl email department designation")
        .populate("leaveType", "leaveTypeName leaveBalance color icon");

      return sendCreatedResponse(
        res,
        initialStatus === "Approved"
          ? "Leave application automatically approved!"
          : "Leave application submitted successfully! Waiting for Admin approval.",
        populated
      );
    } catch (error) {
      console.error("Apply Leave Error:", error);
      return sendErrorResponse(res, 500, "Failed to submit leave application", error);
    }
  }

  static async getMyLeaves(req, res) {
    try {
      const employeeId = req.user?._id;
      if (!employeeId) {
        return sendBadRequestResponse(res, "Authentication required");
      }

      const { status, page = 1, limit = 10, search } = req.query;

      const filter = { employee: employeeId };

      if (status && status.toLowerCase() !== "all") {
        filter.status = new RegExp(`^${status.trim()}$`, "i");
      }

      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        filter.$or = [
          { leaveTypeName: regex },
          { reason: regex },
          { formattedFromDate: regex },
          { formattedToDate: regex },
        ];
      }

      const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

      const [leaves, total, allCount, pendingCount, approvedCount, rejectedCount] =
        await Promise.all([
          LeaveModel.find(filter)
            .populate("leaveType", "leaveTypeName color icon leaveBalance")
            .populate("actionBy", "name firstName lastName email")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit, 10)),
          LeaveModel.countDocuments(filter),
          LeaveModel.countDocuments({ employee: employeeId }),
          LeaveModel.countDocuments({ employee: employeeId, status: "Pending" }),
          LeaveModel.countDocuments({ employee: employeeId, status: "Approved" }),
          LeaveModel.countDocuments({ employee: employeeId, status: "Rejected" }),
        ]);

      return sendSuccessResponse(res, "My leave applications retrieved successfully", {
        counters: {
          all: allCount,
          pending: pendingCount,
          approved: approvedCount,
          rejected: rejectedCount,
        },
        pagination: {
          total,
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          totalPages: Math.ceil(total / parseInt(limit, 10)),
        },
        leaves,
      });
    } catch (error) {
      console.error("Get My Leaves Error:", error);
      return sendErrorResponse(res, 500, "Failed to retrieve leave applications", error);
    }
  }

  static async getMyLeaveBalances(req, res) {
    try {
      const employeeId = req.user?._id;
      if (!employeeId) {
        return sendBadRequestResponse(res, "Authentication required");
      }

      const leaveTypes = await LeaveTypeModel.find({
        isDeleted: false,
        status: "Active",
      }).sort({ createdAt: 1 });

      const policies = await LeavePolicyModel.find({ isDeleted: false, status: "Active" });
      const policyMap = new Map();
      policies.forEach((p) => policyMap.set(String(p.leaveType), p));

      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;
      const startOfYear = `${currentYear}-01-01`;
      const endOfYear = `${currentYear}-12-31`;

      const employeeLeaves = await LeaveModel.find({
        employee: employeeId,
        status: { $in: ["Approved", "Pending"] },
        fromDate: { $gte: startOfYear, $lte: endOfYear },
      });

      let grandTotalQuota = 0;
      let grandTotalUsed = 0;
      let grandTotalPending = 0;

      const balances = leaveTypes.map((lt) => {
        const approvedForType = employeeLeaves.filter(
          (l) => String(l.leaveType) === String(lt._id) && l.status === "Approved"
        );
        const pendingForType = employeeLeaves.filter(
          (l) => String(l.leaveType) === String(lt._id) && l.status === "Pending"
        );

        const policy = policyMap.get(String(lt._id));
        const totalQuota = policy?.leaveQuota ?? lt.leaveBalance ?? 0;
        const accrualMode = policy?.accrualMode || lt.accrualMode || "Monthly accrual (half day allowed)";
        const carryForwardCap = policy?.carryForwardCap || lt.carryForwardCap || "Lapses at Year-End";
        const maxConsecutiveDays = policy?.maxConsecutiveDays || lt.maxConsecutiveDays || 7;
        const noticePeriod = policy?.noticePeriod || lt.noticePeriod || "2 Days in Advance";
        const approvalChain = policy?.approvalChain || lt.approvalChain || "Reporting Manager";

        const usedDays = approvedForType.reduce((acc, l) => acc + (l.totalDays || 0), 0);
        const pendingDays = pendingForType.reduce((acc, l) => acc + (l.totalDays || 0), 0);
        const remainingDays = Math.max(0, totalQuota - usedDays);

        const isMonthlyAccrual =
          accrualMode && String(accrualMode).toLowerCase().includes("monthly");
        const monthlyRate = totalQuota > 0 ? Number((totalQuota / 12).toFixed(2)) : 0;
        const accruedToDate = isMonthlyAccrual
          ? Math.min(totalQuota, Math.round(monthlyRate * currentMonth * 2) / 2)
          : totalQuota;
        const availableAccruedBalance = Math.max(0, accruedToDate - usedDays);

        grandTotalQuota += totalQuota;
        grandTotalUsed += usedDays;
        grandTotalPending += pendingDays;

        return {
          _id: lt._id,
          leaveTypeName: lt.leaveTypeName,
          color: lt.color || "#EF4444",
          icon: lt.icon || null,
          totalQuota,
          annualQuota: totalQuota,
          leaveQuota: totalQuota,
          leaveBalance: totalQuota,
          usedDays,
          pendingDays,
          remainingDays,
          accrualMode,
          carryForwardCap,
          maxConsecutiveDays,
          noticePeriod,
          approvalChain,
          monthlyRate,
          accruedToDate,
          availableAccruedBalance,
          display: `${remainingDays} / ${totalQuota} left`,
          allowHalfDay: lt.allowHalfDay,
          requiresApproval: lt.requiresApproval,
        };
      });

      return sendSuccessResponse(res, "Leave balances retrieved successfully", {
        summary: {
          totalQuota: grandTotalQuota,
          totalUsed: grandTotalUsed,
          totalRemaining: Math.max(0, grandTotalQuota - grandTotalUsed),
          pendingRequestsCount: employeeLeaves.filter((l) => l.status === "Pending").length,
          currentMonth,
          currentYear,
        },
        balances,
      });
    } catch (error) {
      console.error("Get Leave Balances Error:", error);
      return sendErrorResponse(res, 500, "Failed to retrieve leave balances", error);
    }
  }

  static async cancelLeave(req, res) {
    try {
      const employeeId = req.user?._id;
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid leave ID");
      }

      const leave = await LeaveModel.findOne({
        _id: id,
        employee: employeeId,
      });

      if (!leave) {
        return sendNotFoundResponse(res, "Leave application not found");
      }

      if (leave.status !== "Pending") {
        return sendBadRequestResponse(
          res,
          `Cannot cancel leave request that is already ${leave.status.toLowerCase()}. Only Pending requests can be cancelled.`
        );
      }

      leave.status = "Cancelled";
      await leave.save();

      await recordAuditLog(req, {
        action: "Cancelled Leave Application",
        category: "Leave Management",
        description: `Cancelled leave application for ${leave.leaveTypeName} (${leave.formattedFromDate} to ${leave.formattedToDate})`,
        targetResource: `${leave.formattedFromDate} - ${leave.leaveTypeName}`,
      });

      const cancelEmpName =
        req.user?.name ||
        `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() ||
        "Employee";

      await notifyAdmins({
        title: "Leave Application Cancelled",
        message: `${cancelEmpName} cancelled their ${leave.leaveTypeName} application (${leave.formattedFromDate} to ${leave.formattedToDate}).`,
        category: "Leave",
        type: "LEAVE_CANCELLED",
        sender: employeeId,
        senderName: cancelEmpName,
        referenceId: leave._id,
        referenceModel: "Leave",
      });

      return sendSuccessResponse(res, "Leave application cancelled successfully", leave);
    } catch (error) {
      console.error("Cancel Leave Error:", error);
      return sendErrorResponse(res, 500, "Failed to cancel leave application", error);
    }
  }

  static async getAllLeaves(req, res) {
    try {
      const { status, search, department, page = 1, limit = 10, fromDate, toDate } = req.query;

      const [allCount, pendingCount, approvedCount, rejectedCount] = await Promise.all([
        LeaveModel.countDocuments({}),
        LeaveModel.countDocuments({ status: "Pending" }),
        LeaveModel.countDocuments({ status: "Approved" }),
        LeaveModel.countDocuments({ status: "Rejected" }),
      ]);

      const filter = {};

      if (status && status.toLowerCase() !== "all") {
        filter.status = new RegExp(`^${status.trim()}$`, "i");
      }

      if (fromDate && toDate) {
        filter.fromDate = { $gte: getNormalizedDateString(fromDate) };
        filter.toDate = { $lte: getNormalizedDateString(toDate) };
      }

      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        const matchingUsers = await UserModel.find({
          $or: [
            { name: regex },
            { firstName: regex },
            { lastName: regex },
            { employeeId: regex },
            { email: regex },
          ],
        }).select("_id");

        const userIds = matchingUsers.map((u) => u._id);

        filter.$or = [
          { employee: { $in: userIds } },
          { leaveTypeName: regex },
          { reason: regex },
          { formattedFromDate: regex },
          { formattedToDate: regex },
        ];
      }

      if (department && mongoose.Types.ObjectId.isValid(department)) {
        const usersInDept = await UserModel.find({ department }).select("_id");
        const deptUserIds = usersInDept.map((u) => u._id);
        filter.employee = { $in: deptUserIds };
      }

      const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

      const [leaves, total] = await Promise.all([
        LeaveModel.find(filter)
          .populate("employee", "name firstName lastName employeeId avatarUrl email department designation")
          .populate("leaveType", "leaveTypeName color icon leaveBalance")
          .populate("actionBy", "name firstName lastName email")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit, 10)),
        LeaveModel.countDocuments(filter),
      ]);

      return sendSuccessResponse(res, "Leave applications retrieved successfully", {
        counters: {
          all: allCount,
          pending: pendingCount,
          approved: approvedCount,
          rejected: rejectedCount,
        },
        pagination: {
          total,
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          totalPages: Math.ceil(total / parseInt(limit, 10)),
        },
        leaves,
      });
    } catch (error) {
      console.error("Get All Leaves Error:", error);
      return sendErrorResponse(res, 500, "Failed to retrieve leave applications", error);
    }
  }

  static async actionLeave(req, res) {
    try {
      const { id: paramId } = req.params;
      const { id: bodyId, leaveId, action, status, adminRemarks = "", managerNote = "", rejectionReason = "" } = req.body;
      const id = paramId || bodyId || leaveId;

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Valid leave ID is required");
      }

      const rawAction = String(action || status || "").trim().toLowerCase();
      const approveKeywords = ["approve", "approved", "accept", "accepted"];
      const rejectKeywords = ["reject", "rejected"];

      if (!approveKeywords.includes(rawAction) && !rejectKeywords.includes(rawAction)) {
        return sendBadRequestResponse(
          res,
          "Action must be either 'approve' (or 'accept') or 'reject'!"
        );
      }

      const leave = await LeaveModel.findById(id).populate("employee").populate("leaveType");
      if (!leave) {
        return sendNotFoundResponse(res, "Leave application not found");
      }

      if (leave.status !== "Pending") {
        return sendBadRequestResponse(
          res,
          `This leave request has already been ${leave.status.toLowerCase()} and cannot be changed.`
        );
      }

      const isApprove = approveKeywords.includes(rawAction);
      const remarks = adminRemarks || managerNote || "";

      const employeeTargetId = leave.employee?._id || leave.employee;
      const targetEmployeeName =
        leave.employee?.name ||
        `${leave.employee?.firstName || ""} ${leave.employee?.lastName || ""}`.trim() ||
        "Employee";

      if (isApprove) {
        leave.status = "Approved";
        leave.adminRemarks = remarks ? remarks.trim() : "Approved by administrator.";
        leave.actionBy = req.user?._id;
        leave.actionAt = new Date();

        const todayStr = getNormalizedDateString();
        if (leave.fromDate <= todayStr && leave.toDate >= todayStr && employeeTargetId) {
          let attendance = await AttendanceModel.findOne({
            employee: employeeTargetId,
            date: todayStr,
          });

          const leaveStatus = leave.isHalfDay ? "Half Day" : "On Leave";

          if (!attendance) {
            attendance = new AttendanceModel({
              employee: employeeTargetId,
              date: todayStr,
              formattedDate: formatDisplayDate(new Date(todayStr)),
              status: leaveStatus,
              notes: `Approved Leave: ${leave.leaveTypeName} (${leave.formattedFromDate || leave.fromDate} to ${leave.formattedToDate || leave.toDate})`,
            });
          } else {
            attendance.status = leaveStatus;
            attendance.notes = attendance.notes
              ? `${attendance.notes} | Approved Leave: ${leave.leaveTypeName}`
              : `Approved Leave: ${leave.leaveTypeName}`;
          }

          await attendance.save();
        }
      } else {
        leave.status = "Rejected";
        leave.rejectionReason = rejectionReason
          ? rejectionReason.trim()
          : remarks || "Leave request rejected by administrator.";
        leave.adminRemarks = remarks ? remarks.trim() : "";
        leave.actionBy = req.user?._id;
        leave.actionAt = new Date();
      }

      await leave.save();

      await recordAuditLog(req, {
        action: `${isApprove ? "Approved" : "Rejected"} Leave Application`,
        category: "Leave Management",
        description: `${isApprove ? "Approved" : "Rejected"} ${leave.leaveTypeName} for ${leave.employee?.name || "Employee"} (${leave.formattedFromDate} to ${leave.formattedToDate})`,
        targetResource: `${leave.employee?.name} - ${leave.leaveTypeName}`,
      });

      const adminActionName =
        req.user?.name ||
        `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() ||
        "Admin";

      const leaveName =
        leave.leaveTypeName ||
        leave.leaveType?.leaveTypeName ||
        "Leave";
      const fromDateStr = leave.formattedFromDate || leave.fromDate || "";
      const toDateStr = leave.formattedToDate || leave.toDate || "";
      const dateRangeStr = fromDateStr
        ? (fromDateStr === toDateStr ? ` for ${fromDateStr}` : ` (${fromDateStr} to ${toDateStr})`)
        : "";

      const finalRemarks = remarks || rejectionReason || leave.rejectionReason || "";
      const remarksText = finalRemarks ? ` Reason/Remarks: "${finalRemarks.trim()}".` : "";

      // 🌟 Send Notification to the Employee (In-app + FCM Push) 🌟
      const employeeTargetId = leave.employee?._id || leave.employee;

      try {
        await notifyUser(employeeTargetId, {
          title: isApprove ? "Leave Application Approved 🎉" : "Leave Application Rejected",
          message: isApprove
            ? `Your ${leaveName} application${dateRangeStr} has been approved by ${adminActionName}.${remarksText}`
            : `Your ${leaveName} application${dateRangeStr} has been rejected by ${adminActionName}.${remarksText}`.trim(),
          category: "Leave",
          type: isApprove ? "LEAVE_APPROVED" : "LEAVE_REJECTED",
          sender: req.user?._id,
          senderName: adminActionName,
          senderAvatar: req.user?.avatarUrl || null,
          referenceId: leave._id,
          referenceModel: "Leave",
        });
      } catch (notifErr) {
        console.error("Action leave notification error:", notifErr);
      }

      return sendSuccessResponse(
        res,
        `Leave application ${leave.status.toLowerCase()} successfully!`,
        leave
      );
    } catch (error) {
      console.error("Action Leave Error:", error);
      return sendErrorResponse(res, 500, "Failed to update leave application", error);
    }
  }

  static async getLeaveById(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid leave ID");
      }

      const leave = await LeaveModel.findById(id)
        .populate("employee", "name firstName lastName employeeId avatarUrl email department designation")
        .populate("leaveType", "leaveTypeName color icon leaveBalance")
        .populate("actionBy", "name firstName lastName email");

      if (!leave) {
        return sendNotFoundResponse(res, "Leave application not found");
      }

      return sendSuccessResponse(res, "Leave details fetched successfully", leave);
    } catch (error) {
      console.error("Get Leave By ID Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch leave details", error);
    }
  }
}
