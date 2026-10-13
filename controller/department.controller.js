import mongoose from "mongoose";
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

export class DepartmentController {
  static async addDepartment(req, res) {
    try {
      const {
        departmentName,
        description = "",
        departmentHead,
        color,
      } = req.body;

      if (!departmentName || !departmentName.trim()) {
        return sendBadRequestResponse(res, "Department name is required!");
      }

      if (!color || !color.trim()) {
        return sendBadRequestResponse(res, "Department color is required!");
      }

      let iconUrl = null;
      if (req.file) {
        const uploadRes = await uploadFile(req.file);
        iconUrl = uploadRes.url;
      } else if (req.body.icon && typeof req.body.icon === "string" && req.body.icon.trim()) {
        iconUrl = req.body.icon.trim();
      }

      if (!iconUrl) {
        return sendBadRequestResponse(res, "Department icon/image is required!");
      }

      const cleanDeptName = departmentName.trim();

      const existingDept = await DepartmentModel.findOne({
        departmentName: { $regex: new RegExp(`^${cleanDeptName}$`, "i") },
        isDeleted: false,
      });

      if (existingDept) {
        return res.status(409).json({
          success: false,
          message: `Department '${cleanDeptName}' already exists.`,
        });
      }

      let validHeadId = null;
      if (
        departmentHead &&
        departmentHead !== "null" &&
        departmentHead !== "undefined" &&
        departmentHead.trim() !== ""
      ) {
        const headTrimmed = departmentHead.trim();
        if (mongoose.Types.ObjectId.isValid(headTrimmed)) {
          const headUser = await UserModel.findOne({
            _id: headTrimmed,
            isUserDeleted: { $ne: true },
          });

          if (!headUser) {
            return sendNotFoundResponse(
              res,
              "Selected Department Head employee was not found."
            );
          }
          validHeadId = headUser._id;
        } else {
          return sendBadRequestResponse(res, "Invalid Department Head ID.");
        }
      }

      const newDepartment = await DepartmentModel.create({
        departmentName: cleanDeptName,
        icon: iconUrl,
        description: description ? description.trim() : "",
        departmentHead: validHeadId,
        color: color ? color.trim() : "#3B82F6",
      });

      const populatedDept = await DepartmentModel.findById(newDepartment._id).populate(
        "departmentHead",
        "name firstName lastName email avatarUrl employeeId designation phone"
      );

      return sendCreatedResponse(
        res,
        "Department created successfully!",
        populatedDept
      );
    } catch (error) {
      console.error("Add Department Error:", error);
      return sendErrorResponse(
        res,
        500,
        "Failed to create department",
        error
      );
    }
  }

  static async getAllDepartments(req, res) {
    try {
      const { search, page, limit } = req.query;

      const filter = { isDeleted: false };

      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        filter.$or = [{ departmentName: regex }, { description: regex }];
      }

      let query = DepartmentModel.find(filter)
        .populate(
          "departmentHead",
          "name firstName lastName email avatarUrl employeeId designation phone"
        )

      const total = await DepartmentModel.countDocuments(filter);

      if (page && limit) {
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const skip = (pageNum - 1) * limitNum;
        query = query.skip(skip).limit(limitNum);
      }

      const departments = await query.lean();

      const departmentsWithCount = await Promise.all(
        departments.map(async (dept) => {
          const employeeCount = await UserModel.countDocuments({
            role: "employee",
            isUserDeleted: { $ne: true },
            department: dept._id,
          });

          return {
            ...dept,
            employeeCount,
          };
        })
      );

      return sendSuccessResponse(res, "Departments fetched successfully", {
        total,
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : total,
        departments: departmentsWithCount,
      });
    } catch (error) {
      console.error("Get Departments Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch departments", error);
    }
  }

  static async getDepartmentById(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid department ID");
      }

      const department = await DepartmentModel.findOne({
        _id: id,
        isDeleted: false,
      })
        .populate(
          "departmentHead",
          "name firstName lastName email avatarUrl employeeId designation phone"
        )
        .lean();

      if (!department) {
        return sendNotFoundResponse(res, "Department not found");
      }

      const employees = await UserModel.find({
        role: "employee",
        isUserDeleted: { $ne: true },
        department: department._id,
      })
        .select("name firstName lastName email avatarUrl employeeId designation employeeStatus phone")
        .sort({ name: 1 });

      department.employeeCount = employees.length;
      department.employees = employees;

      return sendSuccessResponse(
        res,
        "Department details fetched successfully",
        department
      );
    } catch (error) {
      console.error("Get Department By ID Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch department details", error);
    }
  }

  static async updateDepartment(req, res) {
    try {
      const { id } = req.params;
      const { departmentName, description, departmentHead, color, status } =
        req.body;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid department ID");
      }

      const department = await DepartmentModel.findOne({
        _id: id,
        isDeleted: false,
      });

      if (!department) {
        return sendNotFoundResponse(res, "Department not found");
      }

      if (departmentName && departmentName.trim()) {
        const cleanName = departmentName.trim();
        const duplicate = await DepartmentModel.findOne({
          _id: { $ne: id },
          departmentName: { $regex: new RegExp(`^${cleanName}$`, "i") },
          isDeleted: false,
        });

        if (duplicate) {
          return res.status(409).json({
            success: false,
            message: `Department '${cleanName}' already exists.`,
          });
        }
        department.departmentName = cleanName;
      }

      if (req.file) {
        if (department.icon) {
          await deleteFileFromS3(department.icon);
        }
        const uploadRes = await uploadFile(req.file);
        department.icon = uploadRes.url;
      } else if (req.body.icon !== undefined) {
        const newIcon = req.body.icon ? req.body.icon.trim() : null;
        if (department.icon && department.icon !== newIcon) {
          await deleteFileFromS3(department.icon);
        }
        department.icon = newIcon;
      }

      if (description !== undefined) {
        department.description = description.trim();
      }

      if (color !== undefined) {
        department.color = color.trim();
      }

      if (status !== undefined) {
        if (["Active", "Inactive"].includes(status)) {
          department.status = status;
        }
      }

      if (departmentHead !== undefined) {
        if (!departmentHead || departmentHead === "null" || departmentHead === "") {
          department.departmentHead = null;
        } else if (mongoose.Types.ObjectId.isValid(departmentHead.trim())) {
          const headUser = await UserModel.findOne({
            _id: departmentHead.trim(),
            isUserDeleted: { $ne: true },
          });
          if (!headUser) {
            return sendNotFoundResponse(res, "Selected Department Head not found.");
          }
          department.departmentHead = headUser._id;
        } else {
          return sendBadRequestResponse(res, "Invalid Department Head ID.");
        }
      }

      await department.save();

      const updatedDept = await DepartmentModel.findById(department._id).populate(
        "departmentHead",
        "name firstName lastName email avatarUrl employeeId designation phone"
      );

      return sendSuccessResponse(
        res,
        "Department updated successfully",
        updatedDept
      );
    } catch (error) {
      console.error("Update Department Error:", error);
      return sendErrorResponse(res, 500, "Failed to update department", error);
    }
  }

  static async deleteDepartment(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid department ID");
      }

      const department = await DepartmentModel.findOne({
        _id: id,
        isDeleted: false,
      });

      if (!department) {
        return sendNotFoundResponse(res, "Department not found");
      }

      const employeeCount = await UserModel.countDocuments({
        role: "employee",
        isUserDeleted: { $ne: true },
        department: department._id,
      });

      if (department.icon) {
        await deleteFileFromS3(department.icon);
        department.icon = null;
      }

      department.isDeleted = true;
      await department.save({ validateBeforeSave: false });

      return sendSuccessResponse(
        res,
        `Department deleted successfully.${employeeCount > 0
          ? ` Note: ${employeeCount} employee(s) were assigned to this department.`
          : ""
        }`,
        { id: department._id, employeeCount }
      );
    } catch (error) {
      console.error("Delete Department Error:", error);
      return sendErrorResponse(res, 500, "Failed to delete department", error);
    }
  }

  static async getDepartmentHeadsList(req, res) {
    try {
      const employees = await UserModel.find({
        role: "employee",
        isUserDeleted: { $ne: true },
      })
        .select("_id name firstName lastName email avatarUrl employeeId designation department")
        .sort({ name: 1 });

      return sendSuccessResponse(
        res,
        "Department heads list fetched successfully",
        employees
      );
    } catch (error) {
      console.error("Get Department Heads List Error:", error);
      return sendErrorResponse(
        res,
        500,
        "Failed to fetch employee list",
        error
      );
    }
  }
}
