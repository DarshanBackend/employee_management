import mongoose from "mongoose";
import LeaveModel from "../model/leave.model.js";
import AttendanceRegularizationModel from "../model/attendanceRegularization.model.js";
import AttendanceModel from "../model/attendance.model.js";
import DocumentModel from "../model/document.model.js";
import PayrollRunModel from "../model/payrollRun.model.js";
import UserModel from "../model/user.model.js";
import { recordAuditLog } from "../utils/auditLogger.js";
import {
  sendSuccessResponse,
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendErrorResponse,
} from "../utils/Response.utils.js";
import {
  getNormalizedDateString,
  formatDisplayDate,
  combineDateAndTime,
} from "./attendance.controller.js";

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

const formatEmployeeInfo = (emp) => {
  if (!emp) {
    return {
      _id: null,
      name: "Unknown Employee",
      employeeId: "N/A",
      avatarUrl: "https://ui-avatars.com/api/?name=Employee&background=1F4E5B&color=fff",
      email: "",
      department: "General",
      designation: "Team Member",
      roleTitle: "Team Member",
      displaySubtitle: "Team Member",
    };
  }

  const empName = emp.name || `${emp.firstName || ""} ${emp.lastName || ""}`.trim() || "Employee";
  const empCode = emp.employeeId
    ? String(emp.employeeId).trim()
    : emp._id
      ? String(emp._id).slice(-4).toUpperCase()
      : "";
  const designationTitle =
    emp.designation?.designationName ||
    emp.designation?.designationTitle ||
    emp.roleTitle ||
    "Team Member";
  const departmentName = emp.department?.departmentName || "General";
  const roleTitle = `Team Member/${designationTitle}`;

  return {
    _id: emp._id,
    name: empName,
    employeeId: empCode,
    avatarUrl:
      emp.avatarUrl ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(empName)}&background=1F4E5B&color=fff`,
    email: emp.email || "",
    department: departmentName,
    designation: designationTitle,
    roleTitle,
    displaySubtitle: empCode ? `${empCode}  •  ${roleTitle}` : roleTitle,
  };
};

export class PendingActionController {
  static async getPendingActions(req, res) {
    try {
      const { category = "all", search, page = 1, limit = 10 } = req.query;

      const [
        pendingLeavesCount,
        pendingAttendanceCount,
        pendingPayrollCount,
        pendingDocumentsCount,
      ] = await Promise.all([
        LeaveModel.countDocuments({ status: "Pending" }),
        AttendanceRegularizationModel.countDocuments({ status: "Pending" }),
        PayrollRunModel.countDocuments({ status: { $in: ["Draft", "Ready"] } }),
        DocumentModel.countDocuments({ verificationStatus: "Pending Review" }),
      ]);

      const totalPending =
        pendingLeavesCount +
        pendingAttendanceCount +
        pendingPayrollCount +
        pendingDocumentsCount;

      const summary = {
        totalPending,
        leaveRequests: pendingLeavesCount,
        attendanceFixes: pendingAttendanceCount,
        payrollRuns: pendingPayrollCount,
        employeeDocuments: pendingDocumentsCount,
      };

      const tabs = [
        { label: "All", key: "all", count: totalPending },
        { label: "Leaves", key: "leaves", count: pendingLeavesCount },
        { label: "Attendance", key: "attendance", count: pendingAttendanceCount },
        { label: "Payroll", key: "payroll", count: pendingPayrollCount },
        { label: "Employees", key: "employees", count: pendingDocumentsCount },
      ];

      let searchUserIds = null;
      let searchRegex = null;
      if (search && search.trim()) {
        searchRegex = new RegExp(search.trim(), "i");
        const matchedUsers = await UserModel.find({
          $or: [
            { name: searchRegex },
            { firstName: searchRegex },
            { lastName: searchRegex },
            { employeeId: searchRegex },
            { email: searchRegex },
          ],
        }).select("_id");
        searchUserIds = matchedUsers.map((u) => u._id);
      }

      const activeCategory = String(category).trim().toLowerCase();
      let allItems = [];

      if (activeCategory === "all" || activeCategory === "leaves") {
        const leaveFilter = { status: "Pending" };
        if (searchRegex) {
          leaveFilter.$or = [
            { employee: { $in: searchUserIds } },
            { leaveTypeName: searchRegex },
            { reason: searchRegex },
            { formattedFromDate: searchRegex },
            { formattedToDate: searchRegex },
          ];
        }

        const leaves = await LeaveModel.find(leaveFilter)
          .populate({
            path: "employee",
            select: "name firstName lastName employeeId email avatarUrl department designation roleTitle",
            populate: [
              { path: "department", select: "departmentName" },
              { path: "designation", select: "designationName designationTitle" },
            ],
          })
          .populate("leaveType", "leaveTypeName color icon")
          .sort({ createdAt: -1 });

        const mappedLeaves = leaves.map((lv) => {
          const empInfo = formatEmployeeInfo(lv.employee);
          const submittedDateStr = formatDDMMYYYY(lv.appliedAt || lv.createdAt);
          const fromDisplay = formatDDMMYYYY(lv.fromDate) || lv.formattedFromDate;
          const toDisplay = formatDDMMYYYY(lv.toDate) || lv.formattedToDate;

          return {
            _id: lv._id,
            type: "Leaves",
            categoryKey: "leaves",
            subType: lv.leaveTypeName,
            status: "Pending",
            badgeColor: "#F59E0B",
            tag: `Leaves • ${lv.leaveTypeName} (${lv.totalDays})`,
            date: submittedDateStr,
            submittedDate: submittedDateStr,
            createdAt: lv.createdAt,
            description: "Leave request submitted for review.",
            duration: `${fromDisplay} to ${toDisplay}`,
            durationText: `Duration: ${fromDisplay} to ${toDisplay}  Leave Type: ${lv.leaveTypeName}  Days: ${lv.totalDays}`,
            details: {
              leaveId: lv._id,
              leaveType: lv.leaveTypeName,
              totalDays: lv.totalDays,
              fromDate: lv.fromDate,
              toDate: lv.toDate,
              formattedFromDate: fromDisplay,
              formattedToDate: toDisplay,
              isHalfDay: Boolean(lv.isHalfDay),
              halfDaySession: lv.halfDaySession || null,
              reason: lv.reason,
              emergencyContact: lv.emergencyContact || "",
              documentUrl: lv.documentUrl || null,
            },
            employee: empInfo,
          };
        });

        allItems.push(...mappedLeaves);
      }

      if (activeCategory === "all" || activeCategory === "attendance") {
        const attFilter = { status: "Pending" };
        if (searchRegex) {
          attFilter.$or = [
            { employee: { $in: searchUserIds } },
            { correctionType: searchRegex },
            { reason: searchRegex },
            { formattedDate: searchRegex },
            { date: searchRegex },
          ];
        }

        const attendances = await AttendanceRegularizationModel.find(attFilter)
          .populate({
            path: "employee",
            select: "name firstName lastName employeeId email avatarUrl department designation roleTitle",
            populate: [
              { path: "department", select: "departmentName" },
              { path: "designation", select: "designationName designationTitle" },
            ],
          })
          .sort({ createdAt: -1 });

        const mappedAtt = attendances.map((att) => {
          const empInfo = formatEmployeeInfo(att.employee);
          const submittedDateStr = formatDDMMYYYY(att.createdAt);
          const dateDisplay = formatDDMMYYYY(att.date) || att.formattedDate;

          return {
            _id: att._id,
            type: "Attendance",
            categoryKey: "attendance",
            subType: att.correctionType,
            status: "Pending",
            badgeColor: "#3B82F6",
            tag: `Attendance • ${att.correctionType}`,
            date: submittedDateStr,
            submittedDate: submittedDateStr,
            createdAt: att.createdAt,
            description: "Attendance correction request submitted for review.",
            duration: `${dateDisplay} (${att.requestedTimestamp})`,
            durationText: `Date: ${dateDisplay}  Correction: ${att.correctionType}  Punch Time: ${att.requestedTimestamp}`,
            details: {
              regularizationId: att._id,
              date: att.date,
              formattedDate: dateDisplay,
              correctionType: att.correctionType,
              requestedTimestamp: att.requestedTimestamp,
              originalPunch: att.originalPunch,
              reason: att.reason,
            },
            employee: empInfo,
          };
        });

        allItems.push(...mappedAtt);
      }

      if (activeCategory === "all" || activeCategory === "employees") {
        const docFilter = { verificationStatus: "Pending Review" };
        if (searchRegex) {
          docFilter.$or = [
            { employee: { $in: searchUserIds } },
            { documentTitle: searchRegex },
            { documentCategory: searchRegex },
            { fileName: searchRegex },
          ];
        }

        const documents = await DocumentModel.find(docFilter)
          .populate({
            path: "employee",
            select: "name firstName lastName employeeId email avatarUrl department designation roleTitle",
            populate: [
              { path: "department", select: "departmentName" },
              { path: "designation", select: "designationName designationTitle" },
            ],
          })
          .sort({ createdAt: -1 });

        const mappedDocs = documents.map((doc) => {
          const empInfo = formatEmployeeInfo(doc.employee);
          const submittedDateStr = formatDisplayDate(doc.createdAt);

          return {
            _id: doc._id,
            type: "Employees",
            categoryKey: "employees",
            subType: doc.documentCategory,
            status: "Pending",
            badgeColor: "#10B981",
            tag: `Employees • ${doc.documentTitle}`,
            date: submittedDateStr,
            submittedDate: submittedDateStr,
            createdAt: doc.createdAt,
            description: `Document uploaded: '${doc.documentTitle}' needs review.`,
            duration: `${doc.fileName} (${doc.formattedSize || "1 MB"})`,
            durationText: `Document: ${doc.documentTitle}  Category: ${doc.documentCategory}`,
            details: {
              documentId: doc._id,
              documentTitle: doc.documentTitle,
              documentCategory: doc.documentCategory,
              fileName: doc.fileName,
              fileUrl: doc.fileUrl,
              fileSize: doc.fileSize,
              formattedSize: doc.formattedSize,
            },
            employee: empInfo,
          };
        });

        allItems.push(...mappedDocs);
      }

      if (activeCategory === "all" || activeCategory === "payroll") {
        const payrollFilter = { status: { $in: ["Draft", "Ready"] } };
        if (searchRegex) {
          payrollFilter.$or = [
            { cycle: searchRegex },
            { month: searchRegex },
            { departmentName: searchRegex },
          ];
        }

        const payrollRuns = await PayrollRunModel.find(payrollFilter)
          .populate("department", "departmentName")
          .sort({ createdAt: -1 });

        const mappedRuns = payrollRuns.map((run) => {
          const submittedDateStr = formatDisplayDate(run.createdAt);
          return {
            _id: run._id,
            type: "Payroll",
            categoryKey: "payroll",
            subType: `Payroll Cycle (${run.cycle})`,
            status: "Pending",
            badgeColor: "#8B5CF6",
            tag: `Payroll • ${run.cycle}`,
            date: submittedDateStr,
            submittedDate: submittedDateStr,
            createdAt: run.createdAt,
            description: `Monthly payroll run for '${run.departmentName}' is ready to sign.`,
            duration: `Net: ₹ ${Number(run.netDisbursement || 0).toLocaleString("en-IN")}`,
            durationText: `Cycle: ${run.cycle}  Employees: ${run.totalEmployees}  Net: ₹ ${Number(run.netDisbursement || 0).toLocaleString("en-IN")}`,
            details: {
              payrollRunId: run._id,
              cycle: run.cycle,
              month: run.month,
              year: run.year,
              grossTotal: run.grossTotal,
              totalDeductions: run.totalDeductions,
              netDisbursement: run.netDisbursement,
              totalEmployees: run.totalEmployees,
              status: run.status,
            },
            employee: {
              _id: null,
              name: run.departmentName || "All Departments",
              employeeId: run.cycle,
              avatarUrl: "https://ui-avatars.com/api/?name=Payroll&background=8B5CF6&color=fff",
              email: "hr@company.com",
              designation: "Payroll Run",
              department: run.departmentName || "Accounts",
              roleTitle: "Monthly Payroll",
              displaySubtitle: `Cycle: ${run.cycle} • ${run.totalEmployees} Employees`,
            },
          };
        });

        allItems.push(...mappedRuns);
      }

      allItems.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.max(1, parseInt(limit, 10));
      const totalMatched = allItems.length;
      const skip = (pageNum - 1) * limitNum;
      const paginatedItems = allItems.slice(skip, skip + limitNum);

      return sendSuccessResponse(res, "Pending actions fetched successfully", {
        summary,
        tabs,
        total: totalMatched,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalMatched / limitNum) || 1,
        requests: paginatedItems,
      });
    } catch (error) {
      console.error("Get Pending Actions Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch pending actions", error);
    }
  }

  static async actionPendingRequest(req, res) {
    try {
      const { type, id } = req.params;
      const { action, remarks = "", reason = "" } = req.body;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid request ID");
      }

      const normalizedAction = String(action || "").trim().toLowerCase();
      if (!["approve", "accept", "reject"].includes(normalizedAction)) {
        return sendBadRequestResponse(res, "Action must be either 'approve' or 'reject'!");
      }

      const isApprove = normalizedAction === "approve" || normalizedAction === "accept";
      const adminRemarks = remarks || reason || (isApprove ? "Approved by administrator" : "Rejected by administrator");
      const normalizedType = String(type || "").trim().toLowerCase();

      if (normalizedType === "leaves" || normalizedType === "leave") {
        const leave = await LeaveModel.findById(id).populate("employee").populate("leaveType");
        if (!leave) {
          return sendNotFoundResponse(res, "Leave application not found");
        }

        if (leave.status !== "Pending") {
          return sendBadRequestResponse(
            res,
            `This leave request has already been ${leave.status.toLowerCase()}!`
          );
        }

        if (isApprove) {
          leave.status = "Approved";
          leave.adminRemarks = adminRemarks;
          leave.actionBy = req.user?._id;
          leave.actionAt = new Date();

          const todayStr = getNormalizedDateString();
          if (leave.fromDate <= todayStr && leave.toDate >= todayStr) {
            let attendance = await AttendanceModel.findOne({
              employee: leave.employee._id,
              date: todayStr,
            });

            const leaveStatus = leave.isHalfDay ? "Half Day" : "On Leave";
            if (!attendance) {
              attendance = new AttendanceModel({
                employee: leave.employee._id,
                date: todayStr,
                formattedDate: formatDisplayDate(new Date(todayStr)),
                status: leaveStatus,
                notes: `Approved Leave: ${leave.leaveTypeName} (${leave.formattedFromDate || leave.fromDate} to ${leave.formattedToDate || leave.toDate})`,
              });
            } else {
              attendance.status = leaveStatus;
              attendance.notes = `${attendance.notes || ""} | Approved Leave: ${leave.leaveTypeName}`.trim();
            }
            await attendance.save();
          }
        } else {
          leave.status = "Rejected";
          leave.rejectionReason = adminRemarks;
          leave.adminRemarks = adminRemarks;
          leave.actionBy = req.user?._id;
          leave.actionAt = new Date();
        }

        await leave.save();

        await recordAuditLog(req, {
          action: `${isApprove ? "Approved" : "Rejected"} Leave Application`,
          category: "Leave Management",
          description: `${isApprove ? "Approved" : "Rejected"} ${leave.leaveTypeName} for ${leave.employee?.name || "Employee"}`,
          targetResource: `${leave.employee?.name || "Employee"} - ${leave.leaveTypeName}`,
        });

        return sendSuccessResponse(
          res,
          `Leave request ${leave.status.toLowerCase()} successfully!`,
          leave
        );
      }

      if (normalizedType === "attendance" || normalizedType === "regularization") {
        const request = await AttendanceRegularizationModel.findById(id).populate("employee");
        if (!request) {
          return sendNotFoundResponse(res, "Attendance correction request not found");
        }

        if (request.status !== "Pending") {
          return sendBadRequestResponse(
            res,
            `This correction request has already been ${request.status.toLowerCase()}!`
          );
        }

        if (isApprove) {
          request.status = "Approved";
          request.managerNote = adminRemarks;
          request.actionBy = req.user?._id;
          request.actionAt = new Date();

          let attendance = await AttendanceModel.findOne({
            employee: request.employee._id,
            date: request.date,
          });

          if (!attendance) {
            attendance = new AttendanceModel({
              employee: request.employee._id,
              date: request.date,
              formattedDate: request.formattedDate || formatDisplayDate(request.date),
              status: "Present",
            });
          }

          const requestedDateObj = combineDateAndTime(request.date, request.requestedTimestamp);
          if (request.correctionType === "Missed Check-In") {
            attendance.checkInTime = requestedDateObj;
            attendance.checkInDisplay = request.requestedTimestamp;
            attendance.isCheckInRegularized = true;
            attendance.status = "Present";
          } else if (request.correctionType === "Missed Check-Out") {
            attendance.checkOutTime = requestedDateObj;
            attendance.checkOutDisplay = request.requestedTimestamp;
            attendance.isCheckOutRegularized = true;
          }
          await attendance.save();
        } else {
          request.status = "Rejected";
          request.rejectionReason = adminRemarks;
          request.managerNote = adminRemarks;
          request.actionBy = req.user?._id;
          request.actionAt = new Date();
        }

        await request.save();

        await recordAuditLog(req, {
          action: `${isApprove ? "Approved" : "Rejected"} Attendance Regularization`,
          category: "Attendance & Shifts",
          description: `${isApprove ? "Approved" : "Rejected"} ${request.correctionType} on ${request.date} for ${request.employee?.name || "Employee"}`,
          targetResource: `${request.employee?.name || "Employee"} - ${request.correctionType}`,
        });

        return sendSuccessResponse(
          res,
          `Attendance correction ${request.status.toLowerCase()} successfully!`,
          request
        );
      }

      if (normalizedType === "employees" || normalizedType === "document" || normalizedType === "documents") {
        const doc = await DocumentModel.findById(id).populate("employee");
        if (!doc) {
          return sendNotFoundResponse(res, "Document not found");
        }

        if (isApprove) {
          doc.verificationStatus = "Verified";
          doc.verifiedBy = req.user?._id;
          doc.verifiedAt = new Date();
        } else {
          doc.verificationStatus = "Rejected";
          doc.remarks = adminRemarks;
        }

        await doc.save();

        await recordAuditLog(req, {
          action: `${isApprove ? "Verified" : "Rejected"} Document`,
          category: "Documents",
          description: `${isApprove ? "Verified" : "Rejected"} '${doc.documentTitle}' for ${doc.employee?.name || "Employee"}`,
          targetResource: doc.documentTitle,
        });

        return sendSuccessResponse(
          res,
          `Document ${isApprove ? "verified" : "rejected"} successfully!`,
          doc
        );
      }

      if (normalizedType === "payroll" || normalizedType === "payrollrun") {
        const run = await PayrollRunModel.findById(id);
        if (!run) {
          return sendNotFoundResponse(res, "Payroll run not found");
        }

        if (isApprove) {
          run.status = "Completed";
          run.executedBy = req.user?._id;
          run.executedAt = new Date();
        } else {
          run.status = "Draft";
        }

        await run.save();

        return sendSuccessResponse(
          res,
          `Payroll run for ${run.cycle} ${isApprove ? "approved and completed" : "reverted to draft"}!`,
          run
        );
      }

      return sendBadRequestResponse(res, `Unknown pending action type: '${type}'`);
    } catch (error) {
      console.error("Action Pending Request Error:", error);
      return sendErrorResponse(res, 500, "Failed to process pending action", error);
    }
  }

  static async approveAllPendingActions(req, res) {
    try {
      const { category = "all", remarks = "Bulk approved by administrator" } = req.body;
      const activeCategory = String(category).trim().toLowerCase();

      let approvedLeaves = 0;
      let approvedAttendance = 0;
      let approvedDocuments = 0;
      let approvedPayroll = 0;

      if (activeCategory === "all" || activeCategory === "leaves") {
        const pendingLeaves = await LeaveModel.find({ status: "Pending" });
        for (const lv of pendingLeaves) {
          lv.status = "Approved";
          lv.adminRemarks = remarks;
          lv.actionBy = req.user?._id;
          lv.actionAt = new Date();
          await lv.save();
          approvedLeaves++;
        }
      }

      if (activeCategory === "all" || activeCategory === "attendance") {
        const pendingAtt = await AttendanceRegularizationModel.find({ status: "Pending" });
        for (const att of pendingAtt) {
          att.status = "Approved";
          att.managerNote = remarks;
          att.actionBy = req.user?._id;
          att.actionAt = new Date();
          await att.save();
          approvedAttendance++;
        }
      }

      if (activeCategory === "all" || activeCategory === "employees") {
        const pendingDocs = await DocumentModel.find({ verificationStatus: "Pending Review" });
        for (const doc of pendingDocs) {
          doc.verificationStatus = "Verified";
          doc.verifiedBy = req.user?._id;
          doc.verifiedAt = new Date();
          await doc.save();
          approvedDocuments++;
        }
      }

      if (activeCategory === "all" || activeCategory === "payroll") {
        const pendingPayroll = await PayrollRunModel.find({ status: { $in: ["Draft", "Ready"] } });
        for (const run of pendingPayroll) {
          run.status = "Completed";
          run.executedBy = req.user?._id;
          run.executedAt = new Date();
          await run.save();
          approvedPayroll++;
        }
      }

      const totalApproved =
        approvedLeaves + approvedAttendance + approvedDocuments + approvedPayroll;

      await recordAuditLog(req, {
        action: "Bulk Approved Pending Actions",
        category: "System",
        description: `Approved ${totalApproved} pending action requests across categories (${category})`,
        targetResource: "Pending Actions",
      });

      return sendSuccessResponse(res, `Successfully approved ${totalApproved} pending request(s)!`, {
        totalApproved,
        breakdown: {
          leaves: approvedLeaves,
          attendance: approvedAttendance,
          documents: approvedDocuments,
          payroll: approvedPayroll,
        },
      });
    } catch (error) {
      console.error("Approve All Pending Actions Error:", error);
      return sendErrorResponse(res, 500, "Failed to bulk approve pending requests", error);
    }
  }
}
