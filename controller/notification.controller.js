import mongoose from "mongoose";
import NotificationModel, {
  NOTIFICATION_CATEGORIES,
} from "../model/notification.model.js";
import { formatRelativeTime } from "../utils/notification.util.js";
import {
  sendSuccessResponse,
  sendErrorResponse,
  sendBadRequestResponse,
  sendNotFoundResponse,
} from "../utils/Response.utils.js";

const getCategoryBadgeColor = (category) => {
  switch (String(category || "").toLowerCase()) {
    case "leave":
      return "#10B981";
    case "attendance":
      return "#3B82F6";
    case "payroll":
      return "#F59E0B";
    case "system":
    default:
      return "#8B5CF6";
  }
};

const getCategoryIcon = (category) => {
  switch (String(category || "").toLowerCase()) {
    case "leave":
      return "calendar";
    case "attendance":
      return "clock";
    case "payroll":
      return "credit-card";
    case "system":
    default:
      return "bell";
  }
};

export class NotificationController {
  static async getNotifications(req, res) {
    try {
      const recipientId = req.user?._id;
      if (!recipientId) {
        return sendBadRequestResponse(res, "Authentication required");
      }

      const {
        category = "all",
        search,
        isRead,
        page = 1,
        limit = 15,
      } = req.query;

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, parseInt(limit, 10) || 15);
      const skip = (pageNum - 1) * limitNum;

      const baseRecipientFilter = {
        recipient: recipientId,
        isDeleted: false,
      };

      const [
        totalAll,
        totalLeave,
        totalAttendance,
        totalPayroll,
        totalSystem,
        unreadCount,
      ] = await Promise.all([
        NotificationModel.countDocuments(baseRecipientFilter),
        NotificationModel.countDocuments({ ...baseRecipientFilter, category: "Leave" }),
        NotificationModel.countDocuments({ ...baseRecipientFilter, category: "Attendance" }),
        NotificationModel.countDocuments({ ...baseRecipientFilter, category: "Payroll" }),
        NotificationModel.countDocuments({ ...baseRecipientFilter, category: "System" }),
        NotificationModel.countDocuments({ ...baseRecipientFilter, isRead: false }),
      ]);

      const counts = {
        all: totalAll,
        leave: totalLeave,
        attendance: totalAttendance,
        payroll: totalPayroll,
        system: totalSystem,
      };

      const tabs = [
        { key: "all", label: "All", count: totalAll },
        { key: "leave", label: "Leave", count: totalLeave },
        { key: "attendance", label: "Attendance", count: totalAttendance },
        { key: "payroll", label: "Payroll", count: totalPayroll },
        { key: "system", label: "System", count: totalSystem },
      ];

      const queryFilter = { ...baseRecipientFilter };

      const activeCat = String(category || "all").trim().toLowerCase();
      if (activeCat !== "all") {
        const matched = NOTIFICATION_CATEGORIES.find(
          (c) => c.toLowerCase() === activeCat
        );
        if (matched) {
          queryFilter.category = matched;
        }
      }

      if (isRead !== undefined && isRead !== "all") {
        queryFilter.isRead = String(isRead) === "true";
      }

      if (search && String(search).trim()) {
        const rgx = new RegExp(String(search).trim(), "i");
        queryFilter.$or = [{ title: rgx }, { message: rgx }];
      }

      const [total, rawList] = await Promise.all([
        NotificationModel.countDocuments(queryFilter),
        NotificationModel.find(queryFilter)
          .populate("sender", "name firstName lastName employeeId avatarUrl email")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
      ]);

      const formatted = rawList.map((item) => {
        const senderDoc = item.sender;
        const senderName =
          (senderDoc &&
            (senderDoc.name ||
              `${senderDoc.firstName || ""} ${senderDoc.lastName || ""}`.trim())) ||
          item.senderName ||
          "System";
        const senderAvatar = senderDoc?.avatarUrl || item.senderAvatar || null;

        return {
          _id: item._id,
          title: item.title,
          message: item.message,
          category: item.category,
          type: item.type,
          isRead: Boolean(item.isRead),
          readAt: item.readAt,
          sender: {
            _id: senderDoc?._id || item.sender || null,
            name: senderName,
            avatarUrl: senderAvatar,
          },
          referenceId: item.referenceId,
          referenceModel: item.referenceModel,
          badgeColor: getCategoryBadgeColor(item.category),
          icon: getCategoryIcon(item.category),
          time: formatRelativeTime(item.createdAt),
          createdAt: item.createdAt,
        };
      });

      return sendSuccessResponse(res, "Notifications fetched successfully", {
        unreadCount,
        counts,
        tabs,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
        notifications: formatted,
      });
    } catch (error) {
      console.error("Get Notifications Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch notifications", error);
    }
  }

  static async getNotificationCounts(req, res) {
    try {
      const recipientId = req.user?._id;
      if (!recipientId) {
        return sendBadRequestResponse(res, "Authentication required");
      }

      const baseRecipientFilter = {
        recipient: recipientId,
        isDeleted: false,
      };

      const [
        totalAll,
        totalLeave,
        totalAttendance,
        totalPayroll,
        totalSystem,
        unreadCount,
      ] = await Promise.all([
        NotificationModel.countDocuments(baseRecipientFilter),
        NotificationModel.countDocuments({ ...baseRecipientFilter, category: "Leave" }),
        NotificationModel.countDocuments({ ...baseRecipientFilter, category: "Attendance" }),
        NotificationModel.countDocuments({ ...baseRecipientFilter, category: "Payroll" }),
        NotificationModel.countDocuments({ ...baseRecipientFilter, category: "System" }),
        NotificationModel.countDocuments({ ...baseRecipientFilter, isRead: false }),
      ]);

      return sendSuccessResponse(res, "Notification counts fetched successfully", {
        unreadCount,
        counts: {
          all: totalAll,
          leave: totalLeave,
          attendance: totalAttendance,
          payroll: totalPayroll,
          system: totalSystem,
        },
        tabs: [
          { key: "all", label: "All", count: totalAll },
          { key: "leave", label: "Leave", count: totalLeave },
          { key: "attendance", label: "Attendance", count: totalAttendance },
          { key: "payroll", label: "Payroll", count: totalPayroll },
          { key: "system", label: "System", count: totalSystem },
        ],
      });
    } catch (error) {
      console.error("Get Notification Counts Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch notification counts", error);
    }
  }

  static async markAllAsRead(req, res) {
    try {
      const recipientId = req.user?._id;
      if (!recipientId) {
        return sendBadRequestResponse(res, "Authentication required");
      }

      const result = await NotificationModel.updateMany(
        {
          recipient: recipientId,
          isRead: false,
          isDeleted: false,
        },
        {
          $set: {
            isRead: true,
            readAt: new Date(),
          },
        }
      );

      return sendSuccessResponse(res, "All notifications marked as read", {
        modifiedCount: result.modifiedCount || 0,
        unreadCount: 0,
      });
    } catch (error) {
      console.error("Mark All As Read Error:", error);
      return sendErrorResponse(res, 500, "Failed to mark notifications as read", error);
    }
  }

  static async markAsRead(req, res) {
    try {
      const recipientId = req.user?._id;
      const { id } = req.params;

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid notification ID");
      }

      const notification = await NotificationModel.findOneAndUpdate(
        {
          _id: id,
          recipient: recipientId,
          isDeleted: false,
        },
        {
          $set: {
            isRead: true,
            readAt: new Date(),
          },
        },
        { new: true }
      );

      if (!notification) {
        return sendNotFoundResponse(res, "Notification not found");
      }

      const unreadCount = await NotificationModel.countDocuments({
        recipient: recipientId,
        isRead: false,
        isDeleted: false,
      });

      return sendSuccessResponse(res, "Notification marked as read", {
        notification,
        unreadCount,
      });
    } catch (error) {
      console.error("Mark As Read Error:", error);
      return sendErrorResponse(res, 500, "Failed to mark notification as read", error);
    }
  }

  static async deleteNotification(req, res) {
    try {
      const recipientId = req.user?._id;
      const { id } = req.params;

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid notification ID");
      }

      const deleted = await NotificationModel.findOneAndDelete({
        _id: id,
        recipient: recipientId,
      });

      if (!deleted) {
        return sendNotFoundResponse(res, "Notification not found");
      }

      return sendSuccessResponse(res, "Notification deleted successfully");
    } catch (error) {
      console.error("Delete Notification Error:", error);
      return sendErrorResponse(res, 500, "Failed to delete notification", error);
    }
  }

  static async clearAllNotification(req, res) {
    try {
      const recipientId = req.user?._id;
      if (!recipientId) {
        return sendBadRequestResponse(res, "Authentication required");
      }

      await NotificationModel.deleteMany({
        recipient: recipientId,
      });

      return sendSuccessResponse(res, "All notifications cleared successfully");
    } catch (error) {
      console.error("Clear All Notifications Error:", error);
      return sendErrorResponse(res, 500, "Failed to clear notifications", error);
    }
  }
}

