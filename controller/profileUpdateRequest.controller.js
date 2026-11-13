import mongoose from "mongoose";
import ProfileUpdateRequestModel from "../model/profileUpdateRequest.model.js";
import UserModel from "../model/user.model.js";
import { recordAuditLog } from "../utils/auditLogger.js";
import { notifyAdmins, notifyUser } from "../utils/notification.util.js";
import {
  sendSuccessResponse,
  sendBadRequestResponse,
  sendNotFoundResponse,
  sendErrorResponse,
} from "../utils/Response.utils.js";

const formatDDMMYYYY = (input) => {
  if (!input) return "";
  const d = new Date(input);
  if (isNaN(d.getTime())) return String(input);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
};

export class ProfileUpdateRequestController {
  static async submitRequest(req, res) {
    try {
      const employeeId = req.user._id;
      const { fieldToUpdate, proposedValue, reason } = req.body;

      if (!fieldToUpdate || !fieldToUpdate.trim()) {
        return sendBadRequestResponse(res, "Field to update is required");
      }

      if (!proposedValue || !proposedValue.trim()) {
        return sendBadRequestResponse(res, "Proposed new value is required");
      }

      if (!reason || !reason.trim()) {
        return sendBadRequestResponse(res, "Reason & justification is required");
      }

      const employee = await UserModel.findById(employeeId)
        .populate("department", "departmentName")
        .populate("designation", "designationName");

      if (!employee) {
        return sendNotFoundResponse(res, "Employee not found");
      }

      let currentValue = "";
      const normalizedField = fieldToUpdate.trim();

      if (normalizedField === "Legal Name Correction") {
        currentValue =
          employee.name ||
          `${employee.firstName || ""} ${employee.lastName || ""}`.trim() ||
          "Employee";
      } else if (normalizedField === "Bank Account Number") {
        currentValue = employee.salaryDetails?.accountNumber || "Not Provided";
      } else if (normalizedField === "PAN / Tax Identification") {
        currentValue = employee.documents?.panCard ? "Uploaded" : "Not Provided";
      } else if (normalizedField === "Educational Degree Update") {
        currentValue =
          employee.documents?.educationCertificate ? "Uploaded" : "Not Provided";
      } else if (normalizedField === "Department") {
        currentValue = employee.department?.departmentName || "Engineering";
      } else if (normalizedField === "Designation") {
        currentValue =
          employee.designation?.designationName || employee.roleTitle || "Software Engineer";
      } else if (normalizedField === "Work Email") {
        currentValue = employee.email || "";
      } else if (normalizedField === "Employment Type") {
        currentValue = employee.employmentType || "Full-time";
      } else {
        currentValue = "Current Profile Value";
      }

      const newRequest = new ProfileUpdateRequestModel({
        employee: employeeId,
        fieldToUpdate: normalizedField,
        currentValue,
        proposedValue: proposedValue.trim(),
        reason: reason.trim(),
        status: "Pending",
      });

      await newRequest.save();

      await recordAuditLog(req, {
        action: "Submitted Profile Update Request",
        category: "Employee Management",
        description: `${employee.name || "Employee"} requested update for '${normalizedField}'`,
        targetResource: `Employee: ${employee.name || employee.employeeId}`,
      });

      await notifyAdmins({
        title: "Profile Update Request",
        message: `${employee.name || "Employee"} requested update for '${normalizedField}' to '${proposedValue.trim()}'.`,
        category: "System",
        type: "PROFILE_UPDATE_REQUESTED",
        sender: employeeId,
        senderName: employee.name || "Employee",
        senderAvatar: employee.avatarUrl || null,
        referenceId: newRequest._id,
        referenceModel: "ProfileUpdateRequest",
      }).catch(() => {});

      const responseObj = newRequest.toObject();
      responseObj.formattedDate = formatDDMMYYYY(newRequest.createdAt);

      return sendSuccessResponse(
        res,
        "Profile update request submitted successfully. It will be reviewed by administrator.",
        responseObj
      );
    } catch (error) {
      console.error("Submit Profile Update Request Error:", error);
      return sendErrorResponse(
        res,
        500,
        "Failed to submit profile update request",
        error
      );
    }
  }

