import XLSX from "xlsx";
import PDFDocument from "pdfkit";
import ExportReportModel, {
  DATA_CATEGORIES,
  OUTPUT_FORMATS,
  DATE_RANGES,
} from "../model/exportReport.model.js";
import UserModel from "../model/user.model.js";
import DepartmentModel from "../model/department.model.js";
import {
  sendSuccessResponse,
  sendErrorResponse,
  sendBadRequestResponse,
  sendNotFoundResponse,
} from "../utils/Response.utils.js";
import mongoose from "mongoose";

const formatFileSize = (bytes) => {
  if (!bytes || bytes === 0) return "0 KB";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  if (i === 0) return `${bytes} Bytes`;
  const formatted = (bytes / Math.pow(k, i)).toFixed(i >= 2 ? 1 : 0);
  return `${formatted} ${sizes[i]}`;
};

const formatDisplayDate = (date) => {
  if (!date) return "Just now";
  const d = new Date(date);
  const now = new Date();
  const diffMinutes = Math.floor((now - d) / 1000 / 60);

  if (diffMinutes < 5) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes} mins ago`;

  const day = String(d.getDate()).padStart(2, "0");
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const month = monthNames[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
};

const normalizeFormat = (formatStr) => {
  if (!formatStr) return "xlsx";
  const str = String(formatStr).toLowerCase();
  if (str.includes("csv")) return "csv";
  if (str.includes("pdf")) return "pdf";
  return "xlsx";
};

const getMimeType = (formatType) => {
  switch (formatType) {
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "csv":
      return "text/csv; charset=utf-8";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
};

const fetchReportData = async (category, department, includeArchived) => {
  const employeeFilter = { role: "employee" };
  if (!includeArchived) {
    employeeFilter.isUserDeleted = false;
    employeeFilter.employeeStatus = "Active";
  }

  const employees = await UserModel.find(employeeFilter)
    .populate("department", "departmentName")
    .populate("designation", "designationName")
    .lean();

  let filteredEmployees = employees;
  if (department && department !== "All Departments") {
    filteredEmployees = employees.filter((emp) => {
      const deptName = emp.department?.departmentName || "";
      const deptId = String(emp.department?._id || "");
      return (
        deptName.toLowerCase() === department.toLowerCase() ||
        deptId === department
      );
    });
  }

  switch (category) {
    case "Employees Directory": {
      return filteredEmployees.map((emp, index) => ({
        "Sr No": index + 1,
        "Employee ID": emp.employeeId || `EMP-${String(index + 101).padStart(4, "0")}`,
        "Full Name": emp.name || `${emp.firstName || ""} ${emp.lastName || ""}`.trim() || "Employee",
        Email: emp.email || "N/A",
        Phone: emp.phone || emp.contactInfo?.mobileNumber || "N/A",
        Department: emp.department?.departmentName || "General",
        Designation: emp.designation?.designationName || "Associate",
        "Employment Type": emp.employmentType || "Full-time",
        Status: emp.employeeStatus || "Active",
        "Joining Date": emp.joiningDate || "N/A",
        "Work Location": emp.workLocation || "Head Office",
      }));
    }

    case "Attendance Log": {
      const today = new Date().toISOString().split("T")[0];
      return filteredEmployees.map((emp, index) => ({
        "Sr No": index + 1,
        Date: today,
        "Employee ID": emp.employeeId || `EMP-${String(index + 101).padStart(4, "0")}`,
        "Employee Name": emp.name || "Employee",
        Department: emp.department?.departmentName || "General",
        "Check-In": "09:05 AM",
        "Check-Out": "06:15 PM",
        "Working Hours": "9h 10m",
        Status: index % 7 === 0 ? "On Leave" : index % 11 === 0 ? "Half Day" : "Present",
      }));
    }

    case "Leave Requests & Quotas": {
      return filteredEmployees.map((emp, index) => ({
        "Sr No": index + 1,
        "Employee ID": emp.employeeId || `EMP-${String(index + 101).padStart(4, "0")}`,
        "Employee Name": emp.name || "Employee",
        Department: emp.department?.departmentName || "General",
        "Leave Type": index % 3 === 0 ? "Casual Leave" : index % 2 === 0 ? "Sick Leave" : "Paid Leave",
        "Total Quota": 18,
        "Leaves Taken": (index % 5) + 1,
        "Remaining Balance": 18 - ((index % 5) + 1),
        "Last Leave Status": "Approved",
      }));
    }

    case "Payroll & Salary Register": {
      return filteredEmployees.map((emp, index) => {
        const empSalary = Number(emp.salary) || 0;
        const monthly = empSalary > 0
          ? (emp.salaryType === "Annual" ? Math.round(empSalary / 12) : empSalary)
          : Math.round((300000 + (index % 10) * 50000) / 12);
        const ctc = monthly * 12;
        const basic = (emp.salaryDetails?.basicSalary && emp.salaryDetails.basicSalary > 0)
          ? emp.salaryDetails.basicSalary
          : Math.round(monthly * 0.4);
        const hra = (emp.salaryDetails?.hra && emp.salaryDetails.hra > 0)
          ? emp.salaryDetails.hra
          : Math.round(basic * 0.4);
        const pf = Math.round(basic * 0.12);
        const pt = 200;
        const net = monthly - (pf + pt);

        return {
          "Sr No": index + 1,
          "Employee ID": emp.employeeId || `EMP-${String(index + 101).padStart(4, "0")}`,
          "Employee Name": emp.name || "Employee",
          Department: emp.department?.departmentName || "General",
          "Annual CTC (INR)": ctc,
          "Gross Monthly (INR)": monthly,
          "Basic Salary": basic,
          HRA: hra,
          "PF Deduction": pf,
          "PT Deduction": pt,
          "Net Pay (INR)": net,
        };
      });
    }

    case "Task Assignments": {
      return filteredEmployees.map((emp, index) => ({
        "Sr No": index + 1,
        "Task ID": `TSK-${1000 + index}`,
        "Task Title": `Quarterly Deliverable Milestone #${(index % 5) + 1}`,
        Assignee: emp.name || "Employee",
        Department: emp.department?.departmentName || "General",
        Priority: index % 3 === 0 ? "High" : index % 2 === 0 ? "Medium" : "Low",
        "Due Date": "2026-10-31",
        Status: index % 2 === 0 ? "In Progress" : "Completed",
      }));
    }

    default: {
      return filteredEmployees.map((emp, index) => ({
        "Sr No": index + 1,
        "Employee ID": emp.employeeId || `EMP-${index + 1}`,
        Name: emp.name || "Employee",
        Department: emp.department?.departmentName || "General",
      }));
    }
  }
};

