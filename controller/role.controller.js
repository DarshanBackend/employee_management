import mongoose from "mongoose";
import RoleModel from "../model/role.model.js";
import UserModel from "../model/user.model.js";
import { recordAuditLog } from "../utils/auditLogger.js";
import {
  sendCreatedResponse,
  sendSuccessResponse,
  sendErrorResponse,
  sendBadRequestResponse,
  sendNotFoundResponse,
} from "../utils/Response.utils.js";

export const SYSTEM_PERMISSIONS = [
  {
    id: "manage_employees",
    name: "Manage Employees",
    category: "Employee Management",
    description: "Create, view, update and manage employee profiles and documents",
  },
  {
    id: "approve_leaves",
    name: "Approve Leaves",
    category: "Leave Management",
    description: "Review, approve or reject leave requests from team members",
  },
  {
    id: "process_payroll",
    name: "Process Payroll",
    category: "Payroll Management",
    description: "Generate monthly payslips, run payroll calculations and bonuses",
  },
  {
    id: "export_reports",
    name: "Export Reports",
    category: "Reports & Analytics",
    description: "Generate and export HR, payroll, and attendance reports to CSV/PDF/Excel",
  },
  {
    id: "system_settings",
    name: "System Settings",
    category: "Administration",
    description: "Configure system-wide settings, shifts, policies, and master parameters",
  },
  {
    id: "view_audit_logs",
    name: "View Audit Logs",
    category: "Security & Audit",
    description: "Access and inspect administrative action history and security audit logs",
  },
  {
    id: "document_verification",
    name: "Document Verification",
    category: "Employee Management",
    description: "Verify government IDs, education degrees, and employee onboarding documents",
  },
  {
    id: "daily_checkin_out",
    name: "Daily Check-In/Out",
    category: "Attendance",
    description: "Perform daily biometric, web, or mobile check-in and check-out punches",
  },
  {
    id: "assign_tasks",
    name: "Assign Tasks",
    category: "Task Management",
    description: "Assign weekly tasks, sprint goals and track deliverables across teams",
  },
];

