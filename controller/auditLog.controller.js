import mongoose from "mongoose";
import AuditLogModel from "../model/auditLog.model.js";
import {
  formatAuditDate,
  recordAuditLog,
  getClientIp,
} from "../utils/auditLogger.js";
import {
  sendCreatedResponse,
  sendSuccessResponse,
  sendErrorResponse,
  sendBadRequestResponse,
  sendNotFoundResponse,
} from "../utils/Response.utils.js";

export class AuditLogController {
  static async getAuditLogs(req, res) {
    try {
      const { category, search, page, limit, sortBy = "eventDate", order = "desc" } = req.query;

      const baseFilter = { isDeleted: false };

      const [allCount, employeesCount, payrollCount, leaveCount, securityCount] =
        await Promise.all([
          AuditLogModel.countDocuments(baseFilter),
          AuditLogModel.countDocuments({ ...baseFilter, category: "Employees" }),
          AuditLogModel.countDocuments({ ...baseFilter, category: "Payroll" }),
          AuditLogModel.countDocuments({ ...baseFilter, category: "Leave" }),
          AuditLogModel.countDocuments({ ...baseFilter, category: "Security" }),
        ]);

      const filter = { ...baseFilter };

      if (category && category.trim().toLowerCase() !== "all" && category.trim().toLowerCase() !== "all events") {
        filter.category = { $regex: new RegExp(`^${category.trim()}$`, "i") };
      }

      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        filter.$or = [
          { action: regex },
          { actorName: regex },
          { actorRole: regex },
          { description: regex },
          { ipAddress: regex },
          { auditCode: regex },
        ];
      }

      const sortOptions = {};
      sortOptions[sortBy] = order === "asc" ? 1 : -1;

      let query = AuditLogModel.find(filter).sort(sortOptions);

      const totalMatched = await AuditLogModel.countDocuments(filter);

      if (page && limit) {
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const skip = (pageNum - 1) * limitNum;
        query = query.skip(skip).limit(limitNum);
      }

      const rawLogs = await query.lean();

      const logs = rawLogs.map((log) => ({
        ...log,
        formattedDate: formatAuditDate(log.eventDate),
        actorDisplay: `by ${log.actorName} (${log.actorRole || "User"})`,
        ipDisplay: `IP: ${log.ipAddress}`,
        diffModalTitle: `Audit Record Change Diff (${log.auditCode})`,
      }));

      return sendSuccessResponse(res, "Audit logs fetched successfully", {
        header: {
          title: "System Audit Records",
          subtitle: `${allCount} audit trail event${allCount === 1 ? "" : "s"} recorded`,
        },
        counts: {
          all: allCount,
          employees: employeesCount,
          payroll: payrollCount,
          leave: leaveCount,
          security: securityCount,
        },
        logs,
        total: totalMatched,
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : totalMatched,
      });
    } catch (error) {
      console.error("Get Audit Logs Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch audit logs", error);
    }
  }

  static async getAuditLogById(req, res) {
    try {
      const { id } = req.params;
      const isObjectId = mongoose.Types.ObjectId.isValid(id);
      const query = isObjectId ? { _id: id } : { auditCode: id };

      const log = await AuditLogModel.findOne(query).lean();
      if (!log) {
        return sendNotFoundResponse(res, "Audit record not found");
      }

      return sendSuccessResponse(res, "Audit record fetched successfully", {
        ...log,
        formattedDate: formatAuditDate(log.eventDate),
        actorDisplay: `by ${log.actorName} (${log.actorRole || "User"})`,
        ipDisplay: `IP: ${log.ipAddress}`,
      });
    } catch (error) {
      console.error("Get Audit Log By ID Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch audit record", error);
    }
  }

  static async getAuditLogDiff(req, res) {
    try {
      const { id } = req.params;
      const isObjectId = mongoose.Types.ObjectId.isValid(id);
      const query = isObjectId ? { _id: id } : { auditCode: id };

      const log = await AuditLogModel.findOne(query).lean();
      if (!log) {
        return sendNotFoundResponse(res, "Audit record not found");
      }

      const formattedDate = formatAuditDate(log.eventDate);

      return sendSuccessResponse(res, "Audit record change diff fetched successfully", {
        auditCode: log.auditCode,
        modalTitle: `Audit Record Change Diff (${log.auditCode})`,
        operation: log.action,
        operationDisplay: `Operation: ${log.action}`,
        actorInfo: `${log.actorName} (${log.actorRole || "User"}) - ${formattedDate}`,
        actorInfoDisplay: `Actor: ${log.actorName} (${log.actorRole || "User"}) - ${formattedDate}`,
        previousState: log.diff?.before || "None",
        newState: log.diff?.after || "None",
        category: log.category,
        ipAddress: log.ipAddress,
        eventDate: log.eventDate,
      });
    } catch (error) {
      console.error("Get Audit Log Diff Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch audit log diff", error);
    }
  }

  static async createAuditLog(req, res) {
    try {
      const {
        action,
        actorName,
        actorRole,
        category = "Security",
        description = "",
        targetResource = "",
        ipAddress,
        diff,
        previousState,
        newState,
        badgeColor,
        eventDate,
      } = req.body;

      if (!action || !String(action).trim()) {
        return sendBadRequestResponse(res, "Action title is required!");
      }

      const finalDiff = {
        before: String(diff?.before || previousState || "").trim(),
        after: String(diff?.after || newState || "").trim(),
      };

      const newLog = await recordAuditLog(req, {
        action,
        actorName,
        actorRole,
        category,
        description,
        targetResource,
        diff: finalDiff,
        badgeColor,
        eventDate,
      });

      if (!newLog) {
        return sendErrorResponse(res, 500, "Failed to record audit log");
      }

      const logObj = newLog.toObject ? newLog.toObject() : newLog;

      return sendCreatedResponse(res, "Audit log event recorded successfully!", {
        ...logObj,
        formattedDate: formatAuditDate(logObj.eventDate),
        actorDisplay: `by ${logObj.actorName} (${logObj.actorRole})`,
        ipDisplay: `IP: ${logObj.ipAddress}`,
      });
    } catch (error) {
      console.error("Create Audit Log Error:", error);
      return sendErrorResponse(res, 500, "Failed to record audit log", error);
    }
  }

  static async exportAuditLogs(req, res) {
    try {
      const logs = await AuditLogModel.find({ isDeleted: false })
        .sort({ eventDate: -1 })
        .lean();

      const headers = ["Audit Code", "Action", "Actor Name", "Actor Role", "Category", "Description", "IP Address", "Date & Time", "Previous State", "New State"];
      const rows = logs.map((log) => [
        `"${log.auditCode}"`,
        `"${(log.action || "").replace(/"/g, '""')}"`,
        `"${(log.actorName || "").replace(/"/g, '""')}"`,
        `"${(log.actorRole || "").replace(/"/g, '""')}"`,
        `"${log.category}"`,
        `"${(log.description || "").replace(/"/g, '""')}"`,
        `"${log.ipAddress}"`,
        `"${formatAuditDate(log.eventDate)}"`,
        `"${(log.diff?.before || "").replace(/"/g, '""')}"`,
        `"${(log.diff?.after || "").replace(/"/g, '""')}"`,
      ]);

      const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=audit-logs-${Date.now()}.csv`);
      return res.status(200).send(csvContent);
    } catch (error) {
      console.error("Export Audit Logs Error:", error);
      return sendErrorResponse(res, 500, "Failed to export audit logs", error);
    }
  }
}
