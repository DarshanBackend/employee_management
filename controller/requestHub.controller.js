import mongoose from "mongoose";
import LeaveModel from "../model/leave.model.js";
import AttendanceRegularizationModel from "../model/attendanceRegularization.model.js";
import ProfileUpdateRequestModel from "../model/profileUpdateRequest.model.js";
import ExpenseModel from "../model/expense.model.js";
import UserModel from "../model/user.model.js";
import {
  sendSuccessResponse,
  sendCreatedResponse,
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendForbiddenResponse,
  sendErrorResponse,
} from "../utils/Response.utils.js";
import { recordAuditLog } from "../utils/auditLogger.js";

const formatDDMMYYYY = (input) => {
  if (!input) return "";
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [year, month, day] = input.split("-");
    return `${day}-${month}-${year}`;
  }
  const d = new Date(input);
  if (isNaN(d.getTime())) return String(input);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
};

const formatDisplayDate = (date) => {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${day} ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
};

const getStatusBadgeColor = (status) => {
  switch (String(status || "").toLowerCase()) {
    case "approved":
    case "verified":
      return "#10B981";
    case "pending":
    case "pending review":
      return "#F59E0B";
    case "rejected":
      return "#EF4444";
    case "cancelled":
      return "#6B7280";
    default:
      return "#3B82F6";
  }
};

