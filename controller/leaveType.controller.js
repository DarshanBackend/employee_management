import mongoose from "mongoose";
import LeaveTypeModel from "../model/leaveType.model.js";
import { uploadFile, deleteFileFromS3 } from "../middleware/imageupload.js";
import {
  sendCreatedResponse,
  sendSuccessResponse,
  sendErrorResponse,
  sendBadRequestResponse,
  sendNotFoundResponse,
} from "../utils/Response.utils.js";

export const DEFAULT_LEAVE_TYPES = [
  {
    leaveTypeName: "Casual Leave",
    leaveBalance: 15,
    description: "Casual leave for personal or urgent matters",
    accrualMode: "Annual full quota",
    carryForwardCap: "7 Days",
    maxConsecutiveDays: 10,
    noticePeriod: "2 Days in Advance",
    approvalChain: "Reporting Manager",
    allowHalfDay: true,
    requiresApproval: true,
    color: "#EF4444",
  },
  {
    leaveTypeName: "Sick Leave",
    leaveBalance: 10,
    description: "Leave for medical issues and illness recovery",
    accrualMode: "Monthly accrual (half day allowed)",
    carryForwardCap: "5 Days",
    maxConsecutiveDays: 7,
    noticePeriod: "2 Days in Advance",
    approvalChain: "Reporting Manager",
    allowHalfDay: true,
    requiresApproval: true,
    color: "#EF4444",
  },
  {
    leaveTypeName: "Annual Leave",
    leaveBalance: 20,
    description: "Earned annual leave for vacation and rest",
    accrualMode: "Monthly accrual (half day allowed)",
    carryForwardCap: "10 Days",
    maxConsecutiveDays: 14,
    noticePeriod: "2 Days in Advance",
    approvalChain: "Reporting Manager",
    allowHalfDay: true,
    requiresApproval: true,
    color: "#EF4444",
  },
  {
    leaveTypeName: "Maternity Leave",
    leaveBalance: 90,
    description: "Maternity leave for female employees",
    accrualMode: "Monthly accrual (half day allowed)",
    carryForwardCap: "45 Days",
    maxConsecutiveDays: 30,
    noticePeriod: "2 Days in Advance",
    approvalChain: "Reporting Manager",
    allowHalfDay: false,
    requiresApproval: true,
    color: "#EF4444",
  },
  {
    leaveTypeName: "Unpaid Leave",
    leaveBalance: 0,
    description: "Leave without pay when leave quota is exhausted",
    accrualMode: "Monthly accrual (half day allowed)",
    carryForwardCap: "Lapses at Year-End",
    maxConsecutiveDays: 3,
    noticePeriod: "2 Days in Advance",
    approvalChain: "Reporting Manager",
    allowHalfDay: true,
    requiresApproval: true,
    color: "#EF4444",
  },
  {
    leaveTypeName: "Paternity Leave",
    leaveBalance: 15,
    description: "Paternity leave for new fathers",
    accrualMode: "Annual full quota",
    carryForwardCap: "Lapses at Year-End",
    maxConsecutiveDays: 15,
    noticePeriod: "7 Days in Advance",
    approvalChain: "Reporting Manager",
    allowHalfDay: false,
    requiresApproval: true,
    color: "#6366F1",
  },
];

