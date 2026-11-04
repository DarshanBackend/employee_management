import mongoose from "mongoose";
import DocumentTemplateModel, {
  TEMPLATE_CATEGORIES,
  TEMPLATE_STATUSES,
  SMART_VARIABLES,
} from "../model/documentTemplate.model.js";
import UserModel from "../model/user.model.js";
import DepartmentModel from "../model/department.model.js";
import DesignationModel from "../model/designation.model.js";
import OrganizationModel from "../model/organization.model.js";
import BranchModel from "../model/branch.model.js";
import DocumentModel from "../model/document.model.js";
import { uploadFile, deleteFileFromS3 } from "../middleware/imageupload.js";
import {
  sendSuccessResponse,
  sendCreatedResponse,
  sendErrorResponse,
  sendBadRequestResponse,
  sendNotFoundResponse,
} from "../utils/Response.utils.js";
import { recordAuditLog } from "../utils/auditLogger.js";

const safeAuditLog = async (req, action, description) => {
  try {
    if (typeof recordAuditLog === "function") {
      await recordAuditLog(req, {
        action,
        category: "Documents",
        description,
        targetResource: "DocumentTemplate",
      });
    }
  } catch (e) {
    // Non-blocking
  }
};

const CATEGORY_COLORS = {
  Recruitment: "#10B981",
  "Exit Management": "#6366F1",
  "Legal & Compliance": "#8B5CF6",
  Verification: "#10B981",
  "HR Operations": "#F59E0B",
  General: "#6B7280",
};

const CATEGORY_ICONS = {
  Recruitment: "mail",
  "Exit Management": "award",
  "Legal & Compliance": "shield",
  Verification: "check-circle",
  "HR Operations": "briefcase",
  General: "file-text",
};

/**
 * Quick Start Presets (matching Screenshot 2, 3, 4)
 */
export const QUICK_START_PRESETS = [
  {
    presetKey: "probation_confirmation",
    presetName: "Probation Confirmation",
    templateTitle: "Probation Confirmation Letter",
    version: "v1.0 (2026)",
    category: "Recruitment",
    icon: "mail",
    badgeColor: "#10B981",
    description: "Formal confirmation and evaluation completion letter for newly hired employees.",
    bodyContent: `CONFIRMATION OF PERMANENT EMPLOYMENT

Date: {CURRENT_DATE}

Dear {EMPLOYEE_NAME},

Employee ID: {EMPLOYEE_ID}
Designation: {DESIGNATION}
Department: {DEPARTMENT}

We are pleased to inform you that you have successfully completed your probation period with {COMPANY_NAME}. Based on your performance appraisal and positive evaluations, management is delighted to confirm your appointment as a permanent employee effective immediately.

Key Employment Details:
- Date of Joining: {JOINING_DATE}
- Designation: {DESIGNATION}
- Department: {DEPARTMENT}
- Annual CTC: {SALARY_CTC}
- Monthly Gross: {SALARY_MONTHLY}
- Work Location: {WORK_LOCATION}
- Reporting Manager: {REPORTING_MANAGER}

All other terms and conditions detailed in your original appointment letter will continue to remain in force. We appreciate your dedication and look forward to your continuing growth and success with {COMPANY_NAME}.

Warm Regards,

Human Resources Department
{COMPANY_NAME}`,
  },
  {
    presetKey: "promotion_increment",
    presetName: "Promotion & Increment",
    templateTitle: "Promotion & Salary Revision Letter",
    version: "v1.5 (2026)",
    category: "Verification",
    icon: "trending-up",
    badgeColor: "#10B981",
    description: "Official promotion endorsement letter with revised grade, designation, and compensation.",
    bodyContent: `PROMOTION & COMPENSATION REVISION

Date: {CURRENT_DATE}

To,
{EMPLOYEE_NAME} (ID: {EMPLOYEE_ID})
Department: {DEPARTMENT}

Dear {EMPLOYEE_NAME},

In recognition of your exceptional dedication, technical leadership, and exemplary contributions to {COMPANY_NAME}, we are thrilled to officially promote you to the position of {DESIGNATION}.

Revision Summary:
- Effective Date: {CURRENT_DATE}
- New Designation: {DESIGNATION}
- Department: {DEPARTMENT}
- Revised Annual Package (CTC): {SALARY_CTC}
- Revised Monthly Gross: {SALARY_MONTHLY}
- Reporting Manager: {REPORTING_MANAGER}
- Workplace: {WORK_LOCATION}

Your commitment to excellence has been instrumental in driving our team's milestones. We congratulate you on this well-deserved achievement and trust you will continue to inspire those around you.

Congratulations and Best Wishes!

Authorized Signatory,
Human Resources & Executive Management
{COMPANY_NAME}`,
  },
  {
    presetKey: "internship_certificate",
    presetName: "Internship Certificate",
    templateTitle: "Internship Completion Certificate",
    version: "v1.0 (2026)",
    category: "HR Operations",
    icon: "award",
    badgeColor: "#F59E0B",
    description: "Official internship tenure and performance completion certificate.",
    bodyContent: `INTERNSHIP COMPLETION CERTIFICATE

Date: {CURRENT_DATE}

TO WHOM IT MAY CONCERN

This is to certify that {EMPLOYEE_NAME} (Intern ID: {EMPLOYEE_ID}) has successfully completed an internship program with {COMPANY_NAME} in the {DEPARTMENT} department as a {DESIGNATION}.

Program Duration: From {JOINING_DATE} to {CURRENT_DATE}
Work Location: {WORK_LOCATION}
Supervisor / Mentor: {REPORTING_MANAGER}

During the tenure of the internship, {EMPLOYEE_NAME} demonstrated outstanding sincerity, discipline, and technical acumen. Their contributions to ongoing project deliverables were commendable and met all professional standards.

We commend their work and wish them the very best in all future academic and professional endeavors.

For {COMPANY_NAME},

Human Resources & Talent Acquisition`,
  },
  {
    presetKey: "disciplinary_advisory",
    presetName: "Disciplinary Advisory",
    templateTitle: "Disciplinary Advisory Notice",
    version: "v1.0 (2026)",
    category: "HR Operations",
    icon: "alert-triangle",
    badgeColor: "#EF4444",
    description: "Formal advisory memo regarding company policy or workplace conduct.",
    bodyContent: `CONFIDENTIAL - DISCIPLINARY ADVISORY MEMORANDUM

Date: {CURRENT_DATE}

To: {EMPLOYEE_NAME}
Employee ID: {EMPLOYEE_ID}
Designation: {DESIGNATION}
Department: {DEPARTMENT}
Reporting Manager: {REPORTING_MANAGER}

Dear {EMPLOYEE_NAME},

This memorandum serves as a formal advisory regarding adherence to {COMPANY_NAME} company policies, attendance guidelines, and workplace professional standards.

Management has observed deviations from expected performance and protocol standards at our {WORK_LOCATION} office. We believe in providing constructive opportunities for improvement.

You are requested to attend a formal counseling session with your Reporting Manager ({REPORTING_MANAGER}) and Human Resources within 3 business days of receiving this notice to agree on an actionable performance improvement plan.

Issued by:
People & Culture Operations
{COMPANY_NAME}`,
  },
];

/**
 * Format Template Item for API responses
 */
