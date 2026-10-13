import mongoose from "mongoose";
import DesignationModel, { DESIGNATION_LEVELS } from "../model/designation.model.js";
import DepartmentModel from "../model/department.model.js";
import UserModel from "../model/user.model.js";
import { uploadFile, deleteFileFromS3 } from "../middleware/imageupload.js";
import {
  sendCreatedResponse,
  sendSuccessResponse,
  sendErrorResponse,
  sendBadRequestResponse,
  sendNotFoundResponse,
} from "../utils/Response.utils.js";

export class DesignationController {
  static async addDesignation(req, res) {
    try {
      const {
        designationName,
        department,
        description = "",
        level = "",
      } = req.body;

      if (!designationName || !designationName.trim()) {
        return sendBadRequestResponse(res, "Designation name is required!");
      }

      if (!department || !department.trim()) {
        return sendBadRequestResponse(res, "Department is required!");
      }

      const cleanDeptId = department.trim();
      if (!mongoose.Types.ObjectId.isValid(cleanDeptId)) {
        return sendBadRequestResponse(res, "Invalid department ID!");
      }

      const existingDept = await DepartmentModel.findOne({
        _id: cleanDeptId,
        isDeleted: false,
      });

      if (!existingDept) {
        return sendNotFoundResponse(res, "Selected department not found!");
      }

      const cleanDesignationName = designationName.trim();

      const existingDesignation = await DesignationModel.findOne({
        designationName: { $regex: new RegExp(`^${cleanDesignationName}$`, "i") },
        department: cleanDeptId,
        isDeleted: false,
      });

      if (existingDesignation) {
        return res.status(409).json({
          success: false,
          message: `Designation '${cleanDesignationName}' already exists in this department.`,
        });
      }

      let iconUrl = null;
      if (req.file) {
        const uploadRes = await uploadFile(req.file);
        iconUrl = uploadRes.url;
      } else if (req.body.icon && typeof req.body.icon === "string" && req.body.icon.trim()) {
        iconUrl = req.body.icon.trim();
      }

      let normalizedLevel = "";
      if (level && level.trim()) {
        const matchedLevel = DESIGNATION_LEVELS.find(
          (l) => l.toLowerCase() === level.trim().toLowerCase()
        );
        if (!matchedLevel) {
          return sendBadRequestResponse(
            res,
            `Invalid level '${level}'. Allowed levels are: ${DESIGNATION_LEVELS.join(", ")}`
          );
        }
        normalizedLevel = matchedLevel;
      }

      const newDesignation = await DesignationModel.create({
        designationName: cleanDesignationName,
        department: cleanDeptId,
        icon: iconUrl,
        description: description ? description.trim() : "",
        level: normalizedLevel,
      });

      const populatedDesignation = await DesignationModel.findById(newDesignation._id).populate(
        "department",
        "departmentName icon color"
      );

      return sendCreatedResponse(
        res,
        "Designation created successfully!",
        populatedDesignation
      );
    } catch (error) {
      console.error("Add Designation Error:", error);
      return sendErrorResponse(res, 500, "Failed to create designation", error);
    }
  }

