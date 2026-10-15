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
    leaveBalance: 12,
    description: "Casual leave for personal or urgent matters",
    allowHalfDay: true,
    requiresApproval: true,
    color: "#EF4444",
  },
  {
    leaveTypeName: "Sick Leave",
    leaveBalance: 10,
    description: "Leave for medical issues and illness recovery",
    allowHalfDay: true,
    requiresApproval: true,
    color: "#EF4444",
  },
  {
    leaveTypeName: "Annual Leave",
    leaveBalance: 20,
    description: "Earned annual leave for vacation and rest",
    allowHalfDay: true,
    requiresApproval: true,
    color: "#EF4444",
  },
  {
    leaveTypeName: "Maternity Leave",
    leaveBalance: 90,
    description: "Maternity leave for female employees",
    allowHalfDay: false,
    requiresApproval: true,
    color: "#EF4444",
  },
  {
    leaveTypeName: "Paternity Leave",
    leaveBalance: 15,
    description: "Paternity leave for new fathers",
    allowHalfDay: false,
    requiresApproval: true,
    color: "#EF4444",
  },
  {
    leaveTypeName: "Unpaid Leave",
    leaveBalance: 0,
    description: "Leave without pay when leave quota is exhausted",
    allowHalfDay: true,
    requiresApproval: true,
    color: "#EF4444",
  },
  {
    leaveTypeName: "Work From Home",
    leaveBalance: 30,
    description: "Remote work allowance per year",
    allowHalfDay: true,
    requiresApproval: true,
    color: "#EF4444",
  },
];

export class LeaveTypeController {
  static async addLeaveType(req, res) {
    try {
      const {
        leaveTypeName,
        leaveBalance,
        description = "",
        allowHalfDay = true,
        requiresApproval = true,
        color = "#EF4444",
        status = "Active",
      } = req.body;

      if (!leaveTypeName || !leaveTypeName.trim()) {
        return sendBadRequestResponse(res, "Leave type name is required!");
      }

      if (leaveBalance === undefined || leaveBalance === null || leaveBalance === "") {
        return sendBadRequestResponse(res, "Leave balance in days is required!");
      }

      const balanceNum = Number(leaveBalance);
      if (isNaN(balanceNum) || balanceNum < 0) {
        return sendBadRequestResponse(res, "Leave balance must be a non-negative number!");
      }

      const cleanName = leaveTypeName.trim();

      const existing = await LeaveTypeModel.findOne({
        leaveTypeName: { $regex: new RegExp(`^${cleanName}$`, "i") },
        isDeleted: false,
      });

      if (existing) {
        return res.status(409).json({
          success: false,
          message: `Leave type '${cleanName}' already exists.`,
        });
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

      const newLeaveType = await LeaveTypeModel.create({
        leaveTypeName: cleanName,
        leaveBalance: balanceNum,
        icon: iconUrl,
        description: description ? description.trim() : "",
        allowHalfDay: isAllowHalfDay,
        requiresApproval: isRequiresApproval,
        color: color ? color.trim() : "#EF4444",
        status: ["Active", "Inactive"].includes(status) ? status : "Active",
      });

      return sendCreatedResponse(
        res,
        "Leave type created successfully!",
        newLeaveType
      );
    } catch (error) {
      console.error("Add Leave Type Error:", error);
      return sendErrorResponse(res, 500, "Failed to create leave type", error);
    }
  }

  static async getAllLeaveTypes(req, res) {
    try {
      const { search, status, page, limit, sortBy = "createdAt", order = "asc" } = req.query;

      const existingCount = await LeaveTypeModel.countDocuments({ isDeleted: false });
      if (existingCount === 0 && !search) {
        await LeaveTypeModel.insertMany(DEFAULT_LEAVE_TYPES);
      }

      const filter = { isDeleted: false };

      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        filter.$or = [{ leaveTypeName: regex }, { description: regex }];
      }

      if (status && ["Active", "Inactive"].includes(status)) {
        filter.status = status;
      }

      const sortOrder = order === "asc" ? 1 : -1;
      let query = LeaveTypeModel.find(filter).sort({ [sortBy]: sortOrder });

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
      });

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
        leaveBalance,
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

      if (leaveTypeName && leaveTypeName.trim() !== leaveType.leaveTypeName) {
        const cleanName = leaveTypeName.trim();
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

      if (leaveBalance !== undefined && leaveBalance !== null && leaveBalance !== "") {
        const balanceNum = Number(leaveBalance);
        if (isNaN(balanceNum) || balanceNum < 0) {
          return sendBadRequestResponse(res, "Leave balance must be a non-negative number!");
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

      const leaveType = await LeaveTypeModel.findOne({
        _id: id,
        isDeleted: false,
      });

      if (!leaveType) {
        return sendNotFoundResponse(res, "Leave type not found");
      }

      leaveType.isDeleted = true;
      await leaveType.save();

      return sendSuccessResponse(res, "Leave type deleted successfully");
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