export class RequestHubController {
  static async getMyRequestsHub(req, res) {
    try {
      const isEmployeeUser = req.user?.role === "employee";
      let targetUserId = req.user?._id;

      if (!isEmployeeUser && (req.query.employee || req.query.employeeId)) {
        const empQuery = String(req.query.employee || req.query.employeeId).trim();
        if (mongoose.Types.ObjectId.isValid(empQuery)) {
          const found = await UserModel.findById(empQuery);
          if (found) targetUserId = found._id;
        } else {
          const found = await UserModel.findOne({
            $or: [{ employeeId: empQuery }, { email: empQuery.toLowerCase() }],
            isUserDeleted: { $ne: true },
          });
          if (found) targetUserId = found._id;
        }
      }

      if (!targetUserId) {
        return sendBadRequestResponse(res, "Employee identification required");
      }

      const {
        category = "all",
        status,
        search,
        page = 1,
        limit = 10,
      } = req.query;

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, parseInt(limit, 10) || 10);
      const activeCat = String(category || "all").toLowerCase().trim();
      const statusFilter = status && status.toLowerCase() !== "all" ? status : null;

      const empObjectId = new mongoose.Types.ObjectId(String(targetUserId));

      const [
        leavesTotalCount,
        correctionsTotalCount,
        profileTotalCount,
        expensesTotalCount,
      ] = await Promise.all([
        LeaveModel.countDocuments({ employee: empObjectId }),
        AttendanceRegularizationModel.countDocuments({ employee: empObjectId }),
        ProfileUpdateRequestModel.countDocuments({ employee: empObjectId }),
        ExpenseModel.countDocuments({ employee: empObjectId, isDeleted: false }),
      ]);

      const counts = {
        all:
          leavesTotalCount +
          correctionsTotalCount +
          profileTotalCount +
          expensesTotalCount,
        leaves: leavesTotalCount,
        corrections: correctionsTotalCount,
        profile: profileTotalCount,
        expenses: expensesTotalCount,
      };

      const tabs = [
        { key: "all", label: "All Requests", count: counts.all },
        { key: "leaves", label: "Leaves", count: counts.leaves },
        { key: "corrections", label: "Corrections", count: counts.corrections },
        { key: "profile", label: "Profile", count: counts.profile },
        { key: "expenses", label: "Expenses", count: counts.expenses },
      ];

      const allItems = [];

      if (["all", "leaves", "leave"].includes(activeCat)) {
        const leaveQuery = { employee: empObjectId };
        if (statusFilter) {
          leaveQuery.status = new RegExp(`^${statusFilter}$`, "i");
        }
        if (search) {
          const rgx = new RegExp(search, "i");
          leaveQuery.$or = [
            { leaveTypeName: rgx },
            { reason: rgx },
            { fromDate: rgx },
            { toDate: rgx },
          ];
        }

        const leaves = await LeaveModel.find(leaveQuery)
          .sort({ createdAt: -1 })
          .lean();

        for (const lv of leaves) {
          const fromDisplay = lv.formattedFromDate || formatDDMMYYYY(lv.fromDate);
          const toDisplay = lv.formattedToDate || formatDDMMYYYY(lv.toDate);
          const daysText = lv.totalDays === 1 ? "1 day" : `${lv.totalDays} days`;

          allItems.push({
            _id: lv._id,
            requestId: lv._id,
            category: "Leaves",
            categoryKey: "leaves",
            type: "Leave",
            title: lv.leaveTypeName || "Leave Application",
            subtitle: `${fromDisplay} to ${toDisplay} (${daysText})`,
            status: lv.status || "Pending",
            statusBadgeColor: getStatusBadgeColor(lv.status),
            date: formatDisplayDate(lv.createdAt),
            formattedDate: formatDDMMYYYY(lv.createdAt),
            createdAt: lv.createdAt,
            updatedAt: lv.updatedAt,
            reason: lv.reason || "",
            duration: daysText,
            adminRemarks: lv.rejectionReason || "",
            actionBy: lv.approvedBy || null,
            actionAt: lv.approvedAt || null,
            details: {
              leaveId: lv._id,
              leaveType: lv.leaveType,
              leaveTypeName: lv.leaveTypeName,
              fromDate: lv.fromDate,
              toDate: lv.toDate,
              formattedFromDate: fromDisplay,
              formattedToDate: toDisplay,
              isHalfDay: Boolean(lv.isHalfDay),
              halfDaySession: lv.halfDaySession || null,
              totalDays: lv.totalDays,
              reason: lv.reason,
              emergencyContact: lv.emergencyContact || "",
              documentUrl: lv.documentUrl || null,
              rejectionReason: lv.rejectionReason || "",
            },
          });
        }
      }

      if (
        ["all", "corrections", "correction", "attendance"].includes(activeCat)
      ) {
        const attQuery = { employee: empObjectId };
        if (statusFilter) {
          attQuery.status = new RegExp(`^${statusFilter}$`, "i");
        }
        if (search) {
          const rgx = new RegExp(search, "i");
          attQuery.$or = [
            { correctionType: rgx },
            { reason: rgx },
            { date: rgx },
            { formattedDate: rgx },
          ];
        }

        const corrections = await AttendanceRegularizationModel.find(attQuery)
          .sort({ createdAt: -1 })
          .lean();

        for (const att of corrections) {
          const punchDateDisplay = att.formattedDate || formatDDMMYYYY(att.date);
          const subtitle = `Date: ${punchDateDisplay} • Punch: ${att.requestedTimestamp || "N/A"}`;

          allItems.push({
            _id: att._id,
            requestId: att._id,
            category: "Corrections",
            categoryKey: "corrections",
            type: "Correction",
            title: att.correctionType || "Attendance Correction",
            subtitle,
            status: att.status || "Pending",
            statusBadgeColor: getStatusBadgeColor(att.status),
            date: formatDisplayDate(att.createdAt),
            formattedDate: formatDDMMYYYY(att.createdAt),
            createdAt: att.createdAt,
            updatedAt: att.updatedAt,
            reason: att.reason || "",
            duration: att.requestedTimestamp || "",
            adminRemarks: att.managerNote || "",
            actionBy: att.reviewedBy || null,
            actionAt: att.reviewedAt || null,
            details: {
              regularizationId: att._id,
              date: att.date,
              formattedDate: punchDateDisplay,
              correctionType: att.correctionType,
              originalPunch: att.originalPunch,
              requestedTimestamp: att.requestedTimestamp,
              reason: att.reason,
              managerNote: att.managerNote || "",
            },
          });
        }
      }

      if (
        ["all", "profile", "profileupdate", "employees"].includes(activeCat)
      ) {
        const profileQuery = { employee: empObjectId };
        if (statusFilter) {
          profileQuery.status = new RegExp(`^${statusFilter}$`, "i");
        }
        if (search) {
          const rgx = new RegExp(search, "i");
          profileQuery.$or = [
            { fieldToUpdate: rgx },
            { proposedValue: rgx },
            { currentValue: rgx },
            { reason: rgx },
          ];
        }

        const profileReqs = await ProfileUpdateRequestModel.find(profileQuery)
          .sort({ createdAt: -1 })
          .lean();

        for (const pu of profileReqs) {
          const subtitle = `Current: ${pu.currentValue || "N/A"} ➔ New: ${pu.proposedValue}`;

          allItems.push({
            _id: pu._id,
            requestId: pu._id,
            category: "Profile",
            categoryKey: "profile",
            type: "Profile",
            title: pu.fieldToUpdate || "Profile Update",
            subtitle,
            status: pu.status || "Pending",
            statusBadgeColor: getStatusBadgeColor(pu.status),
            date: formatDisplayDate(pu.createdAt),
            formattedDate: formatDDMMYYYY(pu.createdAt),
            createdAt: pu.createdAt,
            updatedAt: pu.updatedAt,
            reason: pu.reason || "",
            duration: pu.proposedValue || "",
            adminRemarks: pu.adminRemarks || "",
            actionBy: pu.actionBy || null,
            actionAt: pu.actionAt || null,
            details: {
              profileUpdateRequestId: pu._id,
              fieldToUpdate: pu.fieldToUpdate,
              currentValue: pu.currentValue,
              proposedValue: pu.proposedValue,
              reason: pu.reason,
              adminRemarks: pu.adminRemarks || "",
            },
          });
        }
      }

      if (["all", "expenses", "expense"].includes(activeCat)) {
        const expQuery = { employee: empObjectId, isDeleted: false };
        if (statusFilter) {
          expQuery.status = new RegExp(`^${statusFilter}$`, "i");
        }
        if (search) {
          const rgx = new RegExp(search, "i");
          expQuery.$or = [
            { title: rgx },
            { category: rgx },
            { reason: rgx },
            { date: rgx },
          ];
        }

        const expenses = await ExpenseModel.find(expQuery)
          .sort({ createdAt: -1 })
          .lean();

        for (const exp of expenses) {
          const expDateDisplay = exp.formattedDate || formatDDMMYYYY(exp.date);
          const subtitle = `${exp.currency || "INR"} ${exp.amount} • ${expDateDisplay}`;

          allItems.push({
            _id: exp._id,
            requestId: exp._id,
            category: "Expenses",
            categoryKey: "expenses",
            type: "Expense",
            title: exp.title || "Expense Claim",
            subtitle,
            status: exp.status || "Pending",
            statusBadgeColor: getStatusBadgeColor(exp.status),
            date: formatDisplayDate(exp.createdAt),
            formattedDate: formatDDMMYYYY(exp.createdAt),
            createdAt: exp.createdAt,
            updatedAt: exp.updatedAt,
            reason: exp.reason || "",
            duration: `${exp.currency || "INR"} ${exp.amount}`,
            adminRemarks: exp.adminRemarks || "",
            actionBy: exp.approvedBy || null,
            actionAt: exp.approvedAt || null,
            details: {
              expenseId: exp._id,
              title: exp.title,
              category: exp.category,
              amount: exp.amount,
              currency: exp.currency,
              date: exp.date,
              formattedDate: expDateDisplay,
              reason: exp.reason,
              adminRemarks: exp.adminRemarks || "",
            },
          });
        }
      }

      allItems.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      const total = allItems.length;
      const totalPages = Math.ceil(total / limitNum) || 1;
      const startIndex = (pageNum - 1) * limitNum;
      const paginatedRequests = allItems.slice(startIndex, startIndex + limitNum);

      return sendSuccessResponse(res, "Requests retrieved successfully", {
        counts,
        tabs,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages,
        requests: paginatedRequests,
        items: paginatedRequests,
      });
    } catch (error) {
      console.error("Get My Requests Hub Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch requests", error);
    }
  }

  static async submitExpenseRequest(req, res) {
    try {
      const isEmployeeUser = req.user?.role === "employee";
      let targetEmpId = req.user?._id;

      if (!isEmployeeUser && (req.body.employee || req.body.employeeId)) {
        const empQuery = String(req.body.employee || req.body.employeeId).trim();
        if (mongoose.Types.ObjectId.isValid(empQuery)) {
          const found = await UserModel.findById(empQuery);
          if (found) targetEmpId = found._id;
        } else {
          const found = await UserModel.findOne({
            $or: [{ employeeId: empQuery }, { email: empQuery.toLowerCase() }],
            isUserDeleted: { $ne: true },
          });
          if (found) targetEmpId = found._id;
        }
      }

      const {
        title,
        category = "Other",
        amount,
        currency = "INR",
        date,
        reason = "",
      } = req.body || {};

      if (!title || !title.trim()) {
        return sendBadRequestResponse(res, "Expense title is required");
      }
      if (amount === undefined || amount === null || isNaN(Number(amount)) || Number(amount) < 0) {
        return sendBadRequestResponse(res, "Valid expense amount is required");
      }

      const expenseDate = date ? String(date).trim() : new Date().toISOString().split("T")[0];
      const formattedDate = formatDDMMYYYY(expenseDate);

      const status = isEmployeeUser ? "Pending" : "Approved";

      const newExpense = await ExpenseModel.create({
        employee: targetEmpId,
        title: title.trim(),
        category: category.trim(),
        amount: Number(amount),
        currency: currency.trim(),
        date: expenseDate,
        formattedDate,
        reason: reason.trim(),
        status,
        approvedBy: !isEmployeeUser ? req.user?._id : null,
        approvedAt: !isEmployeeUser ? new Date() : null,
      });

      return sendCreatedResponse(res, "Expense request submitted successfully", newExpense);
    } catch (error) {
      console.error("Submit Expense Request Error:", error);
      return sendErrorResponse(res, 500, "Failed to submit expense request", error);
    }
  }

  static async cancelRequest(req, res) {
    try {
      const { category, id } = req.params;
      const cat = String(category || "").toLowerCase();

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid request ID");
      }

      const isEmployeeUser = req.user?.role === "employee";
      const empIdStr = String(req.user?._id);

      if (cat === "leaves" || cat === "leave") {
        const item = await LeaveModel.findById(id);
        if (!item) return sendNotFoundResponse(res, "Leave request not found");
        if (isEmployeeUser && String(item.employee) !== empIdStr) {
          return sendForbiddenResponse(res, "You can only cancel your own requests");
        }
        if (item.status !== "Pending") {
          return sendBadRequestResponse(res, `Cannot cancel request that is already ${item.status}`);
        }
        item.status = "Cancelled";
        await item.save();
        return sendSuccessResponse(res, "Leave request cancelled successfully", item);
      }

      if (cat === "corrections" || cat === "correction" || cat === "attendance") {
        const item = await AttendanceRegularizationModel.findById(id);
        if (!item) return sendNotFoundResponse(res, "Correction request not found");
        if (isEmployeeUser && String(item.employee) !== empIdStr) {
          return sendForbiddenResponse(res, "You can only cancel your own requests");
        }
        if (item.status !== "Pending") {
          return sendBadRequestResponse(res, `Cannot cancel request that is already ${item.status}`);
        }
        await AttendanceRegularizationModel.findByIdAndDelete(id);
        return sendSuccessResponse(res, "Correction request cancelled successfully");
      }

      if (cat === "profile" || cat === "profileupdate") {
        const item = await ProfileUpdateRequestModel.findById(id);
        if (!item) return sendNotFoundResponse(res, "Profile update request not found");
        if (isEmployeeUser && String(item.employee) !== empIdStr) {
          return sendForbiddenResponse(res, "You can only cancel your own requests");
        }
        if (item.status !== "Pending") {
          return sendBadRequestResponse(res, `Cannot cancel request that is already ${item.status}`);
        }
        await ProfileUpdateRequestModel.findByIdAndDelete(id);
        return sendSuccessResponse(res, "Profile update request cancelled successfully");
      }

      if (cat === "expenses" || cat === "expense") {
        const item = await ExpenseModel.findById(id);
        if (!item || item.isDeleted) return sendNotFoundResponse(res, "Expense request not found");
        if (isEmployeeUser && String(item.employee) !== empIdStr) {
          return sendForbiddenResponse(res, "You can only cancel your own requests");
        }
        if (item.status !== "Pending") {
          return sendBadRequestResponse(res, `Cannot cancel request that is already ${item.status}`);
        }
        item.status = "Cancelled";
        item.isDeleted = true;
        await item.save();
        return sendSuccessResponse(res, "Expense request cancelled successfully", item);
      }

      return sendBadRequestResponse(res, "Invalid request category");
    } catch (error) {
      console.error("Cancel Request Error:", error);
      return sendErrorResponse(res, 500, "Failed to cancel request", error);
    }
  }
}