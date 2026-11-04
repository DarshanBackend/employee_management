import mongoose from "mongoose";
import LeavePolicyModel from "../model/leavePolicy.model.js";
import LeaveTypeModel from "../model/leaveType.model.js";
import {
  sendCreatedResponse,
  sendSuccessResponse,
  sendErrorResponse,
  sendBadRequestResponse,
  sendNotFoundResponse,
} from "../utils/Response.utils.js";

/**
 * Helper: Parse integer days from number or string (e.g. "5 Days" -> 5)
 */
export const parseDaysFromInput = (input, defaultVal = 0) => {
  if (input === undefined || input === null || input === "") return defaultVal;
  if (typeof input === "number") return isNaN(input) ? defaultVal : input;
  const match = String(input).match(/\d+/);
  return match ? parseInt(match[0], 10) : defaultVal;
};

/**
 * Helper: Normalize accrual mode string matching UI dropdown
 */
export const normalizeAccrualMode = (input) => {
  if (!input) return "Annual Upfront (All leaves credited upfront at year start)";
  const str = String(input).toLowerCase();
  if (str.includes("monthly")) {
    return "Monthly Accrual (Allocated progressively each month)";
  }
  if (str.includes("quarterly")) {
    return "Quarterly Accrual (Credited every 3 months)";
  }
  if (str.includes("upfront") || str.includes("annual")) {
    return "Annual Upfront (All leaves credited upfront at year start)";
  }
  return String(input).trim();
};

/**
 * Helper: Normalize approval workflow matching UI dropdown
 */
export const normalizeApprovalWorkflow = (input) => {
  if (!input) return "Reporting Manager";
  const str = String(input).trim();
  const lower = str.toLowerCase();
  if (lower.includes("auto")) return "Auto-Approved";
  if (lower.includes("department") || lower.includes("dept")) return "Department Head";
  if (lower.includes("hr")) return "HR Department";
  if (lower.includes("manager") || lower.includes("reporting")) return "Reporting Manager";
  return str;
};