  static async getMyRequests(req, res) {
    try {
      const employeeId = req.user._id;

      const requests = await ProfileUpdateRequestModel.find({
        employee: employeeId,
      }).sort({ createdAt: -1 });

      const formatted = requests.map((item) => {
        const obj = item.toObject();
        obj.formattedDate = formatDDMMYYYY(item.createdAt);
        obj.statusBadgeColor =
          item.status === "Approved"
            ? "#10B981"
            : item.status === "Rejected"
              ? "#EF4444"
              : "#F59E0B";
        return obj;
      });

      return sendSuccessResponse(
        res,
        "Profile update requests retrieved successfully",
        {
          total: formatted.length,
          requests: formatted,
        }
      );
    } catch (error) {
      console.error("Get My Profile Update Requests Error:", error);
      return sendErrorResponse(
        res,
        500,
        "Failed to fetch profile update requests",
        error
      );
    }
  }

  static async saveContactChanges(req, res) {
    try {
      const employeeId = req.user._id;
      const {
        personalMobilePhone,
        mobileNumber,
        phone,
        emergencyContactPersonAndNumber,
        emergencyContactPerson,
        emergencyContactName,
        emergencyContactNumber,
        emergencyContactPhone,
        currentResidentialAddress,
        addressLine1,
        addressLine2,
        city,
        state,
        zipCode,
      } = req.body;

      const employee = await UserModel.findById(employeeId);
      if (!employee) {
        return sendNotFoundResponse(res, "Employee not found");
      }

      if (!employee.contactInfo) {
        employee.contactInfo = {};
      }
      if (!employee.contactInfo.address) {
        employee.contactInfo.address = {};
      }
      if (!employee.emergencyContact) {
        employee.emergencyContact = {};
      }

      const newPhone =
        personalMobilePhone || mobileNumber || phone;
      if (newPhone !== undefined && newPhone !== null) {
        const trimmedPhone = String(newPhone).trim();
        employee.phone = trimmedPhone;
        employee.contactInfo.mobileNumber = trimmedPhone;
      }

      let parsedEmergencyName = emergencyContactPerson || emergencyContactName;
      let parsedEmergencyPhone = emergencyContactNumber || emergencyContactPhone;

      if (
        emergencyContactPersonAndNumber &&
        typeof emergencyContactPersonAndNumber === "string"
      ) {
        const raw = emergencyContactPersonAndNumber.trim();
        if (raw.includes("-")) {
          const parts = raw.split("-");
          parsedEmergencyName = parsedEmergencyName || parts[0].trim();
          parsedEmergencyPhone = parsedEmergencyPhone || parts.slice(1).join("-").trim();
        } else if (raw.includes(",")) {
          const parts = raw.split(",");
          parsedEmergencyName = parsedEmergencyName || parts[0].trim();
          parsedEmergencyPhone = parsedEmergencyPhone || parts.slice(1).join(",").trim();
        } else {
          parsedEmergencyName = parsedEmergencyName || raw;
        }
      }

      if (parsedEmergencyName) {
        employee.emergencyContact.contactName = String(parsedEmergencyName).trim();
      }
      if (parsedEmergencyPhone) {
        employee.emergencyContact.phoneNumber = String(parsedEmergencyPhone).trim();
      }

      const newAddress = currentResidentialAddress || addressLine1;
      if (newAddress !== undefined && newAddress !== null) {
        employee.contactInfo.address.addressLine1 = String(newAddress).trim();
      }
      if (addressLine2) {
        employee.contactInfo.address.addressLine2 = String(addressLine2).trim();
      }
      if (city) {
        employee.contactInfo.address.city = String(city).trim();
      }
      if (state) {
        employee.contactInfo.address.state = String(state).trim();
      }
      if (zipCode) {
        employee.contactInfo.address.zipCode = String(zipCode).trim();
      }

      await employee.save();

      const updatedUser = await UserModel.findById(employeeId)
        .select("-password -otp")
        .populate("department", "departmentName icon color")
        .populate("designation", "designationName level icon")
        .populate("shift", "shiftName startTime endTime durationHours workHoursDisplay breakTime teaBreaks color");

      await recordAuditLog(req, {
        action: "Updated Contact & Personal Information",
        category: "Employee Management",
        description: `${employee.name || "Employee"} updated contact & personal details`,
        targetResource: `Employee: ${employee.name || employee.employeeId}`,
      });

      const userObj = updatedUser.toObject();
      userObj.departmentName = updatedUser.department?.departmentName || "";
      userObj.designationName = updatedUser.designation?.designationName || "";

      return sendSuccessResponse(
        res,
        "Contact & personal information updated successfully",
        {
          employee: userObj,
          contactInfo: userObj.contactInfo,
          emergencyContact: userObj.emergencyContact,
        }
      );
    } catch (error) {
      console.error("Save Contact Changes Error:", error);
      return sendErrorResponse(
        res,
        500,
        "Failed to save contact information",
        error
      );
    }
  }

  static async getAllRequests(req, res) {
    try {
      const { status, search, page = 1, limit = 10 } = req.query;

      const filter = {};
      if (status && status !== "all") {
        filter.status = new RegExp(`^${status.trim()}$`, "i");
      }

      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        const matchedUsers = await UserModel.find({
          $or: [
            { name: regex },
            { firstName: regex },
            { lastName: regex },
            { employeeId: regex },
            { email: regex },
          ],
        }).select("_id");

        filter.$or = [
          { employee: { $in: matchedUsers.map((u) => u._id) } },
          { fieldToUpdate: regex },
          { proposedValue: regex },
          { reason: regex },
        ];
      }

      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.max(1, parseInt(limit, 10));
      const skip = (pageNum - 1) * limitNum;

      const [requests, total] = await Promise.all([
        ProfileUpdateRequestModel.find(filter)
          .populate({
            path: "employee",
            select: "name firstName lastName employeeId email avatarUrl department designation roleTitle",
            populate: [
              { path: "department", select: "departmentName color" },
              { path: "designation", select: "designationName level" },
            ],
          })
          .populate("actionBy", "name email")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum),
        ProfileUpdateRequestModel.countDocuments(filter),
      ]);

      const formatted = requests.map((item) => {
        const obj = item.toObject();
        obj.formattedDate = formatDDMMYYYY(item.createdAt);
        obj.statusBadgeColor =
          item.status === "Approved"
            ? "#10B981"
            : item.status === "Rejected"
              ? "#EF4444"
              : "#F59E0B";
        return obj;
      });