export class LeaveTypeController {
  static async addLeaveType(req, res) {
    try {
      const {
        leaveTypeId,
        leaveTypeName,
        policyTitle,
        leaveBalance,
        annualAllowedDays,
        leaveQuota,
        accrualMode = "Monthly accrual (half day allowed)",
        carryForwardCap = "Lapses at Year-End",
        maxConsecutiveDays = 7,
        noticePeriod = "2 Days in Advance",
        approvalChain = "Reporting Manager",
        description = "",
        allowHalfDay = true,
        requiresApproval = true,
        color = "#EF4444",
        status = "Active",
      } = req.body;

      const rawBalance =
        leaveQuota !== undefined
          ? leaveQuota
          : leaveBalance !== undefined
          ? leaveBalance
          : annualAllowedDays;

      let balanceNum = 0;
      if (rawBalance !== undefined && rawBalance !== null && rawBalance !== "") {
        balanceNum = Number(rawBalance);
        if (isNaN(balanceNum) || balanceNum < 0) {
          return sendBadRequestResponse(res, "Annual leave quota / allowed days must be a non-negative number!");
        }
      }

      let iconUrl = null;
      if (req.file) {
        const uploadRes = await uploadFile(req.file);
        iconUrl = uploadRes.url;
      } else if (req.body.icon && typeof req.body.icon === "string" && req.body.icon.trim()) {
        iconUrl = req.body.icon.trim();
      }

      const isAllowHalfDay =
        typeof allowHalfDay === "boolean"
          ? allowHalfDay
          : String(allowHalfDay).toLowerCase() === "true";

      const isRequiresApproval =
        typeof requiresApproval === "boolean"
          ? requiresApproval
          : String(requiresApproval).toLowerCase() === "true";

      // Case 1: Existing Leave Type selected by ID (from dropdown)
      if (leaveTypeId && mongoose.Types.ObjectId.isValid(String(leaveTypeId).trim())) {
        const existingById = await LeaveTypeModel.findOne({
          _id: String(leaveTypeId).trim(),
          isDeleted: false,
        });

        if (!existingById) {
          return sendNotFoundResponse(res, "Selected leave type not found!");
        }

        if (rawBalance !== undefined && rawBalance !== null && rawBalance !== "") {
          existingById.leaveBalance = balanceNum;
        }
        if (accrualMode !== undefined) existingById.accrualMode = String(accrualMode).trim();
        if (carryForwardCap !== undefined) existingById.carryForwardCap = String(carryForwardCap).trim();
        if (maxConsecutiveDays !== undefined) {
          const mcd = Number(maxConsecutiveDays);
          if (!isNaN(mcd) && mcd > 0) existingById.maxConsecutiveDays = mcd;
        }
        if (noticePeriod !== undefined) existingById.noticePeriod = String(noticePeriod).trim();
        if (approvalChain !== undefined) existingById.approvalChain = String(approvalChain).trim();
        if (description) existingById.description = String(description).trim();
        if (iconUrl) existingById.icon = iconUrl;
        if (color) existingById.color = String(color).trim();
        if (allowHalfDay !== undefined) existingById.allowHalfDay = isAllowHalfDay;
        if (requiresApproval !== undefined) existingById.requiresApproval = isRequiresApproval;
        if (status && ["Active", "Inactive"].includes(status)) existingById.status = status;

        const title = leaveTypeName || policyTitle;
        if (title && String(title).trim()) {
          existingById.leaveTypeName = String(title).trim();
        }

        await existingById.save();
        return sendSuccessResponse(
          res,
          `Leave policy for '${existingById.leaveTypeName}' configured successfully!`,
          existingById
        );
      }

      // Case 2: Named policy or custom leave type
      const title = leaveTypeName || policyTitle;
      if (!title || !String(title).trim()) {
        return sendBadRequestResponse(res, "Please select an existing leave type or provide a Policy / Leave Title!");
      }

      const cleanName = String(title).trim();

      // Check if this leave type already exists in DB
      const existingByName = await LeaveTypeModel.findOne({
        leaveTypeName: { $regex: new RegExp(`^${cleanName}$`, "i") },
        isDeleted: false,
      });

      if (existingByName) {
        // Update the existing policy configuration
        if (rawBalance !== undefined && rawBalance !== null && rawBalance !== "") {
          existingByName.leaveBalance = balanceNum;
        }
        if (accrualMode !== undefined) existingByName.accrualMode = String(accrualMode).trim();
        if (carryForwardCap !== undefined) existingByName.carryForwardCap = String(carryForwardCap).trim();
        if (maxConsecutiveDays !== undefined) {
          const mcd = Number(maxConsecutiveDays);
          if (!isNaN(mcd) && mcd > 0) existingByName.maxConsecutiveDays = mcd;
        }
        if (noticePeriod !== undefined) existingByName.noticePeriod = String(noticePeriod).trim();
        if (approvalChain !== undefined) existingByName.approvalChain = String(approvalChain).trim();
        if (description) existingByName.description = String(description).trim();
        if (iconUrl) existingByName.icon = iconUrl;
        if (color) existingByName.color = String(color).trim();
        if (allowHalfDay !== undefined) existingByName.allowHalfDay = isAllowHalfDay;
        if (requiresApproval !== undefined) existingByName.requiresApproval = isRequiresApproval;
        if (status && ["Active", "Inactive"].includes(status)) existingByName.status = status;

        await existingByName.save();
        return sendSuccessResponse(
          res,
          `Leave policy for '${existingByName.leaveTypeName}' updated successfully!`,
          existingByName
        );
      }

      // Case 3: Create brand new leave policy
      if (rawBalance === undefined || rawBalance === null || rawBalance === "") {
        return sendBadRequestResponse(res, "Annual leave quota / allowed days is required!");
      }

      const newLeaveType = await LeaveTypeModel.create({
        leaveTypeName: cleanName,
        leaveBalance: balanceNum,
        accrualMode: String(accrualMode).trim(),
        carryForwardCap: String(carryForwardCap).trim(),
        maxConsecutiveDays: Number(maxConsecutiveDays) || 7,
        noticePeriod: String(noticePeriod).trim(),
        approvalChain: String(approvalChain).trim(),
        icon: iconUrl,
        description: description ? description.trim() : "",
        allowHalfDay: isAllowHalfDay,
        requiresApproval: isRequiresApproval,
        color: color ? color.trim() : "#EF4444",
        status: ["Active", "Inactive"].includes(status) ? status : "Active",
      });

      return sendCreatedResponse(
        res,
        `Leave policy '${newLeaveType.leaveTypeName}' created successfully!`,
        newLeaveType
      );
    } catch (error) {
      console.error("Add Leave Type / Policy Error:", error);
      return sendErrorResponse(res, 500, "Failed to create or configure leave policy", error);
    }
  }