  static async getAllDesignations(req, res) {
    try {
      const { search, department, page, limit } = req.query;

      const filter = { isDeleted: false };

      if (department && department.trim() && mongoose.Types.ObjectId.isValid(department.trim())) {
        filter.department = department.trim();
      }

      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        filter.$or = [
          { designationName: regex },
          { description: regex },
          { level: regex },
        ];
      }

      let query = DesignationModel.find(filter)
        .populate("department", "departmentName icon color")

      const total = await DesignationModel.countDocuments(filter);

      if (page && limit) {
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const skip = (pageNum - 1) * limitNum;
        query = query.skip(skip).limit(limitNum);
      }

      const designations = await query.lean();

      const designationsWithCount = await Promise.all(
        designations.map(async (desig) => {
          const employeeCount = await UserModel.countDocuments({
            role: "employee",
            isUserDeleted: { $ne: true },
            designation: desig._id,
          });

          return {
            ...desig,
            employeeCount,
          };
        })
      );

      return sendSuccessResponse(res, "Designations fetched successfully", {
        total,
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : total,
        designations: designationsWithCount,
      });
    } catch (error) {
      console.error("Get Designations Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch designations", error);
    }
  }

  static async getDesignationById(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid designation ID");
      }

      const designation = await DesignationModel.findOne({
        _id: id,
        isDeleted: false,
      })
        .populate("department", "departmentName icon color")
        .lean();

      if (!designation) {
        return sendNotFoundResponse(res, "Designation not found");
      }

      const employees = await UserModel.find({
        role: "employee",
        isUserDeleted: { $ne: true },
        designation: designation._id,
      })
        .select("name firstName lastName email avatarUrl employeeId department employeeStatus phone")
        .sort({ name: 1 });

      designation.employeeCount = employees.length;
      designation.employees = employees;

      return sendSuccessResponse(
        res,
        "Designation details fetched successfully",
        designation
      );
    } catch (error) {
      console.error("Get Designation By ID Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch designation details", error);
    }
  }

  static async updateDesignation(req, res) {
    try {
      const { id } = req.params;
      const { designationName, department, description, level, status } = req.body;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid designation ID");
      }

      const designation = await DesignationModel.findOne({
        _id: id,
        isDeleted: false,
      });

      if (!designation) {
        return sendNotFoundResponse(res, "Designation not found");
      }

      const targetDeptId = department && department.trim() ? department.trim() : designation.department;
      if (department && department.trim()) {
        if (!mongoose.Types.ObjectId.isValid(targetDeptId)) {
          return sendBadRequestResponse(res, "Invalid department ID");
        }
        const deptExists = await DepartmentModel.findOne({ _id: targetDeptId, isDeleted: false });
        if (!deptExists) {
          return sendNotFoundResponse(res, "Selected department not found");
        }
        designation.department = targetDeptId;
      }

      if (designationName && designationName.trim()) {
        const cleanName = designationName.trim();
        const duplicate = await DesignationModel.findOne({
          _id: { $ne: id },
          department: targetDeptId,
          designationName: { $regex: new RegExp(`^${cleanName}$`, "i") },
          isDeleted: false,
        });

        if (duplicate) {
          return res.status(409).json({
            success: false,
            message: `Designation '${cleanName}' already exists in this department.`,
          });
        }
        designation.designationName = cleanName;
      }

      if (req.file) {
        if (designation.icon) {
          await deleteFileFromS3(designation.icon);
        }
        const uploadRes = await uploadFile(req.file);
        designation.icon = uploadRes.url;
      } else if (req.body.icon !== undefined) {
        const newIcon = req.body.icon ? req.body.icon.trim() : null;
        if (designation.icon && designation.icon !== newIcon) {
          await deleteFileFromS3(designation.icon);
        }
        designation.icon = newIcon;
      }

      if (description !== undefined) {
        designation.description = description.trim();
      }

      if (level !== undefined) {
        if (!level || level.trim() === "") {
          designation.level = "";
        } else {
          const matchedLevel = DESIGNATION_LEVELS.find(
            (l) => l.toLowerCase() === level.trim().toLowerCase()
          );
          if (!matchedLevel) {
            return sendBadRequestResponse(
              res,
              `Invalid level '${level}'. Allowed levels are: ${DESIGNATION_LEVELS.join(", ")}`
            );
          }
          designation.level = matchedLevel;
        }
      }

      if (status !== undefined && ["Active", "Inactive"].includes(status)) {
        designation.status = status;
      }

      await designation.save();

      const updatedDesignation = await DesignationModel.findById(designation._id).populate(
        "department",
        "departmentName icon color"
      );

      return sendSuccessResponse(
        res,
        "Designation updated successfully",
        updatedDesignation
      );
    } catch (error) {
      console.error("Update Designation Error:", error);
      return sendErrorResponse(res, 500, "Failed to update designation", error);
    }
  }

  static async deleteDesignation(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid designation ID");
      }

      const designation = await DesignationModel.findOne({
        _id: id,
        isDeleted: false,
      });

      if (!designation) {
        return sendNotFoundResponse(res, "Designation not found");
      }

      const employeeCount = await UserModel.countDocuments({
        role: "employee",
        isUserDeleted: { $ne: true },
        designation: designation._id,
      });

      if (designation.icon) {
        await deleteFileFromS3(designation.icon);
        designation.icon = null;
      }

      designation.isDeleted = true;
      await designation.save({ validateBeforeSave: false });

      return sendSuccessResponse(
        res,
        `Designation deleted successfully.${employeeCount > 0
          ? ` Note: ${employeeCount} employee(s) were assigned to this designation.`
          : ""
        }`,
        { id: designation._id, employeeCount }
      );
    } catch (error) {
      console.error("Delete Designation Error:", error);
      return sendErrorResponse(res, 500, "Failed to delete designation", error);
    }
  }

  static async getDesignationLevels(req, res) {
    return sendSuccessResponse(
      res,
      "Designation levels fetched successfully",
      DESIGNATION_LEVELS
    );
  }
}