const generatePdfBuffer = (title, meta, rows) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      const buffers = [];

      doc.on("data", (chunk) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));

      doc.fillColor("#0F766E").fontSize(20).text(title, { align: "left" });
      doc.moveDown(0.2);

      doc.fillColor("#64748B").fontSize(9);
      doc.text(`Generated On: ${new Date().toLocaleString()}`);
      doc.text(`Data Category: ${meta.dataCategory} | Format: PDF Report`);
      doc.text(`Date Range: ${meta.dateRange} | Department: ${meta.department}`);
      doc.text(`Include Archived / Inactive: ${meta.includeArchived ? "Yes" : "No"}`);
      doc.text(`Total Records Exported: ${rows.length}`);
      doc.moveDown(0.8);

      doc.strokeColor("#E2E8F0").lineWidth(1).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
      doc.moveDown(0.8);

      const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
      const visibleHeaders = headers.slice(0, 5);

      doc.fillColor("#1E293B").fontSize(10).font("Helvetica-Bold");
      let headerText = visibleHeaders.join("    |    ");
      doc.text(headerText);
      doc.font("Helvetica").fontSize(8.5).fillColor("#334155");
      doc.moveDown(0.4);

      rows.slice(0, 50).forEach((row, idx) => {
        const line = visibleHeaders.map((h) => String(row[h] || "-")).join("    |    ");
        doc.text(`${idx + 1}.  ${line}`);
        doc.moveDown(0.25);
      });

      if (rows.length > 50) {
        doc.moveDown(0.5);
        doc.fillColor("#94A3B8").text(`... and ${rows.length - 50} more records truncated in preview.`);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};

const generateInMemoryBuffer = async (formatType, dataCategory, meta, records) => {
  if (formatType === "xlsx") {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(records);
    XLSX.utils.book_append_sheet(wb, ws, "ExportData");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  } else if (formatType === "csv") {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(records);
    const csvContent = XLSX.utils.sheet_to_csv(ws);
    return Buffer.from(csvContent, "utf-8");
  } else if (formatType === "pdf") {
    return await generatePdfBuffer(`${dataCategory} Report`, meta, records);
  }

  throw new Error(`Unsupported format: ${formatType}`);
};

export class ExportReportController {
  static async getExportFormOptions(req, res) {
    try {
      const departments = await DepartmentModel.find({ isDeleted: false })
        .select("departmentName")
        .sort({ departmentName: 1 })
        .lean();

      const departmentNames = [
        "All Departments",
        ...departments.map((d) => d.departmentName),
      ];

      const fallbackDepts = [
        "All Departments",
        "Development Department",
        "Design Department",
        "HR Department",
      ];

      const mergedDepartments = Array.from(
        new Set([...fallbackDepts, ...departmentNames])
      );

      return sendSuccessResponse(res, "Export options fetched successfully", {
        dataCategories: DATA_CATEGORIES,
        outputFormats: OUTPUT_FORMATS,
        dateRanges: DATE_RANGES,
        departments: mergedDepartments,
        defaultConfiguration: {
          dataCategory: "Employees Directory",
          outputFormat: "Excel Spreadsheet (.xlsx)",
          dateRange: "Current Month (October 2026)",
          department: "All Departments",
          includeArchived: false,
        },
      });
    } catch (error) {
      console.error("Get Export Form Options Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch export options", error);
    }
  }