export class LeavePolicyController {
  /**
   * Add / Configure Leave Policy
   * POST /api/addLeavePolicy
   */
  static async addLeavePolicy(req, res) {
    try {
      const {
        leaveTypeId,
        leaveType: leaveTypeInput,
        policyTitle,

        // Quota
        annualLeaveQuota,
        leaveQuota,
        annualAllowedDays,
        leaveBalance,

        // Accrual Mode
        accrualMode,

        // Carry Forward Cap
        isCarryForwardEnabled,
        carryForward,
        maxCarryForwardDays,
        carryForwardCap,

        // Advance Notice Period
        advanceNoticePeriod,
        advanceNoticeDays,
        noticePeriod,

        // Max Consecutive Days
        maxConsecutiveDays,

        // Approval Workflow
        approvalWorkflow,
        approvalChain,

        status = "Active",
      } = req.body;

      const targetTypeId = leaveTypeId || leaveTypeInput;
      if (!targetTypeId) {
        return sendBadRequestResponse(
          res,
          "Leave Type selection is required! Please select an existing Leave Type."
        );
      }

      let leaveTypeDoc = null;
      if (mongoose.Types.ObjectId.isValid(String(targetTypeId).trim())) {
        leaveTypeDoc = await LeaveTypeModel.findOne({
          _id: String(targetTypeId).trim(),
          isDeleted: false,
        });
      } else {
        leaveTypeDoc = await LeaveTypeModel.findOne({
          leaveTypeName: { $regex: new RegExp(`^${String(targetTypeId).trim()}$`, "i") },
          isDeleted: false,
        });
      }

      if (!leaveTypeDoc) {
        return sendNotFoundResponse(
          res,
          "Selected Leave Type not found. Please choose a valid Leave Type."
        );
      }

      // 1. Quota
      const rawQuota =
        annualLeaveQuota !== undefined
          ? annualLeaveQuota
          : leaveQuota !== undefined
            ? leaveQuota
            : annualAllowedDays !== undefined
              ? annualAllowedDays
              : leaveBalance;

      if (rawQuota === undefined || rawQuota === null || rawQuota === "") {
        return sendBadRequestResponse(res, "Annual Leave Quota (leaveQuota) is required!");
      }

      const quotaNum = Number(rawQuota);
      if (isNaN(quotaNum) || quotaNum < 0) {
        return sendBadRequestResponse(res, "Annual Leave Quota must be a non-negative number!");
      }

      // 2. Accrual Mode
      const finalAccrualMode = normalizeAccrualMode(accrualMode);

      // 3. Carry Forward Cap
      let isCFEnabled = true;
      if (isCarryForwardEnabled !== undefined) {
        isCFEnabled =
          typeof isCarryForwardEnabled === "boolean"
            ? isCarryForwardEnabled
            : String(isCarryForwardEnabled).toLowerCase() === "true";
      } else if (carryForward !== undefined) {
        isCFEnabled =
          typeof carryForward === "boolean"
            ? carryForward
            : String(carryForward).toLowerCase() === "true";
      } else if (carryForwardCap && String(carryForwardCap).toLowerCase().includes("lapse")) {
        isCFEnabled = false;
      }

      let maxCFDays = 0;
      let finalCFCap = "Lapses at Year-End";
      if (isCFEnabled) {
        const rawCF = maxCarryForwardDays !== undefined ? maxCarryForwardDays : carryForwardCap;
        maxCFDays = parseDaysFromInput(rawCF, 5);
        finalCFCap = maxCFDays > 0 ? `${maxCFDays} Days` : "5 Days";
      }

      // 4. Advance Notice Period
      const rawNotice =
        advanceNoticeDays !== undefined
          ? advanceNoticeDays
          : advanceNoticePeriod !== undefined
            ? advanceNoticePeriod
            : noticePeriod;
      const finalNoticeDays = parseDaysFromInput(rawNotice, 2);
      const finalNoticePeriod =
        finalNoticeDays === 0 ? "0 Days (Same-day)" : `${finalNoticeDays} Days Before`;

      // 5. Max Consecutive Days
      const finalMaxConsecutive = parseDaysFromInput(maxConsecutiveDays, 5);

      // 6. Approval Workflow
      const finalApproval = normalizeApprovalWorkflow(approvalWorkflow || approvalChain);

      // 7. Policy Title
      const cleanTitle =
        policyTitle && String(policyTitle).trim()
          ? String(policyTitle).trim()
          : leaveTypeDoc.leaveTypeName;

      // Check if policy already exists for this Leave Type
      let policy = await LeavePolicyModel.findOne({
        leaveType: leaveTypeDoc._id,
        isDeleted: false,
      });

      if (policy) {
        policy.policyTitle = cleanTitle;
        policy.leaveQuota = quotaNum;
        policy.accrualMode = finalAccrualMode;
        policy.isCarryForwardEnabled = isCFEnabled;
        policy.maxCarryForwardDays = maxCFDays;
        policy.carryForwardCap = finalCFCap;
        policy.advanceNoticeDays = finalNoticeDays;
        policy.noticePeriod = finalNoticePeriod;
        policy.maxConsecutiveDays = finalMaxConsecutive;
        policy.approvalWorkflow = finalApproval;
        policy.approvalChain = finalApproval;
        if (status && ["Active", "Inactive"].includes(status)) policy.status = status;
        await policy.save();

        // Sync quota to leaveTypeDoc for convenience
        leaveTypeDoc.leaveBalance = quotaNum;
        await leaveTypeDoc.save();

        const populated = await LeavePolicyModel.findById(policy._id).populate(
          "leaveType",
          "leaveTypeName icon color allowHalfDay requiresApproval description leaveBalance"
        );

        return sendSuccessResponse(
          res,
          `Leave policy for '${leaveTypeDoc.leaveTypeName}' configured successfully!`,
          populated
        );
      }

      policy = await LeavePolicyModel.create({
        leaveType: leaveTypeDoc._id,
        policyTitle: cleanTitle,
        leaveQuota: quotaNum,
        accrualMode: finalAccrualMode,
        isCarryForwardEnabled: isCFEnabled,
        maxCarryForwardDays: maxCFDays,
        carryForwardCap: finalCFCap,
        advanceNoticeDays: finalNoticeDays,
        noticePeriod: finalNoticePeriod,
        maxConsecutiveDays: finalMaxConsecutive,
        approvalWorkflow: finalApproval,
        approvalChain: finalApproval,
        status: ["Active", "Inactive"].includes(status) ? status : "Active",
      });

      // Sync quota to leaveTypeDoc
      leaveTypeDoc.leaveBalance = quotaNum;
      await leaveTypeDoc.save();

      const populated = await LeavePolicyModel.findById(policy._id).populate(
        "leaveType",
        "leaveTypeName icon color allowHalfDay requiresApproval description leaveBalance"
      );

      return sendCreatedResponse(
        res,
        `Leave policy for '${leaveTypeDoc.leaveTypeName}' created successfully!`,
        populated
      );
    } catch (error) {
      console.error("Add Leave Policy Error:", error);
      return sendErrorResponse(res, 500, "Failed to create or configure leave policy", error);
    }
  }