const formatTemplateItem = (t) => {
  const body = t.bodyContent || "";
  const variablesUsed = SMART_VARIABLES.filter((v) => body.includes(v.key)).map(
    (v) => v.key
  );

  return {
    _id: t._id,
    templateTitle: t.templateTitle,
    category: t.category,
    version: t.version,
    description: t.description || "",
    bodyContent: t.bodyContent,
    icon: t.icon || CATEGORY_ICONS[t.category] || "file-text",
    badgeColor: t.badgeColor || CATEGORY_COLORS[t.category] || "#10B981",
    attachmentUrl: t.attachmentUrl,
    attachmentName: t.attachmentName,
    attachmentSize: t.attachmentSize,
    status: t.status || "Active",
    variablesCount: variablesUsed.length,
    variablesUsed,
    createdBy: t.createdBy,
    updatedBy: t.updatedBy,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
};

/**
 * Replace smart variables in template body with actual values
 */
const replaceVariables = (content, values) => {
  if (!content) return "";
  let rendered = content;
  for (const [key, val] of Object.entries(values)) {
    const escapedKey = key.replace(/[{}]/g, "\\$&");
    const regex = new RegExp(escapedKey, "g");
    rendered = rendered.replace(regex, val !== undefined && val !== null ? String(val) : "");
  }
  return rendered;
};

/**
 * Extract actual values from an employee document dynamically from database
 */
const getEmployeeVariableValues = async (employeeId = null, fallbackUserId = null) => {
  let emp = null;

  // 1. If explicit employeeId provided, find by employeeId
  if (employeeId && mongoose.Types.ObjectId.isValid(employeeId)) {
    emp = await UserModel.findOne({ _id: employeeId, isUserDeleted: { $ne: true } })
      .populate({
        path: "department",
        select: "departmentName departmentHead",
        populate: { path: "departmentHead", select: "name firstName lastName" },
      })
      .populate("designation", "designationName designationTitle");
  }

  // 2. If not found or not provided, try fallback user (e.g. authenticated user)
  if (!emp && fallbackUserId && mongoose.Types.ObjectId.isValid(fallbackUserId)) {
    emp = await UserModel.findOne({ _id: fallbackUserId, isUserDeleted: { $ne: true } })
      .populate({
        path: "department",
        select: "departmentName departmentHead",
        populate: { path: "departmentHead", select: "name firstName lastName" },
      })
      .populate("designation", "designationName designationTitle");
  }

  // 3. If still not found, dynamically find any active employee from database
  if (!emp) {
    emp = await UserModel.findOne({ isUserDeleted: { $ne: true }, role: "employee" })
      .sort({ createdAt: -1 })
      .populate({
        path: "department",
        select: "departmentName departmentHead",
        populate: { path: "departmentHead", select: "name firstName lastName" },
      })
      .populate("designation", "designationName designationTitle");
  }

  // 4. Fallback to any active user in database
  if (!emp) {
    emp = await UserModel.findOne({ isUserDeleted: { $ne: true } })
      .sort({ createdAt: -1 })
      .populate({
        path: "department",
        select: "departmentName departmentHead",
        populate: { path: "departmentHead", select: "name firstName lastName" },
      })
      .populate("designation", "designationName designationTitle");
  }

  // Dynamic organization details
  const org = await OrganizationModel.findOne().sort({ createdAt: -1 });
  const companyName = org?.companyLegalName || org?.companyName || "";

  // Dynamic branch / location details
  const hqBranch =
    (await BranchModel.findOne({ isHeadquarters: true, isDeleted: false })) ||
    (await BranchModel.findOne({ isDeleted: false }));

  const currentDateStr = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const empName = emp?.name?.trim() || `${emp?.firstName || ""} ${emp?.lastName || ""}`.trim() || "";
  const empCode = emp?.employeeId?.trim() || (emp?._id ? `EMP-${String(emp._id).slice(-4).toUpperCase()}` : "");
  const designationTitle =
    emp?.designation?.designationName?.trim() ||
    emp?.designation?.designationTitle?.trim() ||
    emp?.roleTitle?.trim() ||
    "";
  const departmentName = emp?.department?.departmentName?.trim() || "";

  let joiningDateStr = "";
  if (emp?.joiningDate) {
    const parsedDate = new Date(emp.joiningDate);
    if (!isNaN(parsedDate.getTime())) {
      joiningDateStr = parsedDate.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } else {
      joiningDateStr = String(emp.joiningDate).trim();
    }
  }

  const monthlySalary = Number(emp?.salary ?? emp?.salaryDetails?.basicSalary ?? 0);
  const annualCtc = monthlySalary > 0 ? monthlySalary * 12 : 0;
  const formattedMonthly = monthlySalary > 0 ? `₹ ${monthlySalary.toLocaleString("en-IN")}` : "";
  const formattedCtc = annualCtc > 0 ? `₹ ${annualCtc.toLocaleString("en-IN")}` : "";

  // Dynamic reporting manager resolution
  let reportingManagerName = "";
  if (emp?.reportingManager) {
    const trimmedMgr = String(emp.reportingManager).trim();
    if (mongoose.Types.ObjectId.isValid(trimmedMgr)) {
      const mgrUser = await UserModel.findById(trimmedMgr).select("name firstName lastName");
      if (mgrUser) {
        reportingManagerName = mgrUser.name?.trim() || `${mgrUser.firstName || ""} ${mgrUser.lastName || ""}`.trim();
      }
    }
    if (!reportingManagerName) {
      reportingManagerName = trimmedMgr;
    }
  }
  if (!reportingManagerName && emp?.department?.departmentHead) {
    const deptHead = emp.department.departmentHead;
    reportingManagerName =
      deptHead?.name?.trim() || `${deptHead?.firstName || ""} ${deptHead?.lastName || ""}`.trim() || "";
  }

  // Dynamic work location resolution
  const workLocation = emp?.workLocation?.trim() || hqBranch?.branchName?.trim() || hqBranch?.address?.trim() || "";

  return {
    "{EMPLOYEE_NAME}": empName,
    "{EMPLOYEE_ID}": empCode,
    "{DESIGNATION}": designationTitle,
    "{DEPARTMENT}": departmentName,
    "{JOINING_DATE}": joiningDateStr,
    "{SALARY_CTC}": formattedCtc,
    "{SALARY_MONTHLY}": formattedMonthly,
    "{REPORTING_MANAGER}": reportingManagerName,
    "{WORK_LOCATION}": workLocation,
    "{CURRENT_DATE}": currentDateStr,
    "{COMPANY_NAME}": companyName,
  };
};

export class DocumentTemplateController {
  /**
   * GET /api/documentTemplates/presets or /api/getDocumentTemplatePresets
   * Returns quick-start preset templates (Screenshot 2, 3, 4)
   */
  static async getPresets(req, res) {
    try {
      return sendSuccessResponse(res, "Document template presets fetched successfully", {
        totalPresets: QUICK_START_PRESETS.length,
        presets: QUICK_START_PRESETS,
      });
    } catch (error) {
      console.error("Get Template Presets Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch template presets", error);
    }
  }

  /**
   * GET /api/documentTemplates/variables or /api/getDocumentTemplateVariables
   * Returns available smart variables
   */
  static async getSmartVariables(req, res) {
    try {
      return sendSuccessResponse(res, "Smart variables fetched successfully", {
        totalVariables: SMART_VARIABLES.length,
        variables: SMART_VARIABLES,
      });
    } catch (error) {
      console.error("Get Smart Variables Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch smart variables", error);
    }
  }

  /**
   * GET /api/documentTemplates/getAll or /api/getAllDocumentTemplates
   * Returns list with tab counts (All, Recruitment, Exit, Legal, Verification)
   * Only returns templates added by user/admin (no auto-seeded templates)
   */
  static async getAllTemplates(req, res) {
    try {
      const { category, search, status, page, limit } = req.query;

      const filter = {};

      if (category && category.trim()) {
        const catClean = category.trim().toLowerCase();
        if (catClean !== "all") {
          // Flexible category matching for short names like "exit" or "legal"
          if (catClean === "exit" || catClean.includes("exit")) {
            filter.category = "Exit Management";
          } else if (catClean === "legal" || catClean.includes("legal")) {
            filter.category = "Legal & Compliance";
          } else if (catClean.includes("recruit")) {
            filter.category = "Recruitment";
          } else if (catClean.includes("verif")) {
            filter.category = "Verification";
          } else if (catClean.includes("hr") || catClean.includes("operation")) {
            filter.category = "HR Operations";
          } else {
            filter.category = new RegExp(`^${category.trim()}$`, "i");
          }
        }
      }

      if (status && TEMPLATE_STATUSES.includes(status)) {
        filter.status = status;
      }

      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        filter.$or = [
          { templateTitle: regex },
          { description: regex },
          { category: regex },
          { bodyContent: regex },
        ];
      }

      let query = DocumentTemplateModel.find(filter)
        .populate("createdBy", "name firstName lastName email")
        .sort({ createdAt: -1 });

      const totalMatched = await DocumentTemplateModel.countDocuments(filter);

      if (page && limit) {
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const skip = (pageNum - 1) * limitNum;
        query = query.skip(skip).limit(limitNum);
      }

      const templates = await query;

      // Category Summary Counts for UI Badges (Screenshot 1)
      const baseFilter = {};
      const [allCount, recruitmentCount, exitCount, legalCount, verificationCount, hrOpsCount, generalCount] =
        await Promise.all([
          DocumentTemplateModel.countDocuments(baseFilter),
          DocumentTemplateModel.countDocuments({ ...baseFilter, category: "Recruitment" }),
          DocumentTemplateModel.countDocuments({ ...baseFilter, category: "Exit Management" }),
          DocumentTemplateModel.countDocuments({ ...baseFilter, category: "Legal & Compliance" }),
          DocumentTemplateModel.countDocuments({ ...baseFilter, category: "Verification" }),
          DocumentTemplateModel.countDocuments({ ...baseFilter, category: "HR Operations" }),
          DocumentTemplateModel.countDocuments({ ...baseFilter, category: "General" }),
        ]);

      return sendSuccessResponse(res, "Document templates fetched successfully", {
        summary: {
          all: allCount,
          recruitment: recruitmentCount,
          exit: exitCount,
          exitManagement: exitCount,
          legal: legalCount,
          legalCompliance: legalCount,
          verification: verificationCount,
          hrOperations: hrOpsCount,
          general: generalCount,
        },
        tabs: [
          { label: "All", key: "all", count: allCount },
          { label: "Recruitment", key: "Recruitment", count: recruitmentCount },
          { label: "Exit Management", key: "Exit Management", count: exitCount },
          { label: "Legal & Compliance", key: "Legal & Compliance", count: legalCount },
          { label: "Verification", key: "Verification", count: verificationCount },
          { label: "HR Operations", key: "HR Operations", count: hrOpsCount },
          { label: "General", key: "General", count: generalCount },
        ],
        total: totalMatched,
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : totalMatched,
        totalPages: limit ? Math.ceil(totalMatched / parseInt(limit, 10)) : 1,
        templates: templates.map(formatTemplateItem),
      });
    } catch (error) {
      console.error("Get All Templates Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch document templates", error);
    }
  }

  /**
   * GET /api/documentTemplates/getById/:id or /api/getDocumentTemplateById/:id
   */
  static async getTemplateById(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid document template ID");
      }

      const template = await DocumentTemplateModel.findById(id).populate(
        "createdBy",
        "name firstName lastName email"
      );

      if (!template) {
        return sendNotFoundResponse(res, "Document template not found");
      }

      return sendSuccessResponse(
        res,
        "Document template details fetched successfully",
        formatTemplateItem(template)
      );
    } catch (error) {
      console.error("Get Template By ID Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch document template", error);
    }
  }

  /**
   * POST /api/documentTemplates/create or /api/createDocumentTemplate
   * Create a new document template (Screenshot 2)
   */
  static async createTemplate(req, res) {
    try {
      const {
        templateTitle,
        category = "Recruitment",
        version = "v1.0 (2026)",
        description = "",
        bodyContent,
        icon,
        badgeColor,
        status = "Active",
      } = req.body;

      if (!templateTitle || !templateTitle.trim()) {
        return sendBadRequestResponse(res, "Template title is required!");
      }

      if (!bodyContent || !bodyContent.trim()) {
        return sendBadRequestResponse(res, "Template body content is required!");
      }

      const cleanCategory = TEMPLATE_CATEGORIES.includes(category)
        ? category
        : "Recruitment";

      let attachmentUrl = null;
      let attachmentName = null;
      let attachmentKey = null;
      let attachmentSize = 0;

      // Handle optional uploaded reference file (PDF / DOCX)
      if (req.file) {
        try {
          const uploadResult = await uploadFile(req.file);
          attachmentUrl = uploadResult.url;
          attachmentKey = uploadResult.key;
          attachmentName = req.file.originalname;
          attachmentSize = req.file.size;
        } catch (uploadErr) {
          console.warn("Attachment upload to S3 failed, proceeding without file:", uploadErr.message);
        }
      }

      const finalBadgeColor = badgeColor || CATEGORY_COLORS[cleanCategory] || "#10B981";
      const finalIcon = icon || CATEGORY_ICONS[cleanCategory] || "file-text";

      const newTemplate = await DocumentTemplateModel.create({
        templateTitle: templateTitle.trim(),
        category: cleanCategory,
        version: version.trim() || "v1.0 (2026)",
        description: description ? description.trim() : "",
        bodyContent: bodyContent.trim(),
        icon: finalIcon,
        badgeColor: finalBadgeColor,
        attachmentUrl,
        attachmentName,
        attachmentKey,
        attachmentSize,
        status: TEMPLATE_STATUSES.includes(status) ? status : "Active",
        createdBy: req.user?._id || null,
      });

      await safeAuditLog(
        req,
        "CREATE_DOCUMENT_TEMPLATE",
        `Created template '${newTemplate.templateTitle}' (${newTemplate.category})`
      );

      return sendCreatedResponse(
        res,
        "Document template created successfully!",
        formatTemplateItem(newTemplate)
      );
    } catch (error) {
      console.error("Create Template Error:", error);
      return sendErrorResponse(res, 500, "Failed to create document template", error);
    }
  }

  /**
   * PATCH /api/documentTemplates/update/:id or /api/updateDocumentTemplate/:id
   */
  static async updateTemplate(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid document template ID");
      }

      const template = await DocumentTemplateModel.findById(id);

      if (!template) {
        return sendNotFoundResponse(res, "Document template not found");
      }

      const {
        templateTitle,
        category,
        version,
        description,
        bodyContent,
        icon,
        badgeColor,
        status,
      } = req.body;

      if (templateTitle && templateTitle.trim()) {
        template.templateTitle = templateTitle.trim();
      }

      if (category && TEMPLATE_CATEGORIES.includes(category)) {
        template.category = category;
        if (!badgeColor) {
          template.badgeColor = CATEGORY_COLORS[category] || template.badgeColor;
        }
        if (!icon) {
          template.icon = CATEGORY_ICONS[category] || template.icon;
        }
      }

      if (version !== undefined) {
        template.version = version ? version.trim() : template.version;
      }

      if (description !== undefined) {
        template.description = description ? description.trim() : "";
      }

      if (bodyContent && bodyContent.trim()) {
        template.bodyContent = bodyContent.trim();
      }

      if (icon && icon.trim()) {
        template.icon = icon.trim();
      }

      if (badgeColor && badgeColor.trim()) {
        template.badgeColor = badgeColor.trim();
      }

      if (status && TEMPLATE_STATUSES.includes(status)) {
        template.status = status;
      }

      // Handle replacement file attachment if uploaded
      if (req.file) {
        try {
          if (template.attachmentKey) {
            await deleteFileFromS3(template.attachmentKey).catch(() => { });
          }
          const uploadResult = await uploadFile(req.file);
          template.attachmentUrl = uploadResult.url;
          template.attachmentKey = uploadResult.key;
          template.attachmentName = req.file.originalname;
          template.attachmentSize = req.file.size;
        } catch (uploadErr) {
          console.warn("Attachment update upload failed:", uploadErr.message);
        }
      }

      template.updatedBy = req.user?._id || null;
      await template.save();

      await safeAuditLog(
        req,
        "UPDATE_DOCUMENT_TEMPLATE",
        `Updated template '${template.templateTitle}'`
      );

      return sendSuccessResponse(
        res,
        "Document template updated successfully!",
        formatTemplateItem(template)
      );
    } catch (error) {
      console.error("Update Template Error:", error);
      return sendErrorResponse(res, 500, "Failed to update document template", error);
    }
  }

  /**
   * DELETE /api/documentTemplates/delete/:id or /api/deleteDocumentTemplate/:id
   */
  static async deleteTemplate(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid document template ID");
      }

      const template = await DocumentTemplateModel.findById(id);

      if (!template) {
        return sendNotFoundResponse(res, "Document template not found");
      }

      // 1. Collect and delete all associated AWS S3 assets (attachments, uploaded icon, embedded body images)
      const s3Targets = [];

      if (template.attachmentKey) {
        s3Targets.push(template.attachmentKey);
      }
      if (template.attachmentUrl && !s3Targets.includes(template.attachmentUrl)) {
        s3Targets.push(template.attachmentUrl);
      }

      // Check if icon is an uploaded S3 image/path
      if (
        template.icon &&
        (template.icon.includes(".amazonaws.com") || template.icon.startsWith("uploads/"))
      ) {
        s3Targets.push(template.icon);
      }

      // Check if bodyContent has any S3 image URLs
      if (template.bodyContent && typeof template.bodyContent === "string") {
        const s3Regex = /https:\/\/[a-zA-Z0-9.\-_]+\.amazonaws\.com\/[^\s"'>]+/gi;
        const matchedUrls = template.bodyContent.match(s3Regex);
        if (matchedUrls && matchedUrls.length > 0) {
          s3Targets.push(...matchedUrls);
        }
      }

      const uniqueS3Targets = [...new Set(s3Targets.filter(Boolean))];
      if (uniqueS3Targets.length > 0) {
        await Promise.allSettled(
          uniqueS3Targets.map(async (target) => {
            try {
              await deleteFileFromS3(target);
            } catch (s3Err) {
              console.error(`Error deleting asset ${target} from S3:`, s3Err.message);
            }
          })
        );
      }

      // 2. Permanently delete from MongoDB Database (Hard delete - completely removed from DB)
      await DocumentTemplateModel.findByIdAndDelete(id);

      // 3. Audit log
      await safeAuditLog(
        req,
        "DELETE_DOCUMENT_TEMPLATE",
        `Permanently deleted template '${template.templateTitle}' from database and AWS S3`
      );

      return sendSuccessResponse(res, "Document template permanently deleted from database and AWS S3 successfully!", {
        _id: template._id,
        templateTitle: template.templateTitle,
        category: template.category,
        deletedFromDatabase: true,
        deletedFromS3: uniqueS3Targets.length > 0,
        s3AssetsDeletedCount: uniqueS3Targets.length,
      });
    } catch (error) {
      console.error("Delete Template Error:", error);
      return sendErrorResponse(res, 500, "Failed to delete document template", error);
    }
  }

  /**
   * POST /api/documentTemplates/preview/:id or /api/previewDocumentTemplate/:id
   * Preview template with live smart variable replacement
   */
  static async previewTemplate(req, res) {
    try {
      const { id } = req.params;
      const { employeeId } = req.body;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid document template ID");
      }

      const template = await DocumentTemplateModel.findOne({
        _id: id,
        isDeleted: false,
      });

      if (!template) {
        return sendNotFoundResponse(res, "Document template not found");
      }

      const variableValues = await getEmployeeVariableValues(employeeId, req.user?._id);
      const renderedBody = replaceVariables(template.bodyContent, variableValues);

      return sendSuccessResponse(res, "Template preview generated successfully", {
        templateId: template._id,
        templateTitle: template.templateTitle,
        category: template.category,
        version: template.version,
        isUsingSampleData: !employeeId,
        replacedVariables: variableValues,
        originalBody: template.bodyContent,
        renderedBody,
      });
    } catch (error) {
      console.error("Preview Template Error:", error);
      return sendErrorResponse(res, 500, "Failed to preview template", error);
    }
  }

  /**
   * POST /api/documentTemplates/generate/:id or /api/generateDocumentTemplate/:id
   * Generate official letter for employee with all smart variables replaced
   */
  static async generateDocument(req, res) {
    try {
      const { id } = req.params;
      const { employeeId, saveToEmployeeDocs = true } = req.body;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid document template ID");
      }

      if (!employeeId || !mongoose.Types.ObjectId.isValid(employeeId)) {
        return sendBadRequestResponse(res, "Valid employee ID is required to generate document!");
      }

      const template = await DocumentTemplateModel.findOne({
        _id: id,
        isDeleted: false,
      });

      if (!template) {
        return sendNotFoundResponse(res, "Document template not found");
      }

      const emp = await UserModel.findById(employeeId);
      if (!emp) {
        return sendNotFoundResponse(res, "Employee not found");
      }

      const variableValues = await getEmployeeVariableValues(employeeId, req.user?._id);
      const renderedBody = replaceVariables(template.bodyContent, variableValues);

      const generatedTitle = `${template.templateTitle} - ${variableValues["{EMPLOYEE_NAME}"]}`;

      let createdDocRecord = null;
      if (saveToEmployeeDocs) {
        try {
          const docCategoryMap = {
            Recruitment: "Contracts",
            "Exit Management": "Certificates",
            "Legal & Compliance": "Contracts",
            Verification: "Certificates",
            "HR Operations": "Contracts",
            General: "Contracts",
          };

          createdDocRecord = await DocumentModel.create({
            documentTitle: generatedTitle,
            documentCategory: docCategoryMap[template.category] || "Contracts",
            employee: employeeId,
            fileName: `${template.templateTitle.replace(/\s+/g, "_")}.txt`,
            fileUrl: "generated://content",
            fileKey: "",
            fileSize: Buffer.byteLength(renderedBody, "utf8"),
            formattedSize: "1 KB",
            fileType: "txt",
            mimeType: "text/plain",
            verificationStatus: "Verified",
            uploadedBy: req.user?._id || employeeId,
            remarks: `Auto-generated using template '${template.templateTitle}' (${template.version})`,
          });
        } catch (docErr) {
          console.warn("Could not save to DocumentModel:", docErr.message);
        }
      }

      await safeAuditLog(
        req,
        "GENERATE_DOCUMENT",
        `Generated '${template.templateTitle}' for employee ${variableValues["{EMPLOYEE_NAME}"]}`
      );

      return sendSuccessResponse(res, "Official document generated successfully!", {
        templateId: template._id,
        templateTitle: template.templateTitle,
        category: template.category,
        version: template.version,
        employee: {
          _id: emp._id,
          name: variableValues["{EMPLOYEE_NAME}"],
          employeeId: variableValues["{EMPLOYEE_ID}"],
          designation: variableValues["{DESIGNATION}"],
          department: variableValues["{DEPARTMENT}"],
        },
        generatedTitle,
        generatedContent: renderedBody,
        issuedDocumentId: createdDocRecord?._id || null,
        generatedAt: new Date(),
      });
    } catch (error) {
      console.error("Generate Document Error:", error);
      return sendErrorResponse(res, 500, "Failed to generate document", error);
    }
  }
}