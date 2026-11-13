import mongoose from "mongoose";
import AnnouncementModel, {
  ANNOUNCEMENT_PRIORITIES,
  ANNOUNCEMENT_STATUSES,
  ANNOUNCEMENT_TARGET_TYPES,
} from "../model/announcement.model.js";
import DepartmentModel from "../model/department.model.js";
import UserModel from "../model/user.model.js";
import { notifyUsers, notifyUser } from "../utils/notification.util.js";
import {
  sendSuccessResponse,
  sendCreatedResponse,
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendErrorResponse,
} from "../utils/Response.utils.js";
import { recordAuditLog } from "../utils/auditLogger.js";

const formatNoticeDate = (date) => {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return String(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12;
  const strHours = String(hours).padStart(2, "0");
  return `${year}-${month}-${day} ${strHours}:${minutes} ${ampm}`;
};

const resolveTargetAndRecipient = async ({
  recipient,
  targetType,
  employee,
  employeeId,
  employees,
  targetEmployees,
  department,
}) => {
  const rawEmployeeInput =
    employee || employeeId || employees || targetEmployees;

  if (rawEmployeeInput) {
    const inputList = Array.isArray(rawEmployeeInput)
      ? rawEmployeeInput
      : [rawEmployeeInput];
    const matchedUsers = [];

    for (const item of inputList) {
      const str = String(item || "").trim();
      if (!str) continue;

      let found = null;
      if (mongoose.Types.ObjectId.isValid(str)) {
        found = await UserModel.findOne({
          _id: str,
          isUserDeleted: { $ne: true },
        }).populate("department");
      }
      if (!found) {
        found = await UserModel.findOne({
          $or: [
            { employeeId: str },
            { email: str.toLowerCase() },
            { name: new RegExp(`^${str}$`, "i") },
          ],
          isUserDeleted: { $ne: true },
        }).populate("department");
      }

      if (!found) {
        return {
          error: `Specified employee '${str}' not found`,
        };
      }
      matchedUsers.push(found);
    }

    if (matchedUsers.length === 0) {
      return { error: "Specified employee not found" };
    }

    const firstUser = matchedUsers[0];
    const targetEmployeeIds = matchedUsers.map((u) => u._id);
    const empName =
      firstUser.name ||
      `${firstUser.firstName || ""} ${firstUser.lastName || ""}`.trim() ||
      firstUser.employeeId;

    const displayRecipient =
      matchedUsers.length === 1
        ? firstUser.employeeId
          ? `${empName} (${firstUser.employeeId})`
          : empName
        : `${matchedUsers.length} Employees Selected`;

    return {
      resolvedTargetType: "Individual",
      targetEmployeeIds,
      singleTargetEmployee: firstUser._id,
      resolvedDeptId:
        firstUser.department?._id || firstUser.department || null,
      resolvedDeptName: firstUser.department?.departmentName || "",
      resolvedRecipient: displayRecipient,
    };
  }

  const rawRecipientStr = String(recipient || "").trim();

  if (
    rawRecipientStr.toLowerCase() === "admin" ||
    rawRecipientStr.toLowerCase() === "admins" ||
    rawRecipientStr.toLowerCase() === "admin only"
  ) {
    return {
      resolvedTargetType: "Admin Only",
      targetEmployeeIds: [],
      singleTargetEmployee: null,
      resolvedDeptId: null,
      resolvedDeptName: "",
      resolvedRecipient: "Admin Only",
    };
  }

  if (
    !rawRecipientStr ||
    rawRecipientStr.toLowerCase() === "all employees" ||
    rawRecipientStr.toLowerCase() === "all"
  ) {
    return {
      resolvedTargetType: "All Employees",
      targetEmployeeIds: [],
      singleTargetEmployee: null,
      resolvedDeptId: null,
      resolvedDeptName: "",
      resolvedRecipient: "All Employees",
    };
  }

  if (mongoose.Types.ObjectId.isValid(rawRecipientStr)) {
    const foundUser = await UserModel.findOne({
      _id: rawRecipientStr,
      isUserDeleted: { $ne: true },
    }).populate("department");

    if (foundUser) {
      const empName =
        foundUser.name ||
        `${foundUser.firstName || ""} ${foundUser.lastName || ""}`.trim() ||
        foundUser.employeeId;
      const displayRecipient = foundUser.employeeId
        ? `${empName} (${foundUser.employeeId})`
        : empName;

      return {
        resolvedTargetType: "Individual",
        targetEmployeeIds: [foundUser._id],
        singleTargetEmployee: foundUser._id,
        resolvedDeptId:
          foundUser.department?._id || foundUser.department || null,
        resolvedDeptName: foundUser.department?.departmentName || "",
        resolvedRecipient: displayRecipient,
      };
    }

    const foundDept = await DepartmentModel.findOne({
      _id: rawRecipientStr,
      isDeleted: { $ne: true },
    });

    if (foundDept) {
      return {
        resolvedTargetType: "Department",
        targetEmployeeIds: [],
        singleTargetEmployee: null,
        resolvedDeptId: foundDept._id,
        resolvedDeptName: foundDept.departmentName,
        resolvedRecipient: foundDept.departmentName,
      };
    }

    return {
      error: `Specified employee or department ID '${rawRecipientStr}' not found`,
    };
  }

  const foundUser = await UserModel.findOne({
    $or: [
      { employeeId: rawRecipientStr },
      { email: rawRecipientStr.toLowerCase() },
      { name: new RegExp(`^${rawRecipientStr}$`, "i") },
    ],
    isUserDeleted: { $ne: true },
  }).populate("department");

  if (foundUser) {
    const empName =
      foundUser.name ||
      `${foundUser.firstName || ""} ${foundUser.lastName || ""}`.trim() ||
      foundUser.employeeId;
    const displayRecipient = foundUser.employeeId
      ? `${empName} (${foundUser.employeeId})`
      : empName;

    return {
      resolvedTargetType: "Individual",
      targetEmployeeIds: [foundUser._id],
      singleTargetEmployee: foundUser._id,
      resolvedDeptId:
        foundUser.department?._id || foundUser.department || null,
      resolvedDeptName: foundUser.department?.departmentName || "",
      resolvedRecipient: displayRecipient,
    };
  }

  let foundDept = null;
  if (department && mongoose.Types.ObjectId.isValid(String(department).trim())) {
    foundDept = await DepartmentModel.findById(String(department).trim());
  }
  if (!foundDept) {
    foundDept = await DepartmentModel.findOne({
      departmentName: new RegExp(`^${rawRecipientStr}$`, "i"),
      isDeleted: { $ne: true },
    });
  }

  if (foundDept) {
    return {
      resolvedTargetType: "Department",
      targetEmployeeIds: [],
      singleTargetEmployee: null,
      resolvedDeptId: foundDept._id,
      resolvedDeptName: foundDept.departmentName,
      resolvedRecipient: foundDept.departmentName,
    };
  }

  return {
    error: `Recipient '${rawRecipientStr}' not found. Please provide a valid employee ID or department name.`,
  };
};

export class AnnouncementController {
  static async createAnnouncement(req, res) {
    try {
      const {
        title,
        noticeTitle,
        description,
        content,
        notice,
        recipient = "All Employees",
        targetType,
        employee,
        employeeId,
        employees,
        targetEmployees,
        department,
        priority = "Normal",
        status = "Active",
        publishDate,
      } = req.body || {};

      const finalTitle = title || noticeTitle;
      if (!finalTitle || !String(finalTitle).trim()) {
        return sendBadRequestResponse(res, "Notice title is required");
      }

      const finalDescription = description || content || notice;
      if (!finalDescription || !String(finalDescription).trim()) {
        return sendBadRequestResponse(res, "Notice description is required");
      }

      const resolution = await resolveTargetAndRecipient({
        recipient,
        targetType,
        employee,
        employeeId,
        employees,
        targetEmployees,
        department,
      });

      if (resolution.error) {
        return sendNotFoundResponse(res, resolution.error);
      }

      const effectivePublishDate = publishDate
        ? new Date(publishDate)
        : new Date();
      const formattedDate = formatNoticeDate(effectivePublishDate);

      const publisherName =
        req.user?.name ||
        `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() ||
        (req.user?.role === "admin" ? "Admin" : "HR Team");

      const validatedPriority = ANNOUNCEMENT_PRIORITIES.includes(priority)
        ? priority
        : "Normal";

      const validatedStatus = ANNOUNCEMENT_STATUSES.includes(status)
        ? status
        : "Active";

      const newAnnouncement = await AnnouncementModel.create({
        title: String(finalTitle).trim(),
        description: String(finalDescription).trim(),
        recipient: resolution.resolvedRecipient,
        targetType: resolution.resolvedTargetType,
        targetEmployees: resolution.targetEmployeeIds,
        targetEmployee: resolution.singleTargetEmployee,
        department: resolution.resolvedDeptId,
        departmentName: resolution.resolvedDeptName,
        publishedBy: req.user?._id || null,
        publishedByName: publisherName,
        publishDate: effectivePublishDate,
        formattedDate,
        priority: validatedPriority,
        status: validatedStatus,
      });

      await recordAuditLog(req, {
        action: "Created Company Announcement",
        category: "Announcements",
        description: `Published notice '${newAnnouncement.title}' for ${newAnnouncement.recipient} (${newAnnouncement.targetType})`,
        targetResource: newAnnouncement.title,
        diff: {
          before: "None",
          after: `Title: ${newAnnouncement.title} | Target: ${newAnnouncement.targetType} | Recipient: ${newAnnouncement.recipient}`,
        },
      });

      if (resolution.resolvedTargetType === "All Employees") {
        UserModel.find({ role: "employee", isUserDeleted: { $ne: true } })
          .select("_id")
          .lean()
          .then((allEmps) => {
            notifyUsers(allEmps.map((e) => e._id), {
              title: `Company Announcement: ${newAnnouncement.title}`,
              message: newAnnouncement.description.slice(0, 120),
              category: "System",
              type: "ANNOUNCEMENT_PUBLISHED",
              sender: req.user?._id,
              senderName: publisherName,
              referenceId: newAnnouncement._id,
              referenceModel: "Announcement",
            });
          })
          .catch(() => {});
      } else if (resolution.targetEmployeeIds && resolution.targetEmployeeIds.length > 0) {
        notifyUsers(resolution.targetEmployeeIds, {
          title: `Company Announcement: ${newAnnouncement.title}`,
          message: newAnnouncement.description.slice(0, 120),
          category: "System",
          type: "ANNOUNCEMENT_PUBLISHED",
          sender: req.user?._id,
          senderName: publisherName,
          referenceId: newAnnouncement._id,
          referenceModel: "Announcement",
        }).catch(() => {});
      }

      return sendCreatedResponse(
        res,
        "Notice published successfully",
        newAnnouncement
      );
    } catch (error) {
      console.error("Create Announcement Error:", error);
      return sendErrorResponse(res, 500, "Failed to publish notice", error);
    }
  }

  static async getCompanyAnnouncements(req, res) {
    try {
      const isEmployeeUser = req.user?.role === "employee";
      let userDeptName = "";
      let userDeptId = null;

      if (req.user) {
        let userDoc = req.user;
        if (
          !userDoc.department ||
          typeof userDoc.department === "string" ||
          mongoose.Types.ObjectId.isValid(userDoc.department)
        ) {
          userDoc = await UserModel.findById(req.user._id).populate("department");
        }
        if (userDoc?.department) {
          if (
            typeof userDoc.department === "object" &&
            userDoc.department.departmentName
          ) {
            userDeptName = userDoc.department.departmentName;
            userDeptId = userDoc.department._id;
          } else if (mongoose.Types.ObjectId.isValid(userDoc.department)) {
            const d = await DepartmentModel.findById(userDoc.department);
            if (d) {
              userDeptName = d.departmentName;
              userDeptId = d._id;
            }
          }
        }
      }

      const bannerDeptPart = userDeptName ? `${userDeptName} & ` : "";
      const bannerText = `Announcements targeted to ${bannerDeptPart}All Employees.`;

      const filter = {
        isDeleted: false,
        status: "Active",
      };

      if (isEmployeeUser) {
        filter.targetType = { $ne: "Admin Only" };
        const currentUserId = new mongoose.Types.ObjectId(String(req.user._id));

        const audienceConditions = [
          { targetType: "All Employees" },
          {
            $and: [
              { targetType: { $ne: "Individual" } },
              {
                $or: [
                  { recipient: new RegExp("^all employees$", "i") },
                  { recipient: new RegExp("^all$", "i") },
                ],
              },
            ],
          },
          {
            targetType: "Individual",
            $or: [
              { targetEmployees: currentUserId },
              { targetEmployee: currentUserId },
            ],
          },
        ];

        if (userDeptName || userDeptId) {
          const deptOr = [];
          if (userDeptName) {
            deptOr.push({ recipient: new RegExp(`^${userDeptName}$`, "i") });
          }
          if (userDeptId) {
            deptOr.push({ department: userDeptId });
          }
          audienceConditions.push({
            targetType: "Department",
            $or: deptOr,
          });
        }

        filter.$or = audienceConditions;
      }

      const { search, priority, page = 1, limit = 20 } = req.query;
      if (priority && ANNOUNCEMENT_PRIORITIES.includes(priority)) {
        filter.priority = priority;
      }
      if (search) {
        const sRegex = new RegExp(String(search).trim(), "i");
        filter.$and = filter.$and || [];
        filter.$and.push({
          $or: [
            { title: sRegex },
            { description: sRegex },
            { recipient: sRegex },
          ],
        });
      }

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, parseInt(limit, 10) || 20);
      const skip = (pageNum - 1) * limitNum;

      const [total, announcements] = await Promise.all([
        AnnouncementModel.countDocuments(filter),
        AnnouncementModel.find(filter)
          .sort({ publishDate: -1, createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
      ]);

      const formatted = announcements.map((item) => ({
        _id: item._id,
        title: item.title,
        noticeTitle: item.title,
        description: item.description,
        content: item.description,
        publishedBy: item.publishedByName || "Admin",
        date:
          item.formattedDate ||
          formatNoticeDate(item.publishDate || item.createdAt),
        formattedDate:
          item.formattedDate ||
          formatNoticeDate(item.publishDate || item.createdAt),
        publishDate: item.publishDate || item.createdAt,
        recipient: item.recipient || "All Employees",
        targetType: item.targetType || "All Employees",
        departmentName: item.departmentName || "",
        priority: item.priority || "Normal",
        status: item.status || "Active",
        createdAt: item.createdAt,
      }));

      return sendSuccessResponse(
        res,
        "Company announcements fetched successfully",
        {
          bannerText,
          department: userDeptName || "All",
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum) || 1,
          announcements: formatted,
        }
      );
    } catch (error) {
      console.error("Get Company Announcements Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch announcements", error);
    }
  }

  static async getAllAnnouncements(req, res) {
    try {
      if (!req.user || req.user.role !== "admin") {
        return sendForbiddenResponse(res, "Access Denied. Admins only.", "ADMIN_ONLY");
      }

      const {
        search,
        status,
        recipient,
        priority,
        targetType,
        page = 1,
        limit = 10,
      } = req.query;

      const filter = { isDeleted: false };

      if (status && status !== "all") {
        filter.status = new RegExp(`^${status}$`, "i");
      }
      if (priority && priority !== "all") {
        filter.priority = priority;
      }
      if (targetType && targetType !== "all") {
        filter.targetType = targetType;
      }
      if (recipient && recipient !== "all") {
        filter.recipient = new RegExp(recipient, "i");
      }
      if (search) {
        const s = new RegExp(String(search).trim(), "i");
        filter.$or = [
          { title: s },
          { description: s },
          { recipient: s },
          { publishedByName: s },
        ];
      }

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, parseInt(limit, 10) || 10);
      const skip = (pageNum - 1) * limitNum;

      const [total, items] = await Promise.all([
        AnnouncementModel.countDocuments(filter),
        AnnouncementModel.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .populate("targetEmployees", "name firstName lastName employeeId email avatarUrl")
          .lean(),
      ]);

      const formatted = items.map((item) => ({
        _id: item._id,
        title: item.title,
        noticeTitle: item.title,
        description: item.description,
        publishedBy: item.publishedByName || "Admin",
        date:
          item.formattedDate ||
          formatNoticeDate(item.publishDate || item.createdAt),
        formattedDate:
          item.formattedDate ||
          formatNoticeDate(item.publishDate || item.createdAt),
        recipient: item.recipient || "All Employees",
        targetType: item.targetType || "All Employees",
        targetEmployees: item.targetEmployees || [],
        departmentName: item.departmentName || "",
        priority: item.priority || "Normal",
        status: item.status || "Active",
        createdAt: item.createdAt,
      }));

      return sendSuccessResponse(res, "All announcements fetched successfully", {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
        announcements: formatted,
      });
    } catch (error) {
      console.error("Get All Announcements Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch announcements", error);
    }
  }

  static async getAnnouncementById(req, res) {
    try {
      const id = req.params.id || req.query.id;
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid notice ID");
      }

      const item = await AnnouncementModel.findOne({
        _id: id,
        isDeleted: false,
      })
        .populate("targetEmployees", "name firstName lastName employeeId email avatarUrl")
        .lean();

      if (!item) {
        return sendNotFoundResponse(res, "Announcement not found");
      }

      const dateStr =
        item.formattedDate ||
        formatNoticeDate(item.publishDate || item.createdAt);

      const formatted = {
        _id: item._id,
        title: item.title,
        noticeTitle: item.title,
        description: item.description,
        content: item.description,
        publishedBy: item.publishedByName || "Admin",
        date: dateStr,
        formattedDate: dateStr,
        publishDate: item.publishDate || item.createdAt,
        recipient: item.recipient || "All Employees",
        targetType: item.targetType || "All Employees",
        targetEmployees: item.targetEmployees || [],
        department: item.department || null,
        departmentName: item.departmentName || "",
        priority: item.priority || "Normal",
        status: item.status || "Active",
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };

      return sendSuccessResponse(res, "Notice retrieved successfully", formatted);
    } catch (error) {
      console.error("Get Announcement By Id Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch notice", error);
    }
  }

  static async updateAnnouncement(req, res) {
    try {
      const { id } = req.params;
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid notice ID");
      }

      const item = await AnnouncementModel.findOne({
        _id: id,
        isDeleted: false,
      });
      if (!item) {
        return sendNotFoundResponse(res, "Announcement not found");
      }

      const {
        title,
        noticeTitle,
        description,
        content,
        notice,
        recipient,
        targetType,
        employee,
        employeeId,
        employees,
        targetEmployees,
        department,
        priority,
        status,
      } = req.body || {};

      if (title !== undefined || noticeTitle !== undefined) {
        item.title = String(title || noticeTitle).trim();
      }
      if (
        description !== undefined ||
        content !== undefined ||
        notice !== undefined
      ) {
        item.description = String(description || content || notice).trim();
      }
      if (priority !== undefined && ANNOUNCEMENT_PRIORITIES.includes(priority)) {
        item.priority = priority;
      }
      if (status !== undefined && ANNOUNCEMENT_STATUSES.includes(status)) {
        item.status = status;
      }
      if (
        recipient !== undefined ||
        employee !== undefined ||
        employeeId !== undefined ||
        employees !== undefined ||
        targetEmployees !== undefined ||
        department !== undefined ||
        targetType !== undefined
      ) {
        const resolution = await resolveTargetAndRecipient({
          recipient: recipient !== undefined ? recipient : item.recipient,
          targetType,
          employee,
          employeeId,
          employees,
          targetEmployees,
          department,
        });

        if (resolution.error) {
          return sendNotFoundResponse(res, resolution.error);
        }

        item.targetType = resolution.resolvedTargetType;
        item.targetEmployees = resolution.targetEmployeeIds;
        item.targetEmployee = resolution.singleTargetEmployee;
        item.department = resolution.resolvedDeptId;
        item.departmentName = resolution.resolvedDeptName;
        item.recipient = resolution.resolvedRecipient;
      }

      await item.save();

      return sendSuccessResponse(res, "Announcement updated successfully", item);
    } catch (error) {
      console.error("Update Announcement Error:", error);
      return sendErrorResponse(res, 500, "Failed to update announcement", error);
    }
  }

  static async deleteAnnouncement(req, res) {
    try {
      const { id } = req.params;
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid notice ID");
      }

      const item = await AnnouncementModel.findByIdAndDelete(id);
      if (!item) {
        return sendNotFoundResponse(res, "Announcement not found");
      }

      await recordAuditLog(req, {
        action: "Deleted Company Announcement",
        category: "Announcements",
        description: `Deleted notice '${item.title}'`,
        targetResource: item.title,
      });

      return sendSuccessResponse(res, "Announcement deleted successfully");
    } catch (error) {
      console.error("Delete Announcement Error:", error);
      return sendErrorResponse(res, 500, "Failed to delete announcement", error);
    }
  }

  static async getRecipientOptions(req, res) {
    try {
      const employees = await UserModel.find({
        role: "employee",
        isUserDeleted: { $ne: true },
      })
        .select("name firstName lastName employeeId email")
        .sort({ name: 1 })
        .lean();

      const recipients = [
        { label: "All Employees", value: "All Employees", type: "all" },
        ...employees.map((emp) => {
          const empName =
            emp.name ||
            `${emp.firstName || ""} ${emp.lastName || ""}`.trim() ||
            emp.employeeId;
          const displayLabel = emp.employeeId
            ? `${empName} (${emp.employeeId})`
            : empName;
          return {
            label: displayLabel,
            value: emp._id,
            employeeId: emp._id,
            employeeCode: emp.employeeId,
            name: empName,
            type: "employee",
          };
        }),
      ];

      return sendSuccessResponse(
        res,
        "Recipient options retrieved successfully",
        {
          recipients,
        }
      );
    } catch (error) {
      console.error("Get Recipient Options Error:", error);
      return sendErrorResponse(
        res,
        500,
        "Failed to fetch recipient options",
        error
      );
    }
  }
}
