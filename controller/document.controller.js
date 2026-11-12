import mongoose from "mongoose";
import DocumentModel, {
  DOCUMENT_CATEGORIES,
  VERIFICATION_STATUSES,
} from "../model/document.model.js";
import UserModel from "../model/user.model.js";
import { uploadFile, deleteFileFromS3 } from "../middleware/imageupload.js";
import {
  sendSuccessResponse,
  sendCreatedResponse,
  sendErrorResponse,
  sendBadRequestResponse,
  sendNotFoundResponse,
} from "../utils/Response.utils.js";
import { recordAuditLog } from "../utils/auditLogger.js";
import path from "path";
import fs from "fs";

const formatBytes = (bytes, decimals = 1) => {
  if (!bytes || bytes === 0) return "0 KB";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
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

const getCategoryBadgeColor = (category) => {
  switch (category) {
    case "Identity Proof":
    case "Identity":
      return "#10B981";
    case "Employment":
    case "Contracts":
      return "#3B82F6";
    case "Education":
      return "#6366F1";
    case "Certifications":
    case "Certificates":
      return "#F59E0B";
    case "Tax & Compliance":
      return "#8B5CF6";
    default:
      return "#10B981";
  }
};

const getCategoryIcon = (category, title = "") => {
  const lower = String(title).toLowerCase();
  if (lower.includes("degree") || lower.includes("bachelor") || lower.includes("master")) {
    return "graduation-cap";
  }
  if (lower.includes("relieving") || lower.includes("certificate") || lower.includes("experience")) {
    return "certificate";
  }
  if (lower.includes("pan")) {
    return "credit-card";
  }
  if (lower.includes("aadhaar") || lower.includes("aadhar") || lower.includes("passport") || lower.includes("id")) {
    return "id-card";
  }
  if (lower.includes("contract") || lower.includes("offer") || lower.includes("agreement")) {
    return "file-contract";
  }
  if (lower.includes("tax") || lower.includes("form 16")) {
    return "receipt";
  }

  switch (category) {
    case "Identity Proof":
    case "Identity":
      return "id-card";
    case "Employment":
    case "Contracts":
      return "file-contract";
    case "Education":
      return "graduation-cap";
    case "Certifications":
    case "Certificates":
      return "award";
    case "Tax & Compliance":
      return "receipt";
    default:
      return "file-text";
  }
};

export class DocumentController {
  static async getAllDocuments(req, res) {
    try {
      const {
        category = "All",
        status = "All",
        search = "",
        employeeId = "",
        sortBy = "createdAt",
        sortOrder = "desc",
        page = 1,
        limit = 50,
      } = { ...req.query, ...req.body };

      const baseFilter = {};
      if (req.user && req.user.role === "employee") {
        baseFilter.employee = req.user._id;
      }

      const [
        totalAllCount,
        identityCount,
        employmentCount,
        educationCount,
        certificationsCount,
      ] = await Promise.all([
        DocumentModel.countDocuments(baseFilter),
        DocumentModel.countDocuments({
          ...baseFilter,
          documentCategory: { $in: ["Identity Proof", "Identity"] },
        }),
        DocumentModel.countDocuments({
          ...baseFilter,
          documentCategory: { $in: ["Employment", "Contracts"] },
        }),
        DocumentModel.countDocuments({
          ...baseFilter,
          documentCategory: { $in: ["Education"] },
        }),
        DocumentModel.countDocuments({
          ...baseFilter,
          documentCategory: { $in: ["Certifications", "Certificates"] },
        }),
      ]);

      const filter = { ...baseFilter };

      if (category && String(category).toLowerCase() !== "all") {
        const catLower = String(category).trim().toLowerCase();
        if (catLower.includes("ident")) {
          filter.documentCategory = { $in: ["Identity Proof", "Identity"] };
        } else if (catLower.includes("employ") || catLower.includes("contract")) {
          filter.documentCategory = { $in: ["Employment", "Contracts"] };
        } else if (catLower.includes("educat") || catLower.includes("degree")) {
          filter.documentCategory = { $in: ["Education"] };
        } else if (catLower.includes("certif")) {
          filter.documentCategory = { $in: ["Certifications", "Certificates"] };
        } else if (catLower.includes("tax")) {
          filter.documentCategory = { $in: ["Tax & Compliance"] };
        } else {
          filter.documentCategory = category.trim();
        }
      }

      if (status && status !== "All" && VERIFICATION_STATUSES.includes(status)) {
        filter.verificationStatus = status;
      }

      if (employeeId && employeeId.trim() && req.user?.role !== "employee") {
        const trimmedEmp = employeeId.trim();
        if (mongoose.Types.ObjectId.isValid(trimmedEmp)) {
          filter.employee = trimmedEmp;
        } else {
          const matchedUser = await UserModel.findOne({
            employeeId: { $regex: new RegExp(`^${trimmedEmp}$`, "i") },
            isUserDeleted: { $ne: true },
          }).select("_id");
          if (matchedUser) {
            filter.employee = matchedUser._id;
          }
        }
      }

      if (search && search.trim()) {
        const sRegex = new RegExp(search.trim(), "i");
        const matchingEmployees = await UserModel.find({
          $or: [
            { name: sRegex },
            { firstName: sRegex },
            { lastName: sRegex },
            { employeeId: sRegex },
            { email: sRegex },
          ],
          isUserDeleted: { $ne: true },
        }).select("_id");

        const empIds = matchingEmployees.map((e) => e._id);

        filter.$or = [
          { documentTitle: sRegex },
          { fileName: sRegex },
          { documentCategory: sRegex },
          { employee: { $in: empIds } },
        ];
      }

      const order = sortOrder === "asc" || sortOrder === "1" ? 1 : -1;
      const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

      const [docs, totalMatched] = await Promise.all([
        DocumentModel.find(filter)
          .populate("employee", "name firstName lastName employeeId email avatarUrl department designation")
          .populate("verifiedBy", "name firstName lastName email")
          .sort({ [sortBy]: order })
          .skip(skip)
          .limit(parseInt(limit, 10))
          .lean(),
        DocumentModel.countDocuments(filter),
      ]);

      const formattedDocuments = docs.map((doc) => {
        const emp = doc.employee || {};
        const empName = emp.name || `${emp.firstName || ""} ${emp.lastName || ""}`.trim() || "Employee";
        const empCode = emp.employeeId ? `#${emp.employeeId}` : "";
        const employeeLabel = `${empName} (${empCode})`.trim();

        const formattedUploadDate = formatDisplayDate(doc.createdAt);
        const formattedVerifiedDate = formatDisplayDate(doc.verifiedAt);

        let statusNote = "";
        if (doc.verificationStatus === "Verified" && formattedVerifiedDate) {
          statusNote = `Size: ${doc.formattedSize || "0 KB"} • Verified on ${formattedVerifiedDate}`;
        } else {
          statusNote = `Size: ${doc.formattedSize || "0 KB"} • ${doc.verificationStatus}`;
        }

        return {
          _id: doc._id,
          documentTitle: doc.documentTitle,
          documentCategory: doc.documentCategory,
          fileName: doc.fileName,
          fileUrl: doc.fileUrl,
          fileSize: doc.fileSize,
          formattedSize: doc.formattedSize || formatBytes(doc.fileSize),
          fileType: doc.fileType || "pdf",
          mimeType: doc.mimeType,
          verificationStatus: doc.verificationStatus,
          verifiedAt: doc.verifiedAt,
          verifiedDate: formattedVerifiedDate,
          formattedDate: formattedUploadDate,
          dateInfo: `${doc.formattedSize || "0 KB"} • ${formattedUploadDate}`,
          statusNote,
          badgeColor: doc.badgeColor || getCategoryBadgeColor(doc.documentCategory),
          icon: doc.icon || getCategoryIcon(doc.documentCategory, doc.documentTitle),
          employee: {
            _id: emp._id,
            name: empName,
            employeeId: emp.employeeId || "",
            email: emp.email || "",
            avatarUrl: emp.avatarUrl || "",
            label: employeeLabel,
          },
          employeeName: empName,
          employeeId: emp.employeeId || "",
          employeeLabel,
          previewUrl: `/api/previewDocument/${doc._id}`,
          downloadUrl: `/api/downloadDocument/${doc._id}`,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        };
      });

      const tabs = [
        { label: "All", key: "all", count: totalAllCount },
        { label: "Identity", key: "identity", count: identityCount },
        { label: "Employment", key: "employment", count: employmentCount },
        { label: "Education", key: "education", count: educationCount },
        { label: "Certifications", key: "certifications", count: certificationsCount },
      ];

      return sendSuccessResponse(res, "Documents fetched successfully", {
        totalDocuments: totalMatched,
        tabs,
        categoryCounts: {
          all: totalAllCount,
          identity: identityCount,
          employment: employmentCount,
          education: educationCount,
          certifications: certificationsCount,
        },
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(totalMatched / parseInt(limit, 10)) || 1,
        documents: formattedDocuments,
      });
    } catch (error) {
      console.error("Get All Documents Error:", error);
      return sendErrorResponse(res, 500, "Failed to retrieve documents", error);
    }
  }

  static async getMyDocuments(req, res) {
    if (!req.query) req.query = {};
    req.query.employeeId = String(req.user._id);
    return DocumentController.getAllDocuments(req, res);
  }

  static async getDocumentById(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid document ID");
      }

      const doc = await DocumentModel.findById(id)
        .populate("employee", "name firstName lastName employeeId email avatarUrl department designation")
        .populate("verifiedBy", "name firstName lastName email")
        .lean();

      if (!doc) {
        return sendNotFoundResponse(res, "Document not found");
      }

      const emp = doc.employee || {};
      const empName = emp.name || `${emp.firstName || ""} ${emp.lastName || ""}`.trim() || "Employee";
      const empCode = emp.employeeId ? `#${emp.employeeId}` : "";
      const employeeLabel = `${empName} (${empCode})`.trim();

      const formattedVerifiedDate = formatDisplayDate(doc.verifiedAt);
      const formattedUploadDate = formatDisplayDate(doc.createdAt);

      let statusNote = "";
      if (doc.verificationStatus === "Verified" && formattedVerifiedDate) {
        statusNote = `Size: ${doc.formattedSize || "0 KB"} • Verified on ${formattedVerifiedDate}`;
      } else {
        statusNote = `Size: ${doc.formattedSize || "0 KB"} • ${doc.verificationStatus}`;
      }

      const formatted = {
        ...doc,
        employeeName: empName,
        employeeId: emp.employeeId || "",
        employeeLabel,
        formattedDate: formattedUploadDate,
        verifiedDate: formattedVerifiedDate,
        statusNote,
        previewUrl: `/api/previewDocument/${doc._id}`,
        downloadUrl: `/api/downloadDocument/${doc._id}`,
      };

      return sendSuccessResponse(res, "Document details fetched successfully", formatted);
    } catch (error) {
      console.error("Get Document By ID Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch document", error);
    }
  }

  static async getDocumentFormOptions(req, res) {
    try {
      const employees = await UserModel.find({
        role: "employee",
        isUserDeleted: { $ne: true },
      })
        .select("_id employeeId name firstName lastName email avatarUrl")
        .sort({ employeeId: 1 })
        .lean();

      const employeeOptions = employees.map((emp) => {
        const empName = emp.name || `${emp.firstName || ""} ${emp.lastName || ""}`.trim() || "Employee";
        const empCode = emp.employeeId ? `#${emp.employeeId}` : "";
        return {
          _id: emp._id,
          employeeId: emp.employeeId || "",
          name: empName,
          email: emp.email || "",
          avatarUrl: emp.avatarUrl || "",
          label: `${empName} (${empCode})`.trim(),
        };
      });

      return sendSuccessResponse(res, "Form options fetched successfully", {
        categories: DOCUMENT_CATEGORIES,
        statuses: VERIFICATION_STATUSES,
        employees: employeeOptions,
      });
    } catch (error) {
      console.error("Get Document Form Options Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch form options", error);
    }
  }

  static async uploadDocument(req, res) {
    try {
      const body = req.body || {};
      const {
        documentCategory,
        category,
        documentTitle,
        title,
        employee,
        employeeId,
        verificationStatus = "Pending Review",
        fileUrl: directFileUrl,
        fileName: directFileName,
      } = body;

      const rawTitle = documentTitle || title;
      if (!rawTitle || !rawTitle.trim()) {
        return sendBadRequestResponse(res, "Document title is required");
      }

      const rawCategory = documentCategory || category || "Identity Proof";
      let resolvedCategory = rawCategory.trim();
      const lowerCat = resolvedCategory.toLowerCase();

      if (
        lowerCat.includes("ident") ||
        lowerCat.includes("aadhar") ||
        lowerCat.includes("aadhaar") ||
        lowerCat.includes("pan") ||
        lowerCat.includes("passport") ||
        lowerCat.includes("voter") ||
        lowerCat.includes("driving") ||
        lowerCat.includes("license") ||
        lowerCat.includes("id card")
      ) {
        resolvedCategory = "Identity Proof";
      } else if (
        lowerCat.includes("employ") ||
        lowerCat.includes("contract") ||
        lowerCat.includes("offer") ||
        lowerCat.includes("joining") ||
        lowerCat.includes("reliev") ||
        lowerCat.includes("experience") ||
        lowerCat.includes("salary") ||
        lowerCat.includes("payslip") ||
        lowerCat.includes("nda")
      ) {
        resolvedCategory = "Employment";
      } else if (
        lowerCat.includes("educat") ||
        lowerCat.includes("degree") ||
        lowerCat.includes("diploma") ||
        lowerCat.includes("marksheet") ||
        lowerCat.includes("graduation") ||
        lowerCat.includes("college") ||
        lowerCat.includes("school") ||
        lowerCat.includes("10th") ||
        lowerCat.includes("12th")
      ) {
        resolvedCategory = "Education";
      } else if (
        lowerCat.includes("certif") ||
        lowerCat.includes("course") ||
        lowerCat.includes("training") ||
        lowerCat.includes("skill")
      ) {
        resolvedCategory = "Certifications";
      } else if (
        lowerCat.includes("tax") ||
        lowerCat.includes("compliance") ||
        lowerCat.includes("tds") ||
        lowerCat.includes("form 16") ||
        lowerCat.includes("pf") ||
        lowerCat.includes("esic") ||
        lowerCat.includes("gst")
      ) {
        resolvedCategory = "Tax & Compliance";
      }

      const isEmployeeUser = req.user?.role === "employee";
      let targetEmpIdentifier = null;

      if (isEmployeeUser) {
        targetEmpIdentifier = req.user?._id;
      } else {
        targetEmpIdentifier = employee || employeeId;
        if (!targetEmpIdentifier || !String(targetEmpIdentifier).trim()) {
          return sendBadRequestResponse(
            res,
            "Employee ID is required when uploaded by admin"
          );
        }
      }

      let employeeDoc = null;
      const empSearchId = String(targetEmpIdentifier).trim();
      if (mongoose.Types.ObjectId.isValid(empSearchId)) {
        employeeDoc = await UserModel.findOne({
          _id: empSearchId,
          isUserDeleted: { $ne: true },
        });
      }
      if (!employeeDoc) {
        employeeDoc = await UserModel.findOne({
          $or: [
            { employeeId: empSearchId },
            { name: new RegExp(`^${empSearchId}$`, "i") },
            { email: empSearchId.toLowerCase() },
          ],
          isUserDeleted: { $ne: true },
        });
      }

      if (!employeeDoc) {
        return sendNotFoundResponse(res, "Specified employee not found");
      }

      let finalFileUrl = directFileUrl || "";
      let finalFileKey = "";
      let finalFileName = directFileName || `${rawTitle.trim().replace(/\s+/g, "_")}.pdf`;
      let finalFileSize = 0;
      let finalFileType = "pdf";
      let finalMimeType = "application/pdf";

      if (req.file) {
        finalFileName = req.file.originalname || finalFileName;
        finalFileSize = req.file.size || req.file.buffer?.length || 0;
        finalMimeType = req.file.mimetype || finalMimeType;
        const ext = path.extname(finalFileName).replace(".", "").toLowerCase();
        if (ext) finalFileType = ext;

        try {
          const s3Res = await uploadFile(req.file);
          finalFileUrl = s3Res.url;
          finalFileKey = s3Res.key;
        } catch (s3Error) {
          const uploadDir = path.join(process.cwd(), "public", "documents");
          if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
          }
          const cleanName = `${Date.now()}_${finalFileName.replace(/\s+/g, "_")}`;
          fs.writeFileSync(path.join(uploadDir, cleanName), req.file.buffer);
          finalFileUrl = `/public/documents/${cleanName}`;
          finalFileKey = `documents/${cleanName}`;
        }
      }

      if (!finalFileUrl) {
        return sendBadRequestResponse(res, "Document file is required (PDF, JPG, PNG)");
      }

      const formattedSize = formatBytes(finalFileSize);
      const badgeColor = getCategoryBadgeColor(resolvedCategory);
      const icon = getCategoryIcon(resolvedCategory, rawTitle.trim());

      let status = "Pending Review";
      if (isEmployeeUser) {
        status = "Pending Review";
      } else {
        status =
          verificationStatus && VERIFICATION_STATUSES.includes(verificationStatus)
            ? verificationStatus
            : "Verified";
      }

      const newDoc = await DocumentModel.create({
        documentTitle: rawTitle.trim(),
        documentCategory: resolvedCategory,
        employee: employeeDoc._id,
        fileName: finalFileName,
        fileUrl: finalFileUrl,
        fileKey: finalFileKey,
        fileSize: finalFileSize,
        formattedSize,
        fileType: finalFileType,
        mimeType: finalMimeType,
        verificationStatus: status,
        verifiedAt: status === "Verified" ? new Date() : null,
        verifiedBy: status === "Verified" ? req.user?._id || null : null,
        badgeColor,
        icon,
        uploadedBy: req.user?._id || null,
      });

      const empName = employeeDoc.name || `${employeeDoc.firstName || ""} ${employeeDoc.lastName || ""}`.trim();
      await recordAuditLog(req, {
        action: "Uploaded Employee Document",
        category: "Employees",
        description: `Uploaded ${resolvedCategory} document '${rawTitle.trim()}' for ${empName} (${employeeDoc.employeeId || "EMP"})`,
        targetResource: `${rawTitle.trim()} - ${empName}`,
        diff: {
          before: "None",
          after: `Category: ${resolvedCategory} | Status: ${status}`,
        },
      });

      return sendCreatedResponse(
        res,
        "Employee document uploaded and saved successfully",
        newDoc
      );
    } catch (error) {
      console.error("Upload Document Error:", error);
      return sendErrorResponse(res, 500, "Failed to upload document", error);
    }
  }

  static async previewDocument(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid document ID");
      }

      const doc = await DocumentModel.findById(id)
        .populate("employee", "name firstName lastName employeeId email avatarUrl")
        .populate("verifiedBy", "name firstName lastName email")
        .lean();

      if (!doc) {
        return sendNotFoundResponse(res, "Document not found");
      }

      const emp = doc.employee || {};
      const empName = emp.name || `${emp.firstName || ""} ${emp.lastName || ""}`.trim() || "Employee";
      const empCode = emp.employeeId ? `#${emp.employeeId}` : "";
      const employeeLabel = `${empName} (${empCode})`.trim();

      const formattedVerifiedDate = formatDisplayDate(doc.verifiedAt);
      const formattedUploadDate = formatDisplayDate(doc.createdAt);

      let statusNote = "";
      if (doc.verificationStatus === "Verified" && formattedVerifiedDate) {
        statusNote = `Size: ${doc.formattedSize || "0 KB"} • Verified on ${formattedVerifiedDate}`;
      } else {
        statusNote = `Size: ${doc.formattedSize || "0 KB"} • ${doc.verificationStatus}`;
      }

      const previewData = {
        _id: doc._id,
        documentTitle: doc.documentTitle,
        documentCategory: doc.documentCategory,
        fileName: doc.fileName,
        fileUrl: doc.fileUrl,
        fileSize: doc.fileSize,
        formattedSize: doc.formattedSize || "0 KB",
        fileType: doc.fileType || "pdf",
        mimeType: doc.mimeType || "application/pdf",
        verificationStatus: doc.verificationStatus,
        verifiedAt: doc.verifiedAt,
        verifiedDate: formattedVerifiedDate,
        formattedDate: formattedUploadDate,
        statusNote,
        employeeName: empName,
        employeeId: emp.employeeId || "",
        employeeLabel,
        badgeColor: doc.badgeColor,
        icon: doc.icon,
        downloadUrl: `/api/downloadDocument/${doc._id}`,
      };

      return sendSuccessResponse(res, "Preview details retrieved", previewData);
    } catch (error) {
      console.error("Preview Document Error:", error);
      return sendErrorResponse(res, 500, "Failed to load document preview", error);
    }
  }

  static async downloadDocument(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid document ID");
      }

      const doc = await DocumentModel.findById(id);
      if (!doc) {
        return sendNotFoundResponse(res, "Document not found");
      }

      if (req.query.json === "true" || req.headers.accept?.includes("application/json")) {
        return sendSuccessResponse(res, "Document download URL generated", {
          fileName: doc.fileName,
          downloadUrl: doc.fileUrl,
          fileUrl: doc.fileUrl,
        });
      }

      if (doc.fileUrl && doc.fileUrl.startsWith("/public/")) {
        const localPath = path.join(process.cwd(), doc.fileUrl);
        if (fs.existsSync(localPath)) {
          return res.download(localPath, doc.fileName);
        }
      }

      return res.redirect(doc.fileUrl);
    } catch (error) {
      console.error("Download Document Error:", error);
      return sendErrorResponse(res, 500, "Failed to download document", error);
    }
  }

  static async updateDocumentStatus(req, res) {
    try {
      const { id } = req.params;
      const { verificationStatus, rejectionReason } = req.body;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid document ID");
      }

      if (!verificationStatus || !VERIFICATION_STATUSES.includes(verificationStatus)) {
        return sendBadRequestResponse(
          res,
          `Invalid status. Must be one of: ${VERIFICATION_STATUSES.join(", ")}`
        );
      }

      const doc = await DocumentModel.findById(id).populate("employee", "name firstName lastName employeeId");
      if (!doc) {
        return sendNotFoundResponse(res, "Document not found");
      }

      const oldStatus = doc.verificationStatus;
      doc.verificationStatus = verificationStatus;
      if (verificationStatus === "Verified") {
        doc.verifiedAt = new Date();
        doc.verifiedBy = req.user?._id || null;
      } else {
        doc.verifiedAt = null;
        doc.verifiedBy = null;
      }

      if (rejectionReason !== undefined) {
        doc.rejectionReason = String(rejectionReason).trim();
      }

      await doc.save();

      const emp = doc.employee || {};
      const empName = emp.name || `${emp.firstName || ""} ${emp.lastName || ""}`.trim();

      await recordAuditLog(req, {
        action: `Document Status ${verificationStatus}`,
        category: "Employees",
        description: `Updated verification status of ${doc.documentTitle} for ${empName} to ${verificationStatus}`,
        targetResource: `${doc.documentTitle} - ${empName}`,
        diff: {
          before: `Status: ${oldStatus}`,
          after: `Status: ${verificationStatus}`,
        },
      });

      return sendSuccessResponse(res, `Document status updated to ${verificationStatus}`, doc);
    } catch (error) {
      console.error("Update Document Status Error:", error);
      return sendErrorResponse(res, 500, "Failed to update document status", error);
    }
  }

  static async deleteDocument(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid document ID");
      }

      const doc = await DocumentModel.findById(id).populate("employee", "name firstName lastName employeeId");
      if (!doc) {
        return sendNotFoundResponse(res, "Document not found");
      }

      const isOwner =
        req.user?._id &&
        String(doc.employee?._id || doc.employee) === String(req.user._id);
      const isAdmin = req.user?.role === "admin";

      if (!isOwner && !isAdmin) {
        return sendErrorResponse(
          res,
          403,
          "You are not authorized to delete this document"
        );
      }

      if (doc.fileUrl && doc.fileUrl.startsWith("/public/")) {
        const localPath = path.join(process.cwd(), doc.fileUrl);
        if (fs.existsSync(localPath)) {
          try {
            fs.unlinkSync(localPath);
          } catch (e) {
            console.warn("Could not delete local file:", e.message);
          }
        }
      } else if (doc.fileUrl) {
        try {
          await deleteFileFromS3(doc.fileUrl);
        } catch (e) {
          console.warn("Could not delete from S3:", e.message);
        }
      }

      await DocumentModel.findByIdAndDelete(id);

      const emp = doc.employee || {};
      const empName = emp.name || `${emp.firstName || ""} ${emp.lastName || ""}`.trim();

      await recordAuditLog(req, {
        action: "Deleted Employee Document",
        category: "Employees",
        description: `Permanently deleted ${doc.documentTitle} for ${empName} (${emp.employeeId || "EMP"})`,
        targetResource: `${doc.documentTitle} - ${empName}`,
        diff: {
          before: `Document: ${doc.fileName} (${doc.documentCategory})`,
          after: "Permanently Deleted",
        },
      });

      return sendSuccessResponse(res, "Document deleted successfully", {
        deletedId: id,
      });
    } catch (error) {
      console.error("Delete Document Error:", error);
      return sendErrorResponse(res, 500, "Failed to delete document", error);
    }
  }
}