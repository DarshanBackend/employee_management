import mongoose from "mongoose";
import UserModel from "../model/user.model.js";
import DepartmentModel from "../model/department.model.js";
import DesignationModel from "../model/designation.model.js";
import { uploadFile, deleteFileFromS3 } from "../middleware/imageupload.js";
import bcrypt from "bcryptjs";
import transporter from "../utils/Email.config.js";

const generateEmployeeId = async () => {
  const count = await UserModel.countDocuments({ role: "employee" });
  const num = String(count + 1).padStart(4, "0");
  return `EMP-${num}`;
};

const sendEmployeeWelcomeEmail = async ({ to, name, employeeId, email, password }) => {
  try {
    const emailUser = process.env.EMAIL_USER || "darshan1.kalathiyainfotech@gmail.com";
    await transporter.sendMail({
      from: `"Employee Management" <${emailUser}>`,
      to,
      subject: `Welcome to the Team, ${name}! - Your Employee Account Details`,
      html: `
        <div style="font-family: Arial, sans-serif; background: #f4f6f8; padding: 30px 15px;">
          <div style="max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.08);">
            <div style="background: #1f4e5b; padding: 24px; text-align: center; color: #ffffff;">
              <h2 style="margin: 0; font-size: 22px;">Employee Portal Account Created</h2>
            </div>
            <div style="padding: 28px;">
              <p style="font-size: 15px; color: #333;">Hello <strong>${name}</strong>,</p>
              <p style="font-size: 14px; color: #555; line-height: 1.5;">
                An account has been created for you on the Employee Management Portal. Below are your login credentials:
              </p>
              <div style="background: #f8fafc; border-left: 4px solid #1f4e5b; padding: 15px; margin: 20px 0; border-radius: 4px;">
                <p style="margin: 4px 0; font-size: 14px;"><strong>Employee ID:</strong> ${employeeId}</p>
                <p style="margin: 4px 0; font-size: 14px;"><strong>Login Email:</strong> ${email}</p>
                <p style="margin: 4px 0; font-size: 14px;"><strong>Temporary Password:</strong> <span style="font-family: monospace; background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">${password}</span></p>
              </div>
              <p style="font-size: 13px; color: #64748b;">
                Please log in and change your password upon your first login.
              </p>
            </div>
          </div>
        </div>
      `,
    });
  } catch (err) {
    console.error("Welcome Email Sending Warning:", err.message);
  }
};

export class EmployeeController {