      return sendSuccessResponse(res, "Requests fetched successfully", {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
        requests: formatted,
      });
    } catch (error) {
      console.error("Get All Profile Update Requests Error:", error);
      return sendErrorResponse(
        res,
        500,
        "Failed to fetch profile update requests",
        error
      );
    }
  }

  static async actionRequest(req, res) {
    try {
      const { id } = req.params;
      const { action, remarks = "" } = req.body;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid request ID");
      }

      const normalizedAction = String(action || "").trim().toLowerCase();
      if (!["approve", "accept", "reject"].includes(normalizedAction)) {
        return sendBadRequestResponse(
          res,
          "Action must be either 'approve' or 'reject'"
        );
      }

      const request = await ProfileUpdateRequestModel.findById(id).populate("employee");
      if (!request) {
        return sendNotFoundResponse(res, "Profile update request not found");
      }

      if (request.status !== "Pending") {
        return sendBadRequestResponse(
          res,
          `This request has already been ${request.status.toLowerCase()}!`
        );
      }

      const isApprove = normalizedAction === "approve" || normalizedAction === "accept";
      const adminRemarks =
        remarks ||
        (isApprove
          ? "Approved by administrator"
          : "Rejected by administrator");

      if (isApprove) {
        const user = await UserModel.findById(request.employee._id);
        if (user) {
          const field = request.fieldToUpdate;
          const newVal = request.proposedValue;

          if (field === "Legal Name Correction") {
            user.name = newVal.trim();
            const nameParts = newVal.trim().split(" ");
            user.firstName = nameParts[0] || newVal.trim();
            user.lastName = nameParts.slice(1).join(" ") || "";
          } else if (field === "Bank Account Number") {
            if (!user.salaryDetails) user.salaryDetails = {};
            user.salaryDetails.accountNumber = newVal.trim();
          } else if (field === "PAN / Tax Identification") {
            if (!user.documents) user.documents = {};
            user.documents.panCard = newVal.trim();
          } else if (field === "Educational Degree Update") {
            if (!user.additionalInfo) user.additionalInfo = {};
            const prev = user.additionalInfo.employmentNotes || "";
            user.additionalInfo.employmentNotes = prev
              ? `${prev} | Degree: ${newVal.trim()}`
              : `Degree: ${newVal.trim()}`;
          } else if (field === "Work Email") {
            user.email = newVal.trim().toLowerCase();
          } else if (field === "Employment Type") {
            user.employmentType = newVal.trim();
          }
          await user.save();
        }

        request.status = "Approved";
      } else {
        request.status = "Rejected";
      }

      request.adminRemarks = adminRemarks;
      request.actionBy = req.user?._id;
      request.actionAt = new Date();
      await request.save();

      await recordAuditLog(req, {
        action: `${isApprove ? "Approved" : "Rejected"} Profile Update Request`,
        category: "Employee Management",
        description: `${isApprove ? "Approved" : "Rejected"} update for '${request.fieldToUpdate}' of ${request.employee?.name || "Employee"}`,
        targetResource: `${request.employee?.name || "Employee"} - ${request.fieldToUpdate}`,
      });

      await notifyUser(request.employee?._id || request.employee, {
        title: `Profile Update Request ${isApprove ? "Approved" : "Rejected"}`,
        message: `Your profile update request for '${request.fieldToUpdate}' has been ${isApprove ? "approved" : "rejected"} by Admin.${!isApprove && adminRemarks ? ` Reason: ${adminRemarks}` : ""}`,
        category: "System",
        type: isApprove ? "PROFILE_UPDATE_APPROVED" : "PROFILE_UPDATE_REJECTED",
        sender: req.user?._id,
        referenceId: request._id,
        referenceModel: "ProfileUpdateRequest",
      }).catch(() => {});

      return sendSuccessResponse(
        res,
        `Request ${request.status.toLowerCase()} successfully!`,
        request
      );
    } catch (error) {
      console.error("Action Profile Update Request Error:", error);
      return sendErrorResponse(
        res,
        500,
        "Failed to action profile update request",
        error
      );
    }
  }

  static async deleteRequest(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid request ID");
      }

      const request = await ProfileUpdateRequestModel.findById(id).populate("employee");
      if (!request) {
        return sendNotFoundResponse(res, "Profile update request not found");
      }

      const isOwner =
        req.user?._id &&
        String(request.employee?._id || request.employee) === String(req.user._id);
      const isAdmin = req.user?.role === "admin";

      if (!isOwner && !isAdmin) {
        return sendErrorResponse(
          res,
          403,
          "You are not authorized to delete this request"
        );
      }

      await ProfileUpdateRequestModel.findByIdAndDelete(id);

      await recordAuditLog(req, {
        action: "Deleted Profile Update Request",
        category: "Employee Management",
        description: `${req.user?.name || "User"} deleted profile update request for '${request.fieldToUpdate}'`,
        targetResource: `Employee: ${request.employee?.name || request.employee}`,
      });

      return sendSuccessResponse(
        res,
        "Profile update request deleted successfully",
        {
          deletedId: id,
          fieldToUpdate: request.fieldToUpdate,
        }
      );
    } catch (error) {
      console.error("Delete Profile Update Request Error:", error);
      return sendErrorResponse(
        res,
        500,
        "Failed to delete profile update request",
        error
      );
    }
  }
}