  /**
   * Get All Leave Policies (Organization Leave Rules screen)
   * GET /api/getAllLeavePolicies
   */
  static async getAllLeavePolicies(req, res) {
    try {
      const { search, status, page, limit, sortBy = "createdAt", order = "asc" } = req.query;

      const filter = { isDeleted: false };

      if (status && ["Active", "Inactive"].includes(status)) {
        filter.status = status;
      }

      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        const matchingLeaveTypes = await LeaveTypeModel.find({
          leaveTypeName: regex,
          isDeleted: false,
        }).select("_id");
        const typeIds = matchingLeaveTypes.map((t) => t._id);

        filter.$or = [
          { policyTitle: regex },
          { accrualMode: regex },
          { carryForwardCap: regex },
          { noticePeriod: regex },
          { approvalWorkflow: regex },
          { approvalChain: regex },
          { leaveType: { $in: typeIds } },
        ];
      }

      const sortOrder = order === "asc" ? 1 : -1;
      let query = LeavePolicyModel.find(filter)
        .populate("leaveType", "leaveTypeName icon color allowHalfDay requiresApproval description leaveBalance")
        .sort({ [sortBy]: sortOrder });

      const total = await LeavePolicyModel.countDocuments(filter);

      if (page && limit) {
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const skip = (pageNum - 1) * limitNum;
        query = query.skip(skip).limit(limitNum);
      }

      const leavePolicies = await query;

      return sendSuccessResponse(res, "Leave policies fetched successfully", {
        total,
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : total,
        totalPages: limit ? Math.ceil(total / parseInt(limit, 10)) : 1,
        leavePolicies,
      });
    } catch (error) {
      console.error("Get Leave Policies Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch leave policies", error);
    }
  }

  /**
   * Get Leave Policy By ID
   * GET /api/getLeavePolicyById/:id
   */
  static async getLeavePolicyById(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid leave policy ID");
      }

      const policy = await LeavePolicyModel.findOne({
        _id: id,
        isDeleted: false,
      }).populate("leaveType", "leaveTypeName icon color allowHalfDay requiresApproval description leaveBalance");

      if (!policy) {
        return sendNotFoundResponse(res, "Leave policy not found");
      }

      return sendSuccessResponse(res, "Leave policy details fetched successfully", policy);
    } catch (error) {
      console.error("Get Leave Policy By ID Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch leave policy details", error);
    }
  }

  /**
   * Update / Configure Leave Policy
   * PATCH /api/configureLeavePolicy/:id or PATCH /api/updateLeavePolicy/:id
   */
  static async updateLeavePolicy(req, res) {
    try {
      const { id } = req.params;
      const {
        policyTitle,

        // Quota
        annualLeaveQuota,
        leaveQuota,
        annualAllowedDays,
        leaveBalance,

        // Accrual Mode
        accrualMode,

        // Carry Forward Cap
        isCarryForwardEnabled,
        carryForward,
        maxCarryForwardDays,
        carryForwardCap,

        // Advance Notice Period
        advanceNoticePeriod,
        advanceNoticeDays,
        noticePeriod,

        // Max Consecutive Days
        maxConsecutiveDays,

        // Approval Workflow
        approvalWorkflow,
        approvalChain,

        status,
      } = req.body;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid leave policy ID");
      }

      const policy = await LeavePolicyModel.findOne({
        _id: id,
        isDeleted: false,
      });

      if (!policy) {
        return sendNotFoundResponse(res, "Leave policy not found");
      }

      if (policyTitle !== undefined) {
        policy.policyTitle = String(policyTitle).trim();
      }

      // Quota
      const rawQuota =
        annualLeaveQuota !== undefined
          ? annualLeaveQuota
          : leaveQuota !== undefined
            ? leaveQuota
            : annualAllowedDays !== undefined
              ? annualAllowedDays
              : leaveBalance;

      if (rawQuota !== undefined && rawQuota !== null && rawQuota !== "") {
        const quotaNum = Number(rawQuota);
        if (isNaN(quotaNum) || quotaNum < 0) {
          return sendBadRequestResponse(res, "Annual Leave Quota must be a non-negative number!");
        }
        policy.leaveQuota = quotaNum;

        // Sync to leaveType
        if (policy.leaveType) {
          await LeaveTypeModel.findByIdAndUpdate(policy.leaveType, { leaveBalance: quotaNum });
        }
      }

      // Accrual Mode
      if (accrualMode !== undefined) {
        policy.accrualMode = normalizeAccrualMode(accrualMode);
      }

      // Carry Forward
      if (isCarryForwardEnabled !== undefined || carryForward !== undefined) {
        const isCF =
          isCarryForwardEnabled !== undefined
            ? typeof isCarryForwardEnabled === "boolean"
              ? isCarryForwardEnabled
              : String(isCarryForwardEnabled).toLowerCase() === "true"
            : typeof carryForward === "boolean"
              ? carryForward
              : String(carryForward).toLowerCase() === "true";
        policy.isCarryForwardEnabled = isCF;
        if (!isCF) {
          policy.maxCarryForwardDays = 0;
          policy.carryForwardCap = "Lapses at Year-End";
        }
      }

      if (maxCarryForwardDays !== undefined || carryForwardCap !== undefined) {
        const rawCF = maxCarryForwardDays !== undefined ? maxCarryForwardDays : carryForwardCap;
        if (String(rawCF).toLowerCase().includes("lapse")) {
          policy.isCarryForwardEnabled = false;
          policy.maxCarryForwardDays = 0;
          policy.carryForwardCap = "Lapses at Year-End";
        } else {
          const parsedCF = parseDaysFromInput(rawCF, 5);
          policy.isCarryForwardEnabled = true;
          policy.maxCarryForwardDays = parsedCF;
          policy.carryForwardCap = parsedCF > 0 ? `${parsedCF} Days` : "5 Days";
        }
      }

      // Advance Notice Period
      if (
        advanceNoticeDays !== undefined ||
        advanceNoticePeriod !== undefined ||
        noticePeriod !== undefined
      ) {
        const rawNotice =
          advanceNoticeDays !== undefined
            ? advanceNoticeDays
            : advanceNoticePeriod !== undefined
              ? advanceNoticePeriod
              : noticePeriod;
        const parsedNotice = parseDaysFromInput(rawNotice, 2);
        policy.advanceNoticeDays = parsedNotice;
        policy.noticePeriod =
          parsedNotice === 0 ? "0 Days (Same-day)" : `${parsedNotice} Days Before`;
      }

      // Max Consecutive Days
      if (maxConsecutiveDays !== undefined) {
        const parsedMCD = parseDaysFromInput(maxConsecutiveDays, 5);
        if (parsedMCD > 0) policy.maxConsecutiveDays = parsedMCD;
      }

      // Approval Workflow
      if (approvalWorkflow !== undefined || approvalChain !== undefined) {
        const finalApproval = normalizeApprovalWorkflow(approvalWorkflow || approvalChain);
        policy.approvalWorkflow = finalApproval;
        policy.approvalChain = finalApproval;
      }

      if (status !== undefined && ["Active", "Inactive"].includes(status)) {
        policy.status = status;
      }

      await policy.save();

      const populated = await LeavePolicyModel.findById(policy._id).populate(
        "leaveType",
        "leaveTypeName icon color allowHalfDay requiresApproval description leaveBalance"
      );

      return sendSuccessResponse(res, "Leave policy updated successfully", populated);
    } catch (error) {
      console.error("Update Leave Policy Error:", error);
      return sendErrorResponse(res, 500, "Failed to update leave policy", error);
    }
  }

  /**
   * Delete Leave Policy (Hard delete directly from database)
   * DELETE /api/deleteLeavePolicy/:id
   */
  static async deleteLeavePolicy(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid leave policy ID");
      }

      const policy = await LeavePolicyModel.findById(id);

      if (!policy) {
        return sendNotFoundResponse(res, "Leave policy not found");
      }

      await LeavePolicyModel.findByIdAndDelete(id);

      return sendSuccessResponse(res, "Leave policy permanently deleted from database successfully");
    } catch (error) {
      console.error("Delete Leave Policy Error:", error);
      return sendErrorResponse(res, 500, "Failed to delete leave policy", error);
    }
  }
}
