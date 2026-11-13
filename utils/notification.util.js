import mongoose from "mongoose";
import NotificationModel, {
  NOTIFICATION_CATEGORIES,
} from "../model/notification.model.js";
import UserModel from "../model/user.model.js";
import {
  sendPushNotification,
  sendMulticastNotification,
} from "./notification.sender.js";

export const formatRelativeTime = (dateInput) => {
  if (!dateInput) return "";
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return "";

  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "Just now";
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  const day = String(d.getDate()).padStart(2, "0");
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];
  const month = monthNames[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
};

export const createNotification = async ({
  recipient,
  recipientId,
  sender = null,
  senderName = "System",
  senderAvatar = null,
  title,
  message,
  category = "System",
  type = "GENERAL",
  referenceId = null,
  referenceModel = null,
}) => {
  try {
    const targetRecipient = recipient || recipientId;
    if (!targetRecipient || !title || !message) {
      return null;
    }

    const validCategory = NOTIFICATION_CATEGORIES.includes(category)
      ? category
      : "System";

    const doc = await NotificationModel.create({
      recipient: targetRecipient,
      sender,
      senderName,
      senderAvatar,
      title: String(title).trim(),
      message: String(message).trim(),
      category: validCategory,
      type,
      referenceId,
      referenceModel,
      formattedTime: "Just now",
    });

    const user = await UserModel.findById(targetRecipient).select("fcmToken").lean();
    if (user?.fcmToken) {
      sendPushNotification(user.fcmToken, title, message, {
        notificationId: String(doc._id),
        category: validCategory,
        type,
      }).catch((err) => console.error("FCM Push Error:", err.message));
    }

    return doc;
  } catch (error) {
    console.error("Create Notification Error:", error.message);
    return null;
  }
};

export const notifyUser = async (recipientId, options) => {
  return await createNotification({
    ...options,
    recipient: recipientId,
  });
};

export const notifyUsers = async (recipientIds, options) => {
  if (!Array.isArray(recipientIds) || recipientIds.length === 0) return [];
  const results = [];
  for (const id of recipientIds) {
    const n = await createNotification({
      ...options,
      recipient: id,
    });
    if (n) results.push(n);
  }
  return results;
};

export const notifyAdmins = async (options) => {
  try {
    const admins = await UserModel.find({
      role: "admin",
      isUserDeleted: { $ne: true },
    }).select("_id name fcmToken").lean();

    if (!admins || admins.length === 0) return [];

    const results = [];
    const tokens = [];

    for (const adm of admins) {
      const doc = await createNotification({
        ...options,
        recipient: adm._id,
      });
      if (doc) results.push(doc);
      if (adm.fcmToken) tokens.push(adm.fcmToken);
    }

    if (tokens.length > 0) {
      sendMulticastNotification(tokens, options.title, options.message, {
        category: options.category || "System",
        type: options.type || "GENERAL",
      }).catch((err) => console.error("Admin FCM Multicast Error:", err.message));
    }

    return results;
  } catch (error) {
    console.error("Notify Admins Error:", error.message);
    return [];
  }
};

export const getUserNotifications = async (userId) => {
  try {
    return await NotificationModel.find({
      recipient: userId,
      isDeleted: false,
    })
      .sort({ createdAt: -1 })
      .lean();
  } catch (error) {
    console.error("Error fetching notifications:", error.message);
    return [];
  }
};

export const markNotificationAsRead = async (notificationId) => {
  try {
    return await NotificationModel.findByIdAndUpdate(
      notificationId,
      { isRead: true, readAt: new Date() },
      { new: true }
    );
  } catch (error) {
    console.error("Error marking notification as read:", error.message);
    return null;
  }
};

export const deleteNotification = async (notificationId) => {
  try {
    return await NotificationModel.findByIdAndUpdate(
      notificationId,
      { isDeleted: true },
      { new: true }
    );
  } catch (error) {
    console.error("Error deleting notification:", error.message);
    return null;
  }
};