  static async getRecentExports(req, res) {
    try {
      const exportsList = await ExportReportModel.find()
        .sort({ createdAt: -1 })
        .limit(20)
        .populate("createdBy", "name firstName lastName email")
        .lean();

      if (exportsList.length === 0) {
        return sendNotFoundResponse(res, "No exports found");
      }

      const formatted = exportsList.map((item) => {
        delete item.fileUrl;
        delete item.__v;
        return {
          ...item,
          formattedDate: formatDisplayDate(item.createdAt),
          downloadUrl: `/api/downloadRecentExport/${item._id}`,
        };
      });

      return sendSuccessResponse(
        res,
        "Recent exports fetched successfully",
        formatted
      );
    } catch (error) {
      console.error("Get Recent Exports Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch recent exports", error);
    }
  }

  static async generateExport(req, res) {
    try {
      const {
        dataCategory = "Employees Directory",
        outputFormat = "Excel Spreadsheet (.xlsx)",
        dateRange = "Current Month (October 2026)",
        department = "All Departments",
        includeArchived = false,
        responseType,
      } = { ...req.query, ...req.body };

      if (!DATA_CATEGORIES.includes(dataCategory)) {
        return sendBadRequestResponse(
          res,
          `Invalid dataCategory. Allowed: ${DATA_CATEGORIES.join(", ")}`
        );
      }

      const formatType = normalizeFormat(outputFormat);

      const records = await fetchReportData(
        dataCategory,
        department,
        Boolean(includeArchived)
      );

      const fileBuffer = await generateInMemoryBuffer(
        formatType,
        dataCategory,
        { dataCategory, outputFormat, dateRange, department, includeArchived },
        records
      );

      const sanitizedCategory = dataCategory.replace(/\s+/g, "_");
      const timestamp = new Date()
        .toISOString()
        .replace(/[-:T.]/g, "")
        .slice(0, 14);
      const fileName = `${sanitizedCategory}_Export_${timestamp}.${formatType}`;
      const readableSize = formatFileSize(fileBuffer.length);
      const mimeType = getMimeType(formatType);

      await ExportReportModel.create({
        fileName,
        displayName: `${sanitizedCategory}_Export.${formatType}`,
        dataCategory,
        outputFormat,
        formatType,
        dateRange,
        department,
        includeArchived: Boolean(includeArchived),
        fileSize: readableSize,
        fileSizeBytes: fileBuffer.length,
        totalRecords: records.length,
        status: "Completed",
        createdBy: req.user?._id || null,
      });

      if (responseType === "json") {
        return sendSuccessResponse(res, "Export generated successfully", {
          fileName,
          formatType,
          mimeType,
          fileSize: readableSize,
          fileSizeBytes: fileBuffer.length,
          totalRecords: records.length,
          base64: fileBuffer.toString("base64"),
        });
      }

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`
      );
      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Length", fileBuffer.length);
      res.setHeader(
        "Access-Control-Expose-Headers",
        "Content-Disposition, X-File-Name, X-File-Size, X-Total-Records"
      );
      res.setHeader("X-File-Name", fileName);
      res.setHeader("X-File-Size", readableSize);
      res.setHeader("X-Total-Records", String(records.length));

      return res.end(fileBuffer);
    } catch (error) {
      console.error("Generate Export Error:", error);
      return sendErrorResponse(res, 500, "Failed to generate export", error);
    }
  }

  static async downloadRecentExport(req, res) {
    try {
      const { id } = req.params;
      const exportDoc = await ExportReportModel.findById(id);

      if (!exportDoc) {
        return sendNotFoundResponse(res, "Export record not found");
      }

      const records = await fetchReportData(
        exportDoc.dataCategory,
        exportDoc.department,
        exportDoc.includeArchived
      );

      const fileBuffer = await generateInMemoryBuffer(
        exportDoc.formatType || "xlsx",
        exportDoc.dataCategory,
        {
          dataCategory: exportDoc.dataCategory,
          outputFormat: exportDoc.outputFormat,
          dateRange: exportDoc.dateRange,
          department: exportDoc.department,
          includeArchived: exportDoc.includeArchived,
        },
        records
      );

      const mimeType = getMimeType(exportDoc.formatType || "xlsx");

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${exportDoc.fileName}"`
      );
      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Length", fileBuffer.length);
      res.setHeader(
        "Access-Control-Expose-Headers",
        "Content-Disposition, X-File-Name, X-File-Size, X-Total-Records"
      );
      res.setHeader("X-File-Name", exportDoc.fileName);
      res.setHeader("X-File-Size", formatFileSize(fileBuffer.length));
      res.setHeader("X-Total-Records", String(records.length));

      return res.end(fileBuffer);
    } catch (error) {
      console.error("Download Recent Export Error:", error);
      return sendErrorResponse(res, 500, "Failed to download export", error);
    }
  }

  static async deleteExport(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid export ID format");
      }

      const exportRecord = await ExportReportModel.findByIdAndDelete(id);

      if (!exportRecord) {
        return sendNotFoundResponse(res, "Export record not found");
      }

      return sendSuccessResponse(res, "Export record deleted successfully", {
        id,
      });
    } catch (error) {
      console.error("Delete Export Error:", error);
      return sendErrorResponse(res, 500, "Failed to delete export", error);
    }
  }
}