  static async getLeaveTypeDropdown(req, res) {
    try {
      const leaveTypes = await LeaveTypeModel.find({
        isDeleted: false,
        status: "Active",
      })
        .select("_id leaveTypeName leaveBalance color icon allowHalfDay requiresApproval")
        .sort({ leaveTypeName: 1 });

      return sendSuccessResponse(res, "Leave types dropdown list fetched successfully", leaveTypes);
    } catch (error) {
      console.error("Get Leave Type Dropdown Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch leave types dropdown", error);
    }
  }

  static async getAllLeaveTypes(req, res) {
    try {
      const { search, status, page, limit, sortBy = "createdAt", order = "asc" } = req.query;

      const filter = { isDeleted: false };

      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        filter.$or = [{ leaveTypeName: regex }, { description: regex }];
      }

      if (status && ["Active", "Inactive"].includes(status)) {
        filter.status = status;
      }

      const sortOrder = order === "asc" ? 1 : -1;
      let query = LeaveTypeModel.find(filter)
        .select("_id leaveTypeName leaveBalance icon description allowHalfDay requiresApproval color status createdAt updatedAt")
        .sort({ [sortBy]: sortOrder });

      const total = await LeaveTypeModel.countDocuments(filter);

      if (page && limit) {
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const skip = (pageNum - 1) * limitNum;
        query = query.skip(skip).limit(limitNum);
      }

      const leaveTypes = await query;

      return sendSuccessResponse(res, "Leave types fetched successfully", {
        total,
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : total,
        totalPages: limit ? Math.ceil(total / parseInt(limit, 10)) : 1,
        leaveTypes,
      });
    } catch (error) {
      console.error("Get Leave Types Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch leave types", error);
    }
  }

  static async getLeaveTypeById(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid leave type ID");
      }

      const leaveType = await LeaveTypeModel.findOne({
        _id: id,
        isDeleted: false,
      }).select("_id leaveTypeName leaveBalance icon description allowHalfDay requiresApproval color status createdAt updatedAt");

      if (!leaveType) {
        return sendNotFoundResponse(res, "Leave type not found");
      }

      return sendSuccessResponse(
        res,
        "Leave type details fetched successfully",
        leaveType
      );
    } catch (error) {
      console.error("Get Leave Type By ID Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch leave type details", error);
    }
  }

  static async updateLeaveType(req, res) {
    try {
      const { id } = req.params;
      const {
        leaveTypeName,
        policyTitle,
        leaveBalance,
        annualAllowedDays,
        leaveQuota,
        accrualMode,
        carryForwardCap,
        maxConsecutiveDays,
        noticePeriod,
        approvalChain,
        description,
        allowHalfDay,
        requiresApproval,
        color,
        status,
      } = req.body;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid leave type ID");
      }

      const leaveType = await LeaveTypeModel.findOne({
        _id: id,
        isDeleted: false,
      });

      if (!leaveType) {
        return sendNotFoundResponse(res, "Leave type not found");
      }

      const title = leaveTypeName || policyTitle;
      if (title && title.trim() !== leaveType.leaveTypeName) {
        const cleanName = title.trim();
        const duplicate = await LeaveTypeModel.findOne({
          _id: { $ne: id },
          leaveTypeName: { $regex: new RegExp(`^${cleanName}$`, "i") },
          isDeleted: false,
        });

        if (duplicate) {
          return res.status(409).json({
            success: false,
            message: `Leave type '${cleanName}' already exists.`,
          });
        }
        leaveType.leaveTypeName = cleanName;
      }

      const rawBalance =
        leaveQuota !== undefined
          ? leaveQuota
          : leaveBalance !== undefined
          ? leaveBalance
          : annualAllowedDays;

      if (rawBalance !== undefined && rawBalance !== null && rawBalance !== "") {
        const balanceNum = Number(rawBalance);
        if (isNaN(balanceNum) || balanceNum < 0) {
          return sendBadRequestResponse(res, "Leave balance / quota must be a non-negative number!");
        }
        leaveType.leaveBalance = balanceNum;
      }

      if (req.file) {
        if (leaveType.icon) {
          await deleteFileFromS3(leaveType.icon);
        }
        const uploadRes = await uploadFile(req.file);
        leaveType.icon = uploadRes.url;
      } else if (req.body.icon !== undefined) {
        const newIcon = req.body.icon ? req.body.icon.trim() : null;
        if (leaveType.icon && leaveType.icon !== newIcon) {
          await deleteFileFromS3(leaveType.icon);
        }
        leaveType.icon = newIcon;
      }

      if (description !== undefined) {
        leaveType.description = description.trim();
      }

      if (allowHalfDay !== undefined) {
        leaveType.allowHalfDay =
          typeof allowHalfDay === "boolean"
            ? allowHalfDay
            : String(allowHalfDay).toLowerCase() === "true";
      }

      if (requiresApproval !== undefined) {
        leaveType.requiresApproval =
          typeof requiresApproval === "boolean"
            ? requiresApproval
            : String(requiresApproval).toLowerCase() === "true";
      }

      if (color !== undefined) {
        leaveType.color = color.trim();
      }

      if (accrualMode !== undefined) {
        leaveType.accrualMode = String(accrualMode).trim();
      }

      if (carryForwardCap !== undefined) {
        leaveType.carryForwardCap = String(carryForwardCap).trim();
      }

      if (maxConsecutiveDays !== undefined) {
        const mcd = Number(maxConsecutiveDays);
        if (!isNaN(mcd) && mcd > 0) leaveType.maxConsecutiveDays = mcd;
      }

      if (noticePeriod !== undefined) {
        leaveType.noticePeriod = String(noticePeriod).trim();
      }

      if (approvalChain !== undefined) {
        leaveType.approvalChain = String(approvalChain).trim();
      }

      if (status !== undefined && ["Active", "Inactive"].includes(status)) {
        leaveType.status = status;
      }

      await leaveType.save();

      return sendSuccessResponse(
        res,
        "Leave type updated successfully",
        leaveType
      );
    } catch (error) {
      console.error("Update Leave Type Error:", error);
      return sendErrorResponse(res, 500, "Failed to update leave type", error);
    }
  }

  static async deleteLeaveType(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid leave type ID");
      }

      const leaveType = await LeaveTypeModel.findById(id);

      if (!leaveType) {
        return sendNotFoundResponse(res, "Leave type not found");
      }

      if (leaveType.icon) {
        try {
          await deleteFileFromS3(leaveType.icon);
        } catch (s3Err) {
          console.warn("Failed to delete icon from S3:", s3Err);
        }
      }

      await LeaveTypeModel.findByIdAndDelete(id);

      return sendSuccessResponse(res, "Leave type permanently deleted from database successfully");
    } catch (error) {
      console.error("Delete Leave Type Error:", error);
      return sendErrorResponse(res, 500, "Failed to delete leave type", error);
    }
  }

  static async seedDefaultLeaveTypes(req, res) {
    try {
      for (const item of DEFAULT_LEAVE_TYPES) {
        await LeaveTypeModel.findOneAndUpdate(
          { leaveTypeName: item.leaveTypeName, isDeleted: false },
          { $setOnInsert: item },
          { upsert: true, new: true }
        );
      }

      const leaveTypes = await LeaveTypeModel.find({ isDeleted: false });
      return sendSuccessResponse(
        res,
        "Default leave types seeded successfully",
        leaveTypes
      );
    } catch (error) {
      console.error("Seed Leave Types Error:", error);
      return sendErrorResponse(res, 500, "Failed to seed default leave types", error);
    }
  }
}
