import jwt from "jsonwebtoken";
import UserModel from "../model/user.model.js";
import { sendErrorResponse, sendUnauthorizedResponse, sendNotFoundResponse } from "../utils/Response.utils.js";
import dotenv from "dotenv";
dotenv.config();

export const UserAuth = async (req, res, next) => {
  try {
    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured in environment variables.");
      return sendErrorResponse(res, 500, "Server configuration error");
    }

    const token =
      req.header("Authorization")?.replace("Bearer ", "") ||
      req.query.token;

    if (!token) {
      return sendUnauthorizedResponse(res, "Access denied. No token provided.", "NO_TOKEN");
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = decoded.id || decoded._id;

      const user = await UserModel.findById(userId).select("-password -otp");
      if (!user) {
        return sendNotFoundResponse(res, "User profile not found");
      }

      if (user.isUserDeleted) {
        return sendUnauthorizedResponse(res, "This account has been deleted.", "ACCOUNT_DELETED");
      }

      const userTokenVersion = user.tokenVersion || 0;
      if (
        decoded.tokenVersion !== undefined &&
        decoded.tokenVersion !== userTokenVersion
      ) {
        return sendUnauthorizedResponse(
          res,
          "Session expired or logged out. Please log in again.",
          "SESSION_EXPIRED"
        );
      }

      if (
        user.lastLogoutAt &&
        decoded.iat &&
        decoded.iat * 1000 < new Date(user.lastLogoutAt).getTime()
      ) {
        return sendUnauthorizedResponse(
          res,
          "Session expired. You have logged out, please log in again.",
          "SESSION_EXPIRED"
        );
      }

      req.user = user;
      next();
    } catch (err) {
      console.error("Token verification failed:", err.message);
      if (err.name === "TokenExpiredError") {
        return sendUnauthorizedResponse(res, "Access denied. Token has expired.", "TOKEN_EXPIRED");
      }
      return sendUnauthorizedResponse(res, "Access denied. Invalid or expired token.", "INVALID_TOKEN");
    }
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const adminAuth = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return sendUnauthorizedResponse(res, "Access Denied. Admins only.", "ADMIN_ONLY");
  }
  next();
};

export const employeeAuth = (req, res, next) => {
  if (!req.user || req.user.role !== "employee") {
    return sendUnauthorizedResponse(res, "Access Denied. Employees only.", "EMPLOYEE_ONLY");
  }
  next();
};

export const checkUserSubscriptionAccess = async (user) => {
  if (!user) {
    return { hasAccess: false, reason: "no_user" };
  }

  if (user.role === "admin") {
    return {
      hasAccess: true,
      reason: "admin",
      isTrial: false,
      isActivePlan: true,
      daysRemaining: 9999,
    };
  }

  const now = new Date();

  if (
    user.subscription?.status === "active" &&
    user.subscription?.endDate &&
    now < new Date(user.subscription.endDate)
  ) {
    const daysRemaining = Math.max(
      0,
      Math.ceil((new Date(user.subscription.endDate) - now) / (1000 * 60 * 60 * 24))
    );
    return {
      hasAccess: true,
      reason: "active_plan",
      isTrial: false,
      isActivePlan: true,
      planTitle: user.subscription.planTitle,
      startDate: user.subscription.startDate,
      endDate: user.subscription.endDate,
      daysRemaining,
    };
  }

  if (user.subscription?.isFamilyMember && user.subscription?.familyOwnerId) {
    const owner = await UserModel.findById(user.subscription.familyOwnerId);
    if (
      owner &&
      owner.subscription?.status === "active" &&
      owner.subscription?.endDate &&
      now < new Date(owner.subscription.endDate)
    ) {
      const daysRemaining = Math.max(
        0,
        Math.ceil((new Date(owner.subscription.endDate) - now) / (1000 * 60 * 60 * 24))
      );
      return {
        hasAccess: true,
        reason: "family_member",
        isTrial: false,
        isActivePlan: true,
        planTitle: owner.subscription.planTitle || "Family Plan",
        familyOwner: {
          id: owner._id,
          name: owner.name,
          email: owner.email,
        },
        startDate: owner.subscription.startDate,
        endDate: owner.subscription.endDate,
        daysRemaining,
      };
    }
  }

  const trialEnd = user.trialEndDate
    ? new Date(user.trialEndDate)
    : new Date(new Date(user.createdAt || now).getTime() + 7 * 24 * 60 * 60 * 1000);

  if (now < trialEnd) {
    const daysRemaining = Math.max(
      0,
      Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24))
    );
    return {
      hasAccess: true,
      reason: "trial",
      isTrial: true,
      isActivePlan: false,
      trialStartDate: user.trialStartDate || user.createdAt,
      trialEndDate: trialEnd,
      daysRemaining,
    };
  }

  return {
    hasAccess: false,
    reason: "expired",
    isTrial: false,
    isActivePlan: false,
    trialStartDate: user.trialStartDate || user.createdAt,
    trialEndDate: trialEnd,
    daysRemaining: 0,
  };
};

export const requireSubscription = async (req, res, next) => {
  try {
    if (!req.user) {
      return sendUnauthorizedResponse(res, "Access denied. Authentication required.");
    }

    const accessInfo = await checkUserSubscriptionAccess(req.user);

    if (!accessInfo.hasAccess) {
      return res.status(403).json({
        success: false,
        isSubscriptionRequired: true,
        trialExpired: true,
        message:
          "Your 7-day free trial has expired. Please subscribe to one of our plans to continue using AI tutor, lessons, and topics.",
        result: {
          accessStatus: "expired",
          trialEndDate: accessInfo.trialEndDate,
        },
      });
    }

    req.subscriptionAccess = accessInfo;
    next();
  } catch (error) {
    console.error("Subscription verification error:", error);
    return sendErrorResponse(res, 500, "Failed to verify subscription status", error);
  }
};