export class RoleController {
  static async getAllRoles(req, res) {
    try {
      const { category, search, status, page, limit, sortBy = "createdAt", order = "asc" } = req.query;

      const baseFilter = { isDeleted: false };

      const allCount = await RoleModel.countDocuments(baseFilter);
      const categoryAgg = await RoleModel.aggregate([
        { $match: baseFilter },
        { $group: { _id: "$category", count: { $sum: 1 } } },
      ]);

      const categoryCounts = {};
      categoryAgg.forEach((item) => {
        if (item._id && String(item._id).trim()) {
          categoryCounts[item._id] = item.count;
        }
      });

      const filter = { ...baseFilter };

      if (category && category.trim().toLowerCase() !== "all" && category.trim().toLowerCase() !== "all roles") {
        filter.category = { $regex: new RegExp(`^${category.trim()}$`, "i") };
      }

      if (status) {
        const s = status.trim().toLowerCase();
        if (s === "active" || s === "true") {
          filter.isActive = true;
        } else if (s === "inactive" || s === "false") {
          filter.isActive = false;
        }
      }

      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        filter.$or = [
          { roleTitle: regex },
          { roleScopeDescription: regex },
          { permissions: regex },
          { category: regex },
        ];
      }

      const sortOptions = {};
      sortOptions[sortBy] = order === "desc" ? -1 : 1;

      let query = RoleModel.find(filter).sort(sortOptions);

      const totalMatched = await RoleModel.countDocuments(filter);

      if (page && limit) {
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const skip = (pageNum - 1) * limitNum;
        query = query.skip(skip).limit(limitNum);
      }

      const rawRoles = await query.lean();

      const roles = await Promise.all(
        rawRoles.map(async (role) => {
          const count = await UserModel.countDocuments({
            $or: [
              { customRole: role._id },
              { roleTitle: role.roleTitle },
            ],
            isUserDeleted: { $ne: true },
          });

          return {
            ...role,
            assignedUsersCount: count,
            assignedUsersText: `${count} Assigned User${count === 1 ? "" : "s"}`,
          };
        })
      );

      return sendSuccessResponse(res, "Roles fetched successfully", {
        counts: {
          all: allCount,
          ...categoryCounts,
        },
        categories: Object.keys(categoryCounts),
        roles,
        total: totalMatched,
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : totalMatched,
      });
    } catch (error) {
      console.error("Get All Roles Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch roles", error);
    }
  }

  static async getRoleById(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid role ID");
      }

      const role = await RoleModel.findOne({ _id: id, isDeleted: false }).lean();
      if (!role) {
        return sendNotFoundResponse(res, "Role not found");
      }

      const assignedUsers = await UserModel.find({
        $or: [{ customRole: role._id }, { roleTitle: role.roleTitle }],
        isUserDeleted: { $ne: true },
      })
        .select("_id name firstName lastName email employeeId avatarUrl department designation employeeStatus")
        .populate("department", "departmentName")
        .populate("designation", "designationName")
        .lean();

      const userCount = assignedUsers.length;

      return sendSuccessResponse(res, "Role details fetched successfully", {
        ...role,
        assignedUsersCount: userCount,
        assignedUsersText: `${userCount} Assigned User${userCount === 1 ? "" : "s"}`,
        assignedUsers,
      });
    } catch (error) {
      console.error("Get Role By ID Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch role details", error);
    }
  }

  static async addRole(req, res) {
    try {
      const {
        roleTitle,
        title,
        name,
        roleScopeDescription,
        description,
        category,
        accessScope,
        badgeColor,
        color,
        icon,
        permissions = [],
        privileges,
        isActive = true,
      } = req.body;

      const finalTitle = (roleTitle || title || name || "").trim();
      if (!finalTitle) {
        return sendBadRequestResponse(res, "Role Title is required!");
      }

      const finalDescription = (roleScopeDescription !== undefined ? roleScopeDescription : description || "").trim();
      const finalCategory = (category || accessScope || "").trim();
      const finalBadgeColor = (badgeColor || color || "").trim();
      const finalIcon = (icon || "").trim();
      const finalPermissions = Array.isArray(permissions)
        ? permissions
        : Array.isArray(privileges)
          ? privileges
          : [];

      const existing = await RoleModel.findOne({
        roleTitle: { $regex: new RegExp(`^${finalTitle}$`, "i") },
        isDeleted: false,
      });

      if (existing) {
        return res.status(409).json({
          success: false,
          message: `Role with title '${finalTitle}' already exists.`,
        });
      }

      const slug = finalTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

      const newRole = await RoleModel.create({
        roleTitle: finalTitle,
        slug,
        roleScopeDescription: finalDescription,
        category: finalCategory,
        badgeColor: finalBadgeColor,
        icon: finalIcon,
        permissions: finalPermissions,
        isActive: isActive !== undefined ? Boolean(isActive) : true,
        isSystemRole: false,
        assignedUsersCount: 0,
        createdBy: req.user?._id || null,
      });

      await recordAuditLog(req, {
        action: "Created New Role",
        category: "Security",
        description: `Created custom role '${newRole.roleTitle}' with ${newRole.permissions.length} privilege(s)`,
        targetResource: newRole.roleTitle,
        diff: {
          before: "None",
          after: `Role: ${newRole.roleTitle} (${newRole.permissions.length} Privileges)`,
        },
      });

      return sendCreatedResponse(res, "Custom role created successfully!", {
        ...newRole.toObject(),
        assignedUsersCount: 0,
        assignedUsersText: "0 Assigned Users",
      });
    } catch (error) {
      console.error("Add Role Error:", error);
      return sendErrorResponse(res, 500, "Failed to create role", error);
    }
  }

  static async updateRole(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid role ID");
      }

      const role = await RoleModel.findOne({ _id: id, isDeleted: false });
      if (!role) {
        return sendNotFoundResponse(res, "Role not found");
      }

      const {
        roleTitle,
        title,
        name,
        roleScopeDescription,
        description,
        category,
        accessScope,
        badgeColor,
        color,
        icon,
        permissions,
        privileges,
        isActive,
      } = req.body;

      const newTitle = roleTitle || title || name;
      if (newTitle && newTitle.trim()) {
        const cleanTitle = newTitle.trim();
        if (cleanTitle.toLowerCase() !== role.roleTitle.toLowerCase()) {
          const duplicate = await RoleModel.findOne({
            _id: { $ne: role._id },
            roleTitle: { $regex: new RegExp(`^${cleanTitle}$`, "i") },
            isDeleted: false,
          });
          if (duplicate) {
            return res.status(409).json({
              success: false,
              message: `Another role with title '${cleanTitle}' already exists.`,
            });
          }
          role.roleTitle = cleanTitle;
          role.slug = cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        }
      }

      if (roleScopeDescription !== undefined || description !== undefined) {
        role.roleScopeDescription = (roleScopeDescription !== undefined ? roleScopeDescription : description || "").trim();
      }

      if (category !== undefined || accessScope !== undefined) {
        role.category = (category || accessScope || "").trim();
      }

      if (badgeColor !== undefined || color !== undefined) {
        role.badgeColor = (badgeColor || color || "").trim();
      }

      if (icon !== undefined) {
        role.icon = icon.trim();
      }

      if (Array.isArray(permissions)) {
        role.permissions = permissions;
      } else if (Array.isArray(privileges)) {
        role.permissions = privileges;
      }

      if (isActive !== undefined) {
        role.isActive = Boolean(isActive);
      }

      role.updatedBy = req.user?._id || null;
      await role.save();

      await recordAuditLog(req, {
        action: "Updated Role",
        category: "Security",
        description: `Updated configuration for role '${role.roleTitle}'`,
        targetResource: role.roleTitle,
        diff: {
          before: `Role: ${role.roleTitle}`,
          after: `Role: ${role.roleTitle} (${role.permissions?.length || 0} Privileges)`,
        },
      });

      return sendSuccessResponse(res, "Role updated successfully", role);
    } catch (error) {
      console.error("Update Role Error:", error);
      return sendErrorResponse(res, 500, "Failed to update role", error);
    }
  }

  static async updateRolePermissions(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid role ID");
      }

      const role = await RoleModel.findOne({ _id: id, isDeleted: false });
      if (!role) {
        return sendNotFoundResponse(res, "Role not found");
      }

      const { permissions, privileges } = req.body;
      const finalPerms = Array.isArray(permissions)
        ? permissions
        : Array.isArray(privileges)
          ? privileges
          : null;

      if (!finalPerms) {
        return sendBadRequestResponse(
          res,
          "An array of granted permissions is required in 'permissions' or 'privileges' field."
        );
      }

      const oldPermissions = [...(role.permissions || [])];
      const cleaned = Array.from(new Set(finalPerms.map((p) => String(p).trim()).filter(Boolean)));

      role.permissions = cleaned;
      role.updatedBy = req.user?._id || null;
      await role.save();

      const granted = cleaned.filter((p) => !oldPermissions.includes(p));
      const revoked = oldPermissions.filter((p) => !cleaned.includes(p));
      let actionDesc = `Updated privileges for ${role.roleTitle} role`;
      if (granted.length) {
        actionDesc = `Granted '${granted.join(", ")}' permission to ${role.roleTitle} role`;
      } else if (revoked.length) {
        actionDesc = `Revoked '${revoked.join(", ")}' permission from ${role.roleTitle} role`;
      }

      await recordAuditLog(req, {
        action: "Modified Role Privileges",
        category: "Security",
        description: actionDesc,
        targetResource: role.roleTitle,
        diff: {
          before: oldPermissions.length ? oldPermissions.join(", ") : "No permissions",
          after: cleaned.length ? cleaned.join(", ") : "No permissions",
        },
      });

      return sendSuccessResponse(
        res,
        `Privileges for role '${role.roleTitle}' updated successfully!`,
        {
          _id: role._id,
          roleTitle: role.roleTitle,
          permissions: role.permissions,
          totalPermissions: role.permissions.length,
        }
      );
    } catch (error) {
      console.error("Update Role Permissions Error:", error);
      return sendErrorResponse(res, 500, "Failed to update privileges", error);
    }
  }

  static async toggleRoleStatus(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid role ID");
      }

      const role = await RoleModel.findOne({ _id: id, isDeleted: false });
      if (!role) {
        return sendNotFoundResponse(res, "Role not found");
      }

      let newStatus;
      if (typeof req.body.isActive === "boolean") {
        newStatus = req.body.isActive;
      } else if (req.body.status !== undefined) {
        newStatus = String(req.body.status).toLowerCase() === "active" || String(req.body.status).toLowerCase() === "true";
      } else {
        newStatus = !role.isActive;
      }

      const oldStatus = role.isActive;
      role.isActive = newStatus;
      role.updatedBy = req.user?._id || null;
      await role.save();

      await recordAuditLog(req, {
        action: "Role Status Changed",
        category: "Security",
        description: `Toggled status of role '${role.roleTitle}' to ${role.isActive ? "Active" : "Inactive"}`,
        targetResource: role.roleTitle,
        diff: {
          before: `Status: ${oldStatus ? "Active" : "Inactive"}`,
          after: `Status: ${role.isActive ? "Active" : "Inactive"}`,
        },
      });

      return sendSuccessResponse(
        res,
        `Role '${role.roleTitle}' status set to ${role.isActive ? "Active" : "Inactive"}.`,
        role
      );
    } catch (error) {
      console.error("Toggle Role Status Error:", error);
      return sendErrorResponse(res, 500, "Failed to toggle role status", error);
    }
  }

  static async deleteRole(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid role ID");
      }

      const role = await RoleModel.findById(id);
      if (!role) {
        return sendNotFoundResponse(res, "Role not found");
      }

      const assignedCount = await UserModel.countDocuments({
        $or: [{ customRole: role._id }, { roleTitle: role.roleTitle }],
        isUserDeleted: { $ne: true },
      });

      if (assignedCount > 0) {
        return sendBadRequestResponse(
          res,
          `Cannot delete role '${role.roleTitle}' because ${assignedCount} user(s) are currently assigned to it. Please reassign them first.`
        );
      }

      await RoleModel.findByIdAndDelete(id);

      await recordAuditLog(req, {
        action: "Deleted Role",
        category: "Security",
        description: `Deleted role '${role.roleTitle}'`,
        targetResource: role.roleTitle,
        diff: {
          before: `Role: ${role.roleTitle} (${role.permissions.length} Privileges)`,
          after: "Role Deleted",
        },
      });

      return sendSuccessResponse(res, `Role '${role.roleTitle}' deleted successfully.`);
    } catch (error) {
      console.error("Delete Role Error:", error);
      return sendErrorResponse(res, 500, "Failed to delete role", error);
    }
  }

  static async getAvailablePermissions(req, res) {
    try {
      const categoriesMap = {};
      SYSTEM_PERMISSIONS.forEach((p) => {
        if (!categoriesMap[p.category]) {
          categoriesMap[p.category] = [];
        }
        categoriesMap[p.category].push(p);
      });

      return sendSuccessResponse(res, "Available permissions fetched successfully", {
        permissions: SYSTEM_PERMISSIONS,
        allPermissions: SYSTEM_PERMISSIONS,
        permissionNames: SYSTEM_PERMISSIONS.map((p) => p.name),
        categories: Object.keys(categoriesMap),
        groupedByCategory: categoriesMap,
        total: SYSTEM_PERMISSIONS.length,
      });
    } catch (error) {
      console.error("Get Available Permissions Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch permissions", error);
    }
  }

  static async assignRoleToUser(req, res) {
    try {
      const { userId, userIds, roleId } = req.body;

      if (!roleId || !mongoose.Types.ObjectId.isValid(roleId)) {
        return sendBadRequestResponse(res, "Valid roleId is required!");
      }

      const role = await RoleModel.findOne({ _id: roleId, isDeleted: false });
      if (!role) {
        return sendNotFoundResponse(res, "Target role was not found");
      }

      const targetIds = Array.isArray(userIds) ? userIds : userId ? [userId] : [];

      if (!targetIds.length) {
        return sendBadRequestResponse(res, "At least one userId is required!");
      }

      const validObjectIds = targetIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
      if (!validObjectIds.length) {
        return sendBadRequestResponse(res, "No valid user ObjectIds provided!");
      }

      const updateResult = await UserModel.updateMany(
        { _id: { $in: validObjectIds }, isUserDeleted: { $ne: true } },
        {
          $set: {
            customRole: role._id,
            roleTitle: role.roleTitle,
          },
        }
      );

      await recordAuditLog(req, {
        action: "Assigned Role to User",
        category: "Security",
        description: `Assigned role '${role.roleTitle}' to ${updateResult.modifiedCount} user(s)`,
        targetResource: role.roleTitle,
        diff: {
          before: "Unassigned / Previous Role",
          after: `Assigned Role: ${role.roleTitle} (${updateResult.modifiedCount} User${updateResult.modifiedCount === 1 ? "" : "s"})`,
        },
      });

      return sendSuccessResponse(res, `Assigned role '${role.roleTitle}' to ${updateResult.modifiedCount} user(s).`, {
        roleId: role._id,
        roleTitle: role.roleTitle,
        assignedCount: updateResult.modifiedCount,
      });
    } catch (error) {
      console.error("Assign Role Error:", error);
      return sendErrorResponse(res, 500, "Failed to assign role to user", error);
    }
  }

  static async getRoleAssignedUsers(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid role ID");
      }

      const role = await RoleModel.findOne({ _id: id, isDeleted: false });
      if (!role) {
        return sendNotFoundResponse(res, "Role not found");
      }

      const query = {
        $or: [{ customRole: role._id }, { roleTitle: role.roleTitle }],
        isUserDeleted: { $ne: true },
      };

      const users = await UserModel.find(query)
        .select("_id name firstName lastName email employeeId avatarUrl phone department designation employeeStatus")
        .populate("department", "departmentName")
        .populate("designation", "designationName")
        .lean();

      return sendSuccessResponse(res, `Users assigned to '${role.roleTitle}' fetched successfully`, {
        roleId: role._id,
        roleTitle: role.roleTitle,
        count: users.length,
        users,
      });
    } catch (error) {
      console.error("Get Role Assigned Users Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch assigned users", error);
    }
  }

  static async getMyPermissions(req, res) {
    try {
      const user = req.user;
      if (!user) {
        return sendNotFoundResponse(res, "User profile not found");
      }

      let activeRole = null;

      if (user.customRole) {
        activeRole = await RoleModel.findOne({ _id: user.customRole, isDeleted: false }).lean();
      }

      if (!activeRole && user.roleTitle) {
        activeRole = await RoleModel.findOne({ roleTitle: user.roleTitle, isDeleted: false }).lean();
      }

      if (!activeRole && user.role) {
        activeRole = await RoleModel.findOne({
          $or: [
            { roleTitle: { $regex: new RegExp(`^${user.role}$`, "i") } },
            { slug: user.role.toLowerCase() },
          ],
          isDeleted: false,
        }).lean();
      }

      const permissions = activeRole ? activeRole.permissions : [];

      return sendSuccessResponse(res, "User permissions fetched successfully", {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
        role: activeRole
          ? {
            _id: activeRole._id,
            roleTitle: activeRole.roleTitle,
            category: activeRole.category,
            badgeColor: activeRole.badgeColor,
            isActive: activeRole.isActive,
          }
          : null,
        permissions,
        hasPermission: (perm) => permissions.includes(perm),
      });
    } catch (error) {
      console.error("Get My Permissions Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch user permissions", error);
    }
  }
}