  static async addEmployee(req, res) {
    try {
      let bodyData = req.body;

      if (typeof bodyData.contactInfo === "string") {
        try { bodyData.contactInfo = JSON.parse(bodyData.contactInfo); } catch (e) { }
      }
      if (typeof bodyData.shiftAndSchedule === "string") {
        try { bodyData.shiftAndSchedule = JSON.parse(bodyData.shiftAndSchedule); } catch (e) { }
      }
      if (typeof bodyData.emergencyContact === "string") {
        try { bodyData.emergencyContact = JSON.parse(bodyData.emergencyContact); } catch (e) { }
      }
      if (typeof bodyData.documents === "string") {
        try { bodyData.documents = JSON.parse(bodyData.documents); } catch (e) { }
      }
      if (typeof bodyData.additionalInfo === "string") {
        try { bodyData.additionalInfo = JSON.parse(bodyData.additionalInfo); } catch (e) { }
      }

      const {
        employeeId: customEmployeeId,
        firstName,
        lastName,
        dateOfBirth,
        gender,
        phoneNumber,
        email,
        maritalStatus,
        bloodGroup,
        nationality = "Indian",
        department,
        designation,
        employmentType = "Full-time",
        employeeStatus = "Active",
        joiningDate,
        probationPeriod,
        reportingManager,
        workLocation,
        contactInfo = {},
        shiftAndSchedule = {},
        emergencyContact = {},
        documents = {},
        additionalInfo = {},
        password,
      } = bodyData;

      if (!email || !email.trim()) {
        return res.status(400).json({ success: false, message: "Email is required!" });
      }

      const cleanEmail = email.toLowerCase().trim();

      const existingUser = await UserModel.findOne({ email: cleanEmail });
      if (existingUser && !existingUser.isUserDeleted) {
        return res.status(409).json({
          success: false,
          message: "An employee with this email already exists.",
        });
      }

      const empId = customEmployeeId ? customEmployeeId.trim() : await generateEmployeeId();

      const duplicateEmpId = await UserModel.findOne({ employeeId: empId });
      if (duplicateEmpId) {
        return res.status(409).json({
          success: false,
          message: `Employee ID '${empId}' is already in use. Please provide a unique ID.`,
        });
      }

      let avatarUrl = bodyData.avatarUrl || null;
      let uploadedDocs = { ...documents };

      if (req.files) {
        if (req.files.profilePhoto && req.files.profilePhoto[0]) {
          const uploadRes = await uploadFile(req.files.profilePhoto[0]);
          avatarUrl = uploadRes.url;
        }
        if (req.files.panCard && req.files.panCard[0]) {
          const uploadRes = await uploadFile(req.files.panCard[0]);
          uploadedDocs.panCard = uploadRes.url;
        }
        if (req.files.aadhaarCard && req.files.aadhaarCard[0]) {
          const uploadRes = await uploadFile(req.files.aadhaarCard[0]);
          uploadedDocs.aadhaarCard = uploadRes.url;
        }
        if (req.files.addressProof && req.files.addressProof[0]) {
          const uploadRes = await uploadFile(req.files.addressProof[0]);
          uploadedDocs.addressProof = uploadRes.url;
        }
        if (req.files.educationCertificate && req.files.educationCertificate[0]) {
          const uploadRes = await uploadFile(req.files.educationCertificate[0]);
          uploadedDocs.educationCertificate = uploadRes.url;
        }
        if (req.files.experienceLetter && req.files.experienceLetter[0]) {
          const uploadRes = await uploadFile(req.files.experienceLetter[0]);
          uploadedDocs.experienceLetter = uploadRes.url;
        }
        if (req.files.joiningLetter && req.files.joiningLetter[0]) {
          const uploadRes = await uploadFile(req.files.joiningLetter[0]);
          uploadedDocs.joiningLetter = uploadRes.url;
        }
      }

      const fullName = `${firstName || ""} ${lastName || ""}`.trim() || cleanEmail.split("@")[0];
      if (!avatarUrl) {
        const formattedName = encodeURIComponent(fullName);
        avatarUrl = `https://ui-avatars.com/api/?name=${formattedName}&background=1F4E5B&color=fff&size=128`;
      }

      let validDepartmentId = null;
      const rawDept = department || bodyData.departmentId;
      if (rawDept && rawDept !== "null" && rawDept !== "undefined" && String(rawDept).trim() !== "") {
        const trimmedDept = String(rawDept).trim();
        if (!mongoose.Types.ObjectId.isValid(trimmedDept)) {
          return res.status(400).json({ success: false, message: "Invalid Department ID" });
        }
        const deptExists = await DepartmentModel.findOne({ _id: trimmedDept, isDeleted: false });
        if (!deptExists) {
          return res.status(404).json({ success: false, message: "Selected department not found" });
        }
        validDepartmentId = deptExists._id;
      }

      let validDesignationId = null;
      const rawDesig = designation || bodyData.designationId;
      if (rawDesig && rawDesig !== "null" && rawDesig !== "undefined" && String(rawDesig).trim() !== "") {
        const trimmedDesig = String(rawDesig).trim();
        if (!mongoose.Types.ObjectId.isValid(trimmedDesig)) {
          return res.status(400).json({ success: false, message: "Invalid Designation ID" });
        }
        const desigExists = await DesignationModel.findOne({ _id: trimmedDesig, isDeleted: false });
        if (!desigExists) {
          return res.status(404).json({ success: false, message: "Selected designation not found" });
        }
        validDesignationId = desigExists._id;
      }

      const rawPassword = password || "Employee@123";
      const hashedPassword = await bcrypt.hash(rawPassword, 10);

      const employee = await UserModel.create({
        employeeId: empId,
        firstName: firstName || "",
        lastName: lastName || "",
        name: fullName,
        email: cleanEmail,
        password: hashedPassword,
        avatarUrl,
        phone: phoneNumber || contactInfo.mobileNumber || null,
        role: "employee",
        isEmailVerified: true,
        dateOfBirth: dateOfBirth || null,
        gender: gender || "",
        maritalStatus: maritalStatus || "",
        bloodGroup: bloodGroup || "",
        nationality: nationality || "Indian",
        department: validDepartmentId,
        designation: validDesignationId,
        employmentType: employmentType || "Full-time",
        employeeStatus: employeeStatus || "Active",
        joiningDate: joiningDate || null,
        probationPeriod: probationPeriod || "",
        reportingManager: reportingManager || "",
        workLocation: workLocation || "",
        contactInfo: {
          personalEmail: contactInfo.personalEmail || bodyData.personalEmail || "",
          mobileNumber: phoneNumber || contactInfo.mobileNumber || bodyData.mobileNumber || "",
          alternatePhone: contactInfo.alternatePhone || bodyData.alternatePhone || "",
          address: {
            addressLine1: contactInfo.address?.addressLine1 || bodyData.addressLine1 || "",
            addressLine2: contactInfo.address?.addressLine2 || bodyData.addressLine2 || "",
            city: contactInfo.address?.city || bodyData.city || "",
            state: contactInfo.address?.state || bodyData.state || "",
            country: contactInfo.address?.country || bodyData.country || "India",
            zipCode: contactInfo.address?.zipCode || bodyData.zipCode || bodyData.postalCode || "",
          },
        },
        shiftAndSchedule: {
          shiftTiming: shiftAndSchedule.shiftTiming || bodyData.shiftTiming || "General Shift",
          weeklyOff: shiftAndSchedule.weeklyOff || bodyData.weeklyOff || "Sat - Sun",
        },
        emergencyContact: {
          contactName: emergencyContact.contactName || bodyData.emergencyContactName || bodyData.contactName || "",
          relationship: emergencyContact.relationship || bodyData.emergencyRelationship || bodyData.relationship || "",
          phoneNumber: emergencyContact.phoneNumber || bodyData.emergencyPhoneNumber || bodyData.emergencyPhone || "",
          alternatePhone: emergencyContact.alternatePhone || bodyData.emergencyAlternatePhone || "",
        },
        documents: uploadedDocs,
        additionalInfo: {
          employmentNotes: additionalInfo.employmentNotes || bodyData.employmentNotes || "",
        },
      });

      sendEmployeeWelcomeEmail({
        to: cleanEmail,
        name: fullName,
        employeeId: empId,
        email: cleanEmail,
        password: rawPassword,
      });

      const populatedEmployee = await UserModel.findById(employee._id)
        .select("-password -otp")
        .populate("department", "departmentName icon color")
        .populate("designation", "designationName level icon");

      return res.status(201).json({
        success: true,
        message: "Employee profile created successfully!",
        result: populatedEmployee,
      });
    } catch (error) {
      console.error("Add Employee Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to add employee",
        error: error.message,
      });
    }
  }

  static async getAllEmployees(req, res) {
    try {
      const {
        search,
        department,
        designation,
        employeeStatus,
        workLocation,
        page = 1,
        limit = 20,
        sortBy = "createdAt",
        order = "desc",
      } = req.query;

      const filter = {
        role: "employee",
        isUserDeleted: { $ne: true },
      };

      if (search) {
        const regex = new RegExp(search.trim(), "i");
        filter.$or = [
          { name: regex },
          { firstName: regex },
          { lastName: regex },
          { email: regex },
          { employeeId: regex },
          { phone: regex },
          { department: regex },
          { designation: regex },
        ];
      }

      if (department && department.trim()) {
        const trimmedDept = department.trim();
        if (mongoose.Types.ObjectId.isValid(trimmedDept)) {
          filter.department = trimmedDept;
        } else {
          const matchingDepts = await DepartmentModel.find({
            departmentName: new RegExp(trimmedDept, "i"),
            isDeleted: false,
          }).select("_id");
          filter.department = { $in: matchingDepts.map((d) => d._id) };
        }
      }

      if (designation && designation.trim()) {
        const trimmedDesig = designation.trim();
        if (mongoose.Types.ObjectId.isValid(trimmedDesig)) {
          filter.designation = trimmedDesig;
        } else {
          const matchingDesigs = await DesignationModel.find({
            designationName: new RegExp(trimmedDesig, "i"),
            isDeleted: false,
          }).select("_id");
          filter.designation = { $in: matchingDesigs.map((d) => d._id) };
        }
      }

      if (employeeStatus) filter.employeeStatus = employeeStatus;
      if (workLocation) filter.workLocation = new RegExp(`^${workLocation.trim()}$`, "i");

      const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
      const sortOrder = order === "asc" ? 1 : -1;

      const [employees, total] = await Promise.all([
        UserModel.find(filter)
          .select("-password -otp")
          .populate("department", "departmentName icon color")
          .populate("designation", "designationName level icon")
          .sort({ [sortBy]: sortOrder })
          .skip(skip)
          .limit(parseInt(limit, 10)),
        UserModel.countDocuments(filter),
      ]);

      return res.status(200).json({
        success: true,
        message: "Employees fetched successfully",
        result: {
          total,
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          totalPages: Math.ceil(total / parseInt(limit, 10)),
          employees,
        },
      });
    } catch (error) {
      console.error("Get Employees Error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch employees",
        error: error.message,
      });
    }
  }

  static async getEmployeeById(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(404).json({
          success: false,
          message: "Invalid employee ID",
        });
      }

      const employee = await UserModel.findOne({
        _id: id,
        role: "employee",
        isUserDeleted: { $ne: true },
      })
        .select("-password -otp")
        .populate("department", "departmentName icon color")
        .populate("designation", "designationName level icon");

      if (!employee) {
        return res.status(404).json({
          success: false,
          message: "Employee not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Employee details fetched successfully",
        result: employee,
      });
    } catch (error) {
      console.error("Get Employee Error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch employee",
        error: error.message,
      });
    }
  }

  static async updateEmployee(req, res) {
    try {
      const { id } = req.params;
      let bodyData = req.body;

      if (typeof bodyData.contactInfo === "string") {
        try { bodyData.contactInfo = JSON.parse(bodyData.contactInfo); } catch (e) { }
      }
      if (typeof bodyData.shiftAndSchedule === "string") {
        try { bodyData.shiftAndSchedule = JSON.parse(bodyData.shiftAndSchedule); } catch (e) { }
      }
      if (typeof bodyData.emergencyContact === "string") {
        try { bodyData.emergencyContact = JSON.parse(bodyData.emergencyContact); } catch (e) { }
      }
      if (typeof bodyData.documents === "string") {
        try { bodyData.documents = JSON.parse(bodyData.documents); } catch (e) { }
      }
      if (typeof bodyData.additionalInfo === "string") {
        try { bodyData.additionalInfo = JSON.parse(bodyData.additionalInfo); } catch (e) { }
      }

      const employee = await UserModel.findOne({ _id: id, role: "employee" });
      if (!employee) {
        return res.status(404).json({ success: false, message: "Employee not found" });
      }

      if (req.files) {
        if (req.files.profilePhoto && req.files.profilePhoto[0]) {
          if (employee.avatarUrl) {
            await deleteFileFromS3(employee.avatarUrl);
          }
          const uploadRes = await uploadFile(req.files.profilePhoto[0]);
          employee.avatarUrl = uploadRes.url;
        }
        if (req.files.panCard && req.files.panCard[0]) {
          if (employee.documents?.panCard) {
            await deleteFileFromS3(employee.documents.panCard);
          }
          const uploadRes = await uploadFile(req.files.panCard[0]);
          employee.documents.panCard = uploadRes.url;
        }
        if (req.files.aadhaarCard && req.files.aadhaarCard[0]) {
          if (employee.documents?.aadhaarCard) {
            await deleteFileFromS3(employee.documents.aadhaarCard);
          }
          const uploadRes = await uploadFile(req.files.aadhaarCard[0]);
          employee.documents.aadhaarCard = uploadRes.url;
        }
        if (req.files.addressProof && req.files.addressProof[0]) {
          if (employee.documents?.addressProof) {
            await deleteFileFromS3(employee.documents.addressProof);
          }
          const uploadRes = await uploadFile(req.files.addressProof[0]);
          employee.documents.addressProof = uploadRes.url;
        }
        if (req.files.educationCertificate && req.files.educationCertificate[0]) {
          if (employee.documents?.educationCertificate) {
            await deleteFileFromS3(employee.documents.educationCertificate);
          }
          const uploadRes = await uploadFile(req.files.educationCertificate[0]);
          employee.documents.educationCertificate = uploadRes.url;
        }
        if (req.files.experienceLetter && req.files.experienceLetter[0]) {
          if (employee.documents?.experienceLetter) {
            await deleteFileFromS3(employee.documents.experienceLetter);
          }
          const uploadRes = await uploadFile(req.files.experienceLetter[0]);
          employee.documents.experienceLetter = uploadRes.url;
        }
        if (req.files.joiningLetter && req.files.joiningLetter[0]) {
          if (employee.documents?.joiningLetter) {
            await deleteFileFromS3(employee.documents.joiningLetter);
          }
          const uploadRes = await uploadFile(req.files.joiningLetter[0]);
          employee.documents.joiningLetter = uploadRes.url;
        }
      }

      const allowedFields = [
        "firstName", "lastName", "dateOfBirth", "gender", "maritalStatus",
        "bloodGroup", "nationality",
        "employmentType", "employeeStatus", "joiningDate", "probationPeriod",
        "reportingManager", "workLocation"
      ];

      allowedFields.forEach((field) => {
        if (bodyData[field] !== undefined) {
          employee[field] = bodyData[field];
        }
      });

      if (bodyData.department !== undefined || bodyData.departmentId !== undefined) {
        const rawDept = bodyData.department !== undefined ? bodyData.department : bodyData.departmentId;
        if (!rawDept || rawDept === "null" || String(rawDept).trim() === "") {
          employee.department = null;
        } else {
          const trimmedDept = String(rawDept).trim();
          if (!mongoose.Types.ObjectId.isValid(trimmedDept)) {
            return res.status(400).json({ success: false, message: "Invalid Department ID" });
          }
          const deptExists = await DepartmentModel.findOne({ _id: trimmedDept, isDeleted: false });
          if (!deptExists) {
            return res.status(404).json({ success: false, message: "Selected department not found" });
          }
          employee.department = deptExists._id;
        }
      }

      if (bodyData.designation !== undefined || bodyData.designationId !== undefined) {
        const rawDesig = bodyData.designation !== undefined ? bodyData.designation : bodyData.designationId;
        if (!rawDesig || rawDesig === "null" || String(rawDesig).trim() === "") {
          employee.designation = null;
        } else {
          const trimmedDesig = String(rawDesig).trim();
          if (!mongoose.Types.ObjectId.isValid(trimmedDesig)) {
            return res.status(400).json({ success: false, message: "Invalid Designation ID" });
          }
          const desigExists = await DesignationModel.findOne({ _id: trimmedDesig, isDeleted: false });
          if (!desigExists) {
            return res.status(404).json({ success: false, message: "Selected designation not found" });
          }
          employee.designation = desigExists._id;
        }
      }

      if (bodyData.firstName || bodyData.lastName) {
        employee.name = `${employee.firstName || ""} ${employee.lastName || ""}`.trim();
      }
      if (bodyData.phoneNumber) {
        employee.phone = bodyData.phoneNumber;
      }

      if (bodyData.contactInfo) {
        employee.contactInfo = {
          ...employee.contactInfo?.toObject(),
          ...bodyData.contactInfo,
          address: {
            ...employee.contactInfo?.address?.toObject(),
            ...(bodyData.contactInfo.address || {}),
          },
        };
      }

      if (bodyData.shiftAndSchedule) {
        employee.shiftAndSchedule = {
          ...employee.shiftAndSchedule?.toObject(),
          ...bodyData.shiftAndSchedule,
        };
      }

      if (bodyData.emergencyContact) {
        employee.emergencyContact = {
          ...employee.emergencyContact?.toObject(),
          ...bodyData.emergencyContact,
        };
      }

      if (bodyData.additionalInfo) {
        employee.additionalInfo = {
          ...employee.additionalInfo?.toObject(),
          ...bodyData.additionalInfo,
        };
      }

      await employee.save();

      const populatedEmployee = await UserModel.findById(employee._id)
        .select("-password -otp")
        .populate("department", "departmentName icon color")
        .populate("designation", "designationName level icon");

      return res.status(200).json({
        success: true,
        message: "Employee profile updated successfully",
        result: populatedEmployee,
      });
    } catch (error) {
      console.error("Update Employee Error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Failed to update employee",
        error: error.message,
      });
    }
  }

  static async deleteEmployee(req, res) {
    try {
      const { id } = req.params;
      const employee = await UserModel.findById(id);

      if (!employee || employee.role !== "employee") {
        return res.status(404).json({ success: false, message: "Employee not found" });
      }

      if (employee.avatarUrl) {
        await deleteFileFromS3(employee.avatarUrl);
      }
      if (employee.documents) {
        const docFields = [
          "panCard",
          "aadhaarCard",
          "addressProof",
          "educationCertificate",
          "experienceLetter",
          "joiningLetter",
        ];
        for (const field of docFields) {
          if (employee.documents[field]) {
            await deleteFileFromS3(employee.documents[field]);
          }
        }
        if (Array.isArray(employee.documents.otherDocuments)) {
          for (const doc of employee.documents.otherDocuments) {
            if (doc?.url) {
              await deleteFileFromS3(doc.url);
            }
          }
        }
      }

      employee.isUserDeleted = true;
      employee.employeeStatus = "Terminated";
      await employee.save({ validateBeforeSave: false });

      return res.status(200).json({
        success: true,
        message: "Employee deleted successfully",
      });
    } catch (error) {
      console.error("Delete Employee Error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Failed to delete employee",
        error: error.message,
      });
    }
  }

  static async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const validStatuses = ["Active", "Inactive", "On Leave", "Terminated", "Probation"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        });
      }

      const employee = await UserModel.findById(id).select("-password -otp");
      if (!employee || employee.role !== "employee") {
        return res.status(404).json({ success: false, message: "Employee not found" });
      }

      employee.employeeStatus = status;
      await employee.save();

      return res.status(200).json({
        success: true,
        message: `Employee status updated to ${status}`,
        result: employee,
      });
    } catch (error) {
      console.error("Update Status Error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Failed to update employee status",
        error: error.message,
      });
    }
  }
}
