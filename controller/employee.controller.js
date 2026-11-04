import mongoose from "mongoose";
import UserModel from "../model/user.model.js";
import DepartmentModel from "../model/department.model.js";
import DesignationModel from "../model/designation.model.js";
import RoleModel from "../model/role.model.js";
import ShiftModel from "../model/shift.model.js";
import AttendanceModel from "../model/attendance.model.js";
import LeaveModel from "../model/leave.model.js";
import { uploadFile, deleteFileFromS3 } from "../middleware/imageupload.js";
import bcrypt from "bcryptjs";
import transporter from "../utils/Email.config.js";
import { recordAuditLog } from "../utils/auditLogger.js";

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
      if (typeof bodyData.salaryDetails === "string") {
        try { bodyData.salaryDetails = JSON.parse(bodyData.salaryDetails); } catch (e) { }
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

      if (
        bodyData.salary === undefined ||
        bodyData.salary === null ||
        String(bodyData.salary).trim() === "" ||
        isNaN(Number(bodyData.salary)) ||
        Number(bodyData.salary) <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Salary is required and must be a valid positive amount!",
        });
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

      let validRoleId = null;
      let validRoleTitle = null;
      const rawRole = bodyData.customRole || bodyData.roleId;
      if (rawRole && rawRole !== "null" && rawRole !== "undefined" && String(rawRole).trim() !== "") {
        const trimmedRole = String(rawRole).trim();
        if (mongoose.Types.ObjectId.isValid(trimmedRole)) {
          const roleDoc = await RoleModel.findOne({ _id: trimmedRole, isDeleted: false });
          if (roleDoc) {
            validRoleId = roleDoc._id;
            validRoleTitle = roleDoc.roleTitle;
          }
        }
      } else if (bodyData.roleTitle && bodyData.roleTitle.trim()) {
        const roleDoc = await RoleModel.findOne({
          roleTitle: { $regex: new RegExp(`^${bodyData.roleTitle.trim()}$`, "i") },
          isDeleted: false,
        });
        if (roleDoc) {
          validRoleId = roleDoc._id;
          validRoleTitle = roleDoc.roleTitle;
        }
      }

      const rawPassword = password || "Employee@123";
      const hashedPassword = await bcrypt.hash(rawPassword, 10);

      // Resolve Shift from ShiftModel (by ID from shift, shiftId, shiftAndSchedule, or shiftTiming name)
      let selectedShift = null;
      const requestedShiftId =
        bodyData.shift ||
        bodyData.shiftId ||
        bodyData.selectedShift ||
        (typeof bodyData.shiftAndSchedule === "string" && mongoose.Types.ObjectId.isValid(bodyData.shiftAndSchedule.trim())
          ? bodyData.shiftAndSchedule.trim()
          : null) ||
        (typeof shiftAndSchedule === "object"
          ? shiftAndSchedule?.shift || shiftAndSchedule?.shiftId || shiftAndSchedule?._id
          : null);

      if (requestedShiftId && mongoose.Types.ObjectId.isValid(String(requestedShiftId).trim())) {
        selectedShift = await ShiftModel.findById(String(requestedShiftId).trim());
      }

      const shiftNameQuery =
        (typeof shiftAndSchedule === "object" ? shiftAndSchedule?.shiftTiming : null) ||
        bodyData.shiftTiming;

      if (!selectedShift && shiftNameQuery && typeof shiftNameQuery === "string") {
        selectedShift = await ShiftModel.findOne({
          shiftName: { $regex: new RegExp(`^${shiftNameQuery.trim()}$`, "i") },
        });
      }

      if (!selectedShift) {
        selectedShift =
          (await ShiftModel.findOne({ isDefault: true })) ||
          (await ShiftModel.findOne().sort({ createdAt: 1 }));
      }

      // Resolve Salary and Optional Bank Details
      const sDetails =
        typeof bodyData.salaryDetails === "object" && bodyData.salaryDetails !== null
          ? bodyData.salaryDetails
          : {};

      const parsedSalary = Number(bodyData.salary);
      const parsedSalaryType = "Monthly";

      const basicSalary =
        sDetails.basicSalary !== undefined && sDetails.basicSalary !== ""
          ? Number(sDetails.basicSalary)
          : bodyData.basicSalary !== undefined && bodyData.basicSalary !== ""
            ? Number(bodyData.basicSalary)
            : Math.round(parsedSalary * 0.4);

      const hra =
        sDetails.hra !== undefined && sDetails.hra !== ""
          ? Number(sDetails.hra)
          : bodyData.hra !== undefined && bodyData.hra !== ""
            ? Number(bodyData.hra)
            : Math.round(basicSalary * 0.4);

      const allowances =
        sDetails.allowances !== undefined && sDetails.allowances !== ""
          ? Number(sDetails.allowances)
          : bodyData.allowances !== undefined && bodyData.allowances !== ""
            ? Number(bodyData.allowances)
            : parsedSalary > (basicSalary + hra)
              ? parsedSalary - (basicSalary + hra)
              : 0;

      // Optional Bank Details: paymentMethod, bankName, accountNumber, ifscCode
      const salaryCurrency = sDetails.currency || bodyData.currency || "INR";
      const salaryPaymentMethod = sDetails.paymentMethod || bodyData.paymentMethod || "Bank Transfer";
      const bankName = sDetails.bankName || bodyData.bankName || "";
      const accountNumber = sDetails.accountNumber || bodyData.accountNumber || "";
      const ifscCode = sDetails.ifscCode || bodyData.ifscCode || "";

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
        customRole: validRoleId,
        roleTitle: validRoleTitle,
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
        salary: parsedSalary,
        salaryType: parsedSalaryType,
        salaryDetails: {
          currency: salaryCurrency,
          basicSalary,
          hra,
          allowances,
          paymentMethod: salaryPaymentMethod,
          bankName,
          accountNumber,
          ifscCode,
        },
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
        shift: selectedShift ? selectedShift._id : null,
        shiftAndSchedule: {
          shift: selectedShift ? selectedShift._id : null,
          shiftTiming: selectedShift
            ? selectedShift.shiftName
            : ((typeof shiftAndSchedule === "object" ? shiftAndSchedule?.shiftTiming : null) || bodyData.shiftTiming || "General Shift"),
          weeklyOff:
            (typeof shiftAndSchedule === "object" ? shiftAndSchedule?.weeklyOff : null) ||
            bodyData.weeklyOff ||
            "Sat - Sun",
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
        .populate("designation", "designationName level icon")
        .populate("shift", "shiftName startTime endTime durationHours workHoursDisplay breakTime teaBreaks color")
        .populate("customRole", "roleTitle category badgeColor permissions");

      await recordAuditLog(req, {
        action: "Onboarded New Employee",
        category: "Employees",
        description: `Created employee profile for ${fullName} (${empId})`,
        targetResource: `${fullName} (${empId})`,
        diff: {
          before: "None",
          after: `Employee Status: ${employeeStatus || "Active"} (${empId})${parsedSalary > 0 ? `, Salary: ${parsedSalary} ${salaryCurrency}` : ""}`,
        },
      });

      const resultObj = populatedEmployee.toObject();
      resultObj.weeklyOff = employee.shiftAndSchedule?.weeklyOff || "Sat - Sun";
      delete resultObj.shiftAndSchedule;

      return res.status(201).json({
        success: true,
        message: "Employee profile created successfully!",
        result: resultObj,
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
        status,
        tab,
        employeeStatus,
        department,
        designation,
        shift,
        workLocation,
        page = 1,
        limit = 20,
        sortBy = "name_asc",
        order,
      } = req.query;

      const baseFilter = {
        role: "employee",
        isUserDeleted: { $ne: true },
      };

      const todayStr = new Date().toISOString().split("T")[0];

      const todayApprovedLeaves = await LeaveModel.find({
        status: "Approved",
        fromDate: { $lte: todayStr },
        toDate: { $gte: todayStr },
      }).select("employee");
      const onLeaveEmpIdStrings = todayApprovedLeaves.map((l) => String(l.employee));

      const [totalCount, activeCount, onLeaveExplicitCount, inactiveCount] = await Promise.all([
        UserModel.countDocuments(baseFilter),
        UserModel.countDocuments({
          ...baseFilter,
          employeeStatus: { $in: ["Active", "Probation"] },
        }),
        UserModel.countDocuments({
          ...baseFilter,
          $or: [
            { employeeStatus: "On Leave" },
            { _id: { $in: onLeaveEmpIdStrings } },
          ],
        }),
        UserModel.countDocuments({
          ...baseFilter,
          employeeStatus: { $in: ["Inactive", "Terminated"] },
        }),
      ]);

      const summary = {
        totalEmployees: totalCount,
        activeEmployees: activeCount,
        onLeaveEmployees: onLeaveExplicitCount,
        inactiveEmployees: inactiveCount,
      };

      const tabs = [
        { label: "All", key: "all", count: totalCount },
        { label: "Active", key: "active", count: activeCount },
        { label: "On Leave", key: "on_leave", count: onLeaveExplicitCount },
        { label: "Inactive", key: "inactive", count: inactiveCount },
      ];

      const filter = { ...baseFilter };

      const selectedStatus = String(status || tab || employeeStatus || "").trim().toLowerCase();
      if (selectedStatus && selectedStatus !== "all") {
        if (selectedStatus === "active") {
          filter.employeeStatus = { $in: ["Active", "Probation"] };
        } else if (selectedStatus === "on_leave" || selectedStatus === "on leave" || selectedStatus === "leave") {
          filter.$or = [
            { employeeStatus: "On Leave" },
            { _id: { $in: onLeaveEmpIdStrings } },
          ];
        } else if (selectedStatus === "inactive" || selectedStatus === "terminated") {
          filter.employeeStatus = { $in: ["Inactive", "Terminated"] };
        } else {
          filter.employeeStatus = new RegExp(`^${selectedStatus}$`, "i");
        }
      }

      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        const [matchingDepts, matchingDesigs] = await Promise.all([
          DepartmentModel.find({ departmentName: regex, isDeleted: false }).select("_id"),
          DesignationModel.find({ designationName: regex, isDeleted: false }).select("_id"),
        ]);
        const deptIds = matchingDepts.map((d) => d._id);
        const desigIds = matchingDesigs.map((d) => d._id);

        const searchConditions = [
          { name: regex },
          { firstName: regex },
          { lastName: regex },
          { email: regex },
          { employeeId: regex },
          { phone: regex },
          { roleTitle: regex },
          { department: { $in: deptIds } },
          { designation: { $in: desigIds } },
        ];

        if (filter.$or) {
          filter.$and = [{ $or: filter.$or }, { $or: searchConditions }];
          delete filter.$or;
        } else {
          filter.$or = searchConditions;
        }
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

      if (shift && shift.trim()) {
        const trimmedShift = shift.trim();
        if (mongoose.Types.ObjectId.isValid(trimmedShift)) {
          const shiftCondition = {
            $or: [{ shift: trimmedShift }, { "shiftAndSchedule.shift": trimmedShift }],
          };
          if (filter.$or) {
            filter.$and = [{ $or: filter.$or }, shiftCondition];
            delete filter.$or;
          } else {
            filter.$or = shiftCondition.$or;
          }
        } else {
          const matchingShifts = await ShiftModel.find({
            shiftName: new RegExp(trimmedShift, "i"),
          }).select("_id shiftName");
          const shiftIds = matchingShifts.map((s) => s._id);
          const shiftNames = matchingShifts.map((s) => s.shiftName);
          const shiftConditions = [
            { shift: { $in: shiftIds } },
            { "shiftAndSchedule.shift": { $in: shiftIds } },
            { "shiftAndSchedule.shiftTiming": { $in: shiftNames } },
          ];
          if (filter.$or) {
            filter.$and = [{ $or: filter.$or }, { $or: shiftConditions }];
            delete filter.$or;
          } else {
            filter.$or = shiftConditions;
          }
        }
      }

      if (workLocation) {
        filter.workLocation = new RegExp(`^${workLocation.trim()}$`, "i");
      }

      const sortOptions = [
        { key: "name_asc", label: "Name (A to Z)", icon: "sort-alpha-down" },
        { key: "name_desc", label: "Name (Z to A)", icon: "sort-alpha-up" },
        { key: "employee_id", label: "Employee ID", icon: "id-badge" },
        { key: "department", label: "Department", icon: "building" },
        { key: "role", label: "Role", icon: "briefcase" },
        { key: "highest_salary", label: "Highest Salary", icon: "arrow-up" },
        { key: "lowest_salary", label: "Lowest Salary", icon: "arrow-down" },
        { key: "highest_attendance", label: "Highest Attendance", icon: "trending-up" },
      ];

      const rawSort = String(sortBy || "").trim().toLowerCase();
      let normalizedSort = "name_asc";

      if (
        rawSort === "name_asc" ||
        rawSort === "name_a_z" ||
        rawSort === "name-a-z" ||
        rawSort === "a-z" ||
        rawSort === "a_z" ||
        rawSort === "name (a to z)" ||
        (rawSort === "name" && (order === "asc" || !order))
      ) {
        normalizedSort = "name_asc";
      } else if (
        rawSort === "name_desc" ||
        rawSort === "name_z_a" ||
        rawSort === "name-z-a" ||
        rawSort === "z-a" ||
        rawSort === "z_a" ||
        rawSort === "name (z to a)" ||
        (rawSort === "name" && order === "desc")
      ) {
        normalizedSort = "name_desc";
      } else if (
        rawSort === "employee_id" ||
        rawSort === "employeeid" ||
        rawSort === "employee-id" ||
        rawSort === "employee id" ||
        rawSort === "id"
      ) {
        normalizedSort = "employee_id";
      } else if (rawSort === "department") {
        normalizedSort = "department";
      } else if (rawSort === "role" || rawSort === "designation") {
        normalizedSort = "role";
      } else if (
        rawSort === "highest_salary" ||
        rawSort === "highest-salary" ||
        rawSort === "highest_sal" ||
        rawSort === "salary_high" ||
        rawSort === "highest salary" ||
        (rawSort === "salary" && order === "desc")
      ) {
        normalizedSort = "highest_salary";
      } else if (
        rawSort === "lowest_salary" ||
        rawSort === "lowest-salary" ||
        rawSort === "lowest_sal" ||
        rawSort === "salary_low" ||
        rawSort === "lowest salary" ||
        (rawSort === "salary" && order === "asc")
      ) {
        normalizedSort = "lowest_salary";
      } else if (
        rawSort === "highest_attendance" ||
        rawSort === "highest-attendance" ||
        rawSort === "attendance" ||
        rawSort === "highest attendance"
      ) {
        normalizedSort = "highest_attendance";
      } else if (rawSort === "createdat" || rawSort === "created_at") {
        normalizedSort = order === "asc" ? "name_asc" : "name_desc";
      }

      const matchedEmployees = await UserModel.find(filter)
        .select("-password -otp")
        .populate("department", "departmentName icon color")
        .populate("designation", "designationName designationTitle level icon")
        .populate("shift", "shiftName startTime endTime durationHours workHoursDisplay breakTime teaBreaks color")
        .populate("customRole", "roleTitle category badgeColor permissions");

      const attendanceAgg = await AttendanceModel.aggregate([
        {
          $match: {
            status: { $in: ["Present", "Late", "Regularized", "Half Day"] },
          },
        },
        {
          $group: {
            _id: "$employee",
            presentDays: { $sum: 1 },
          },
        },
      ]);
      const attendanceMap = new Map();
      attendanceAgg.forEach((a) => attendanceMap.set(String(a._id), a.presentDays));

      let formattedEmployees = matchedEmployees.map((emp) => {
        const obj = emp.toObject();
        obj.weeklyOff = emp.shiftAndSchedule?.weeklyOff || "Sat - Sun";
        obj.presentDays = attendanceMap.get(String(emp._id)) || 0;
        obj.roleTitle =
          emp.designation?.designationName ||
          emp.designation?.designationTitle ||
          emp.roleTitle ||
          "Team Member";
        obj.departmentName = emp.department?.departmentName || "General";
        delete obj.shiftAndSchedule;
        return obj;
      });

      switch (normalizedSort) {
        case "name_asc":
          formattedEmployees.sort((a, b) =>
            (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" })
          );
          break;
        case "name_desc":
          formattedEmployees.sort((a, b) =>
            (b.name || "").localeCompare(a.name || "", undefined, { sensitivity: "base" })
          );
          break;
        case "employee_id":
          formattedEmployees.sort((a, b) =>
            (a.employeeId || "").localeCompare(b.employeeId || "", undefined, { numeric: true })
          );
          break;
        case "department":
          formattedEmployees.sort((a, b) =>
            (a.departmentName || "").localeCompare(b.departmentName || "")
          );
          break;
        case "role":
          formattedEmployees.sort((a, b) =>
            (a.roleTitle || "").localeCompare(b.roleTitle || "")
          );
          break;
        case "highest_salary":
          formattedEmployees.sort(
            (a, b) => Number(b.salary || 0) - Number(a.salary || 0)
          );
          break;
        case "lowest_salary":
          formattedEmployees.sort(
            (a, b) => Number(a.salary || 0) - Number(b.salary || 0)
          );
          break;
        case "highest_attendance":
          formattedEmployees.sort((a, b) => b.presentDays - a.presentDays);
          break;
        default:
          formattedEmployees.sort((a, b) =>
            (a.name || "").localeCompare(b.name || "")
          );
      }

      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.max(1, parseInt(limit, 10));
      const total = formattedEmployees.length;
      const skip = (pageNum - 1) * limitNum;
      const paginatedEmployees = formattedEmployees.slice(skip, skip + limitNum);

      return res.status(200).json({
        success: true,
        message: "Employees fetched successfully",
        result: {
          summary,
          tabs,
          sortOptions,
          activeSort: normalizedSort,
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum) || 1,
          employees: paginatedEmployees,
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
        .populate("designation", "designationName level icon")
        .populate("shift", "shiftName startTime endTime durationHours workHoursDisplay breakTime teaBreaks color")
        .populate("customRole", "roleTitle category badgeColor permissions");

      if (!employee) {
        return res.status(404).json({
          success: false,
          message: "Employee not found",
        });
      }

      const obj = employee.toObject();
      obj.weeklyOff = employee.shiftAndSchedule?.weeklyOff || "Sat - Sun";
      delete obj.shiftAndSchedule;

      return res.status(200).json({
        success: true,
        message: "Employee details fetched successfully",
        result: obj,
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
      if (typeof bodyData.salaryDetails === "string") {
        try { bodyData.salaryDetails = JSON.parse(bodyData.salaryDetails); } catch (e) { }
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

      if (bodyData.customRole !== undefined || bodyData.roleId !== undefined) {
        const rawRole = bodyData.customRole !== undefined ? bodyData.customRole : bodyData.roleId;
        if (!rawRole || rawRole === "null" || String(rawRole).trim() === "") {
          employee.customRole = null;
          employee.roleTitle = null;
        } else {
          const trimmedRole = String(rawRole).trim();
          if (mongoose.Types.ObjectId.isValid(trimmedRole)) {
            const roleDoc = await RoleModel.findOne({ _id: trimmedRole, isDeleted: false });
            if (roleDoc) {
              employee.customRole = roleDoc._id;
              employee.roleTitle = roleDoc.roleTitle;
            }
          }
        }
      } else if (bodyData.roleTitle !== undefined) {
        if (!bodyData.roleTitle || String(bodyData.roleTitle).trim() === "") {
          employee.customRole = null;
          employee.roleTitle = null;
        } else {
          const roleDoc = await RoleModel.findOne({
            roleTitle: { $regex: new RegExp(`^${String(bodyData.roleTitle).trim()}$`, "i") },
            isDeleted: false,
          });
          if (roleDoc) {
            employee.customRole = roleDoc._id;
            employee.roleTitle = roleDoc.roleTitle;
          }
        }
      }

      if (bodyData.firstName || bodyData.lastName) {
        employee.name = `${employee.firstName || ""} ${employee.lastName || ""}`.trim();
      }
      if (bodyData.phoneNumber) {
        employee.phone = bodyData.phoneNumber;
      }

      // Update contactInfo (supporting both nested contactInfo object and flat fields like personalEmail, mobileNumber, addressLine1, city, etc.)
      const contactObj = typeof bodyData.contactInfo === "object" ? bodyData.contactInfo : {};
      const currentContact = employee.contactInfo?.toObject() || {};
      const currentAddress = currentContact.address || {};

      const personalEmail =
        bodyData.personalEmail !== undefined ? bodyData.personalEmail : contactObj.personalEmail;
      const mobileNumber =
        bodyData.mobileNumber !== undefined
          ? bodyData.mobileNumber
          : bodyData.phoneNumber !== undefined
            ? bodyData.phoneNumber
            : contactObj.mobileNumber;
      const alternatePhone =
        bodyData.alternatePhone !== undefined ? bodyData.alternatePhone : contactObj.alternatePhone;

      const addressLine1 =
        bodyData.addressLine1 !== undefined
          ? bodyData.addressLine1
          : bodyData.address !== undefined
            ? bodyData.address
            : contactObj.address?.addressLine1;
      const addressLine2 =
        bodyData.addressLine2 !== undefined ? bodyData.addressLine2 : contactObj.address?.addressLine2;
      const city = bodyData.city !== undefined ? bodyData.city : contactObj.address?.city;
      const state = bodyData.state !== undefined ? bodyData.state : contactObj.address?.state;
      const country =
        bodyData.country !== undefined ? bodyData.country : (contactObj.address?.country || currentAddress.country || "India");
      const zipCode =
        bodyData.zipCode !== undefined
          ? bodyData.zipCode
          : bodyData.postalCode !== undefined
            ? bodyData.postalCode
            : contactObj.address?.zipCode;

      employee.contactInfo = {
        personalEmail: personalEmail !== undefined ? String(personalEmail).trim() : currentContact.personalEmail || "",
        mobileNumber: mobileNumber !== undefined ? String(mobileNumber).trim() : currentContact.mobileNumber || "",
        alternatePhone: alternatePhone !== undefined ? String(alternatePhone).trim() : currentContact.alternatePhone || "",
        address: {
          addressLine1: addressLine1 !== undefined ? String(addressLine1).trim() : currentAddress.addressLine1 || "",
          addressLine2: addressLine2 !== undefined ? String(addressLine2).trim() : currentAddress.addressLine2 || "",
          city: city !== undefined ? String(city).trim() : currentAddress.city || "",
          state: state !== undefined ? String(state).trim() : currentAddress.state || "",
          country: country !== undefined ? String(country).trim() : currentAddress.country || "India",
          zipCode: zipCode !== undefined ? String(zipCode).trim() : currentAddress.zipCode || "",
        },
      };

      // Handle shift update (supporting shift, shiftId, or shiftAndSchedule as ID string or object)
      const targetShiftId =
        bodyData.shift ||
        bodyData.shiftId ||
        bodyData.selectedShift ||
        (typeof bodyData.shiftAndSchedule === "string" && mongoose.Types.ObjectId.isValid(bodyData.shiftAndSchedule.trim())
          ? bodyData.shiftAndSchedule.trim()
          : null) ||
        (typeof bodyData.shiftAndSchedule === "object"
          ? bodyData.shiftAndSchedule?.shift || bodyData.shiftAndSchedule?.shiftId || bodyData.shiftAndSchedule?._id
          : null);

      const targetWeeklyOff =
        bodyData.weeklyOff ||
        (typeof bodyData.shiftAndSchedule === "object" ? bodyData.shiftAndSchedule?.weeklyOff : null);

      const targetShiftName =
        bodyData.shiftTiming ||
        (typeof bodyData.shiftAndSchedule === "object" ? bodyData.shiftAndSchedule?.shiftTiming : null);

      if (targetShiftId && String(targetShiftId).trim() !== "" && String(targetShiftId) !== "null") {
        const trimmedShiftId = String(targetShiftId).trim();
        if (!mongoose.Types.ObjectId.isValid(trimmedShiftId)) {
          return res.status(400).json({ success: false, message: "Invalid Shift ID" });
        }
        const foundShift = await ShiftModel.findById(trimmedShiftId);
        if (!foundShift) {
          return res.status(404).json({ success: false, message: "Selected shift not found" });
        }
        employee.shift = foundShift._id;
        employee.shiftAndSchedule = {
          ...employee.shiftAndSchedule?.toObject(),
          shift: foundShift._id,
          shiftTiming: foundShift.shiftName,
          weeklyOff: targetWeeklyOff || employee.shiftAndSchedule?.weeklyOff || "Sat - Sun",
        };
      } else if (targetShiftName && typeof targetShiftName === "string" && targetShiftName.trim() !== "") {
        const foundShift = await ShiftModel.findOne({
          shiftName: { $regex: new RegExp(`^${targetShiftName.trim()}$`, "i") },
        });
        if (foundShift) {
          employee.shift = foundShift._id;
          employee.shiftAndSchedule = {
            ...employee.shiftAndSchedule?.toObject(),
            shift: foundShift._id,
            shiftTiming: foundShift.shiftName,
            weeklyOff: targetWeeklyOff || employee.shiftAndSchedule?.weeklyOff || "Sat - Sun",
          };
        }
      } else if (bodyData.shift === null || bodyData.shift === "null" || bodyData.shiftId === null || bodyData.shiftId === "null") {
        employee.shift = null;
        employee.shiftAndSchedule = {
          shift: null,
          shiftTiming: "General Shift",
          weeklyOff: targetWeeklyOff || employee.shiftAndSchedule?.weeklyOff || "Sat - Sun",
        };
      } else if (targetWeeklyOff) {
        employee.shiftAndSchedule = {
          ...employee.shiftAndSchedule?.toObject(),
          weeklyOff: targetWeeklyOff,
        };
      }

      // Update emergencyContact (supporting both nested object and flat fields like emergencyContactName, emergencyRelationship, emergencyPhoneNumber, etc.)
      const emergencyObj = typeof bodyData.emergencyContact === "object" ? bodyData.emergencyContact : {};
      const currentEmergency = employee.emergencyContact?.toObject() || {};

      const contactName =
        bodyData.emergencyContactName !== undefined
          ? bodyData.emergencyContactName
          : bodyData.contactName !== undefined
            ? bodyData.contactName
            : emergencyObj.contactName;

      const relationship =
        bodyData.emergencyRelationship !== undefined
          ? bodyData.emergencyRelationship
          : bodyData.relationship !== undefined
            ? bodyData.relationship
            : emergencyObj.relationship;

      const emergencyPhone =
        bodyData.emergencyPhoneNumber !== undefined
          ? bodyData.emergencyPhoneNumber
          : bodyData.emergencyPhone !== undefined
            ? bodyData.emergencyPhone
            : emergencyObj.phoneNumber;

      const emergencyAltPhone =
        bodyData.emergencyAlternatePhone !== undefined
          ? bodyData.emergencyAlternatePhone
          : emergencyObj.alternatePhone;

      employee.emergencyContact = {
        contactName: contactName !== undefined ? String(contactName).trim() : currentEmergency.contactName || "",
        relationship: relationship !== undefined ? String(relationship).trim() : currentEmergency.relationship || "",
        phoneNumber: emergencyPhone !== undefined ? String(emergencyPhone).trim() : currentEmergency.phoneNumber || "",
        alternatePhone: emergencyAltPhone !== undefined ? String(emergencyAltPhone).trim() : currentEmergency.alternatePhone || "",
      };

      // Update additionalInfo (supporting both nested object and flat fields like employmentNotes)
      const addInfoObj = typeof bodyData.additionalInfo === "object" ? bodyData.additionalInfo : {};
      const currentAddInfo = employee.additionalInfo?.toObject() || {};

      const employmentNotes =
        bodyData.employmentNotes !== undefined
          ? bodyData.employmentNotes
          : addInfoObj.employmentNotes;

      employee.additionalInfo = {
        employmentNotes: employmentNotes !== undefined ? String(employmentNotes).trim() : currentAddInfo.employmentNotes || "",
      };

      // Update documents (supporting URLs passed in body)
      if (!employee.documents) {
        employee.documents = {
          panCard: null,
          aadhaarCard: null,
          addressProof: null,
          educationCertificate: null,
          experienceLetter: null,
          joiningLetter: null,
          otherDocuments: [],
        };
      }
      const docFields = [
        "panCard", "aadhaarCard", "addressProof", "educationCertificate",
        "experienceLetter", "joiningLetter"
      ];
      docFields.forEach((field) => {
        if (bodyData[field] !== undefined && typeof bodyData[field] === "string" && bodyData[field].trim() !== "") {
          employee.documents[field] = bodyData[field].trim();
        }
      });
      if (bodyData.documents && typeof bodyData.documents === "object") {
        docFields.forEach((field) => {
          if (bodyData.documents[field] !== undefined && typeof bodyData.documents[field] === "string" && bodyData.documents[field].trim() !== "") {
            employee.documents[field] = bodyData.documents[field].trim();
          }
        });
      }

      // Update Salary & Compensation Details (Optional in update)
      if (bodyData.salary !== undefined && bodyData.salary !== null && String(bodyData.salary).trim() !== "") {
        const num = Number(bodyData.salary);
        if (isNaN(num) || num <= 0) {
          return res.status(400).json({
            success: false,
            message: "Salary must be a valid positive amount!",
          });
        }
        employee.salary = num;
      }

      employee.salaryType = "Monthly";

      const updateSalaryDetailsObj =
        typeof bodyData.salaryDetails === "object" && bodyData.salaryDetails !== null
          ? bodyData.salaryDetails
          : {};
      const currentSalaryDetails = employee.salaryDetails?.toObject() || {};

      const hasSalaryDetailsPayload =
        bodyData.salaryDetails !== undefined ||
        bodyData.basicSalary !== undefined ||
        bodyData.hra !== undefined ||
        bodyData.allowances !== undefined ||
        bodyData.paymentMethod !== undefined ||
        bodyData.bankName !== undefined ||
        bodyData.accountNumber !== undefined ||
        bodyData.ifscCode !== undefined ||
        bodyData.currency !== undefined;

      if (hasSalaryDetailsPayload) {
        const updatedBasicSalary =
          updateSalaryDetailsObj.basicSalary !== undefined && updateSalaryDetailsObj.basicSalary !== ""
            ? Number(updateSalaryDetailsObj.basicSalary)
            : bodyData.basicSalary !== undefined && bodyData.basicSalary !== ""
              ? Number(bodyData.basicSalary)
              : currentSalaryDetails.basicSalary !== undefined
                ? currentSalaryDetails.basicSalary
                : employee.salary > 0
                  ? Math.round(employee.salary * 0.4)
                  : 0;

        const updatedHra =
          updateSalaryDetailsObj.hra !== undefined && updateSalaryDetailsObj.hra !== ""
            ? Number(updateSalaryDetailsObj.hra)
            : bodyData.hra !== undefined && bodyData.hra !== ""
              ? Number(bodyData.hra)
              : currentSalaryDetails.hra !== undefined
                ? currentSalaryDetails.hra
                : updatedBasicSalary > 0
                  ? Math.round(updatedBasicSalary * 0.4)
                  : 0;

        const updatedAllowances =
          updateSalaryDetailsObj.allowances !== undefined && updateSalaryDetailsObj.allowances !== ""
            ? Number(updateSalaryDetailsObj.allowances)
            : bodyData.allowances !== undefined && bodyData.allowances !== ""
              ? Number(bodyData.allowances)
              : currentSalaryDetails.allowances !== undefined
                ? currentSalaryDetails.allowances
                : employee.salary > (updatedBasicSalary + updatedHra)
                  ? employee.salary - (updatedBasicSalary + updatedHra)
                  : 0;

        employee.salaryDetails = {
          currency:
            updateSalaryDetailsObj.currency !== undefined
              ? String(updateSalaryDetailsObj.currency).trim()
              : bodyData.currency !== undefined
                ? String(bodyData.currency).trim()
                : currentSalaryDetails.currency || "INR",
          basicSalary: isNaN(updatedBasicSalary) ? 0 : updatedBasicSalary,
          hra: isNaN(updatedHra) ? 0 : updatedHra,
          allowances: isNaN(updatedAllowances) ? 0 : updatedAllowances,
          paymentMethod:
            updateSalaryDetailsObj.paymentMethod !== undefined
              ? updateSalaryDetailsObj.paymentMethod
              : bodyData.paymentMethod !== undefined
                ? bodyData.paymentMethod
                : currentSalaryDetails.paymentMethod || "Bank Transfer",
          bankName:
            updateSalaryDetailsObj.bankName !== undefined
              ? String(updateSalaryDetailsObj.bankName).trim()
              : bodyData.bankName !== undefined
                ? String(bodyData.bankName).trim()
                : currentSalaryDetails.bankName || "",
          accountNumber:
            updateSalaryDetailsObj.accountNumber !== undefined
              ? String(updateSalaryDetailsObj.accountNumber).trim()
              : bodyData.accountNumber !== undefined
                ? String(bodyData.accountNumber).trim()
                : currentSalaryDetails.accountNumber || "",
          ifscCode:
            updateSalaryDetailsObj.ifscCode !== undefined
              ? String(updateSalaryDetailsObj.ifscCode).trim()
              : bodyData.ifscCode !== undefined
                ? String(bodyData.ifscCode).trim()
                : currentSalaryDetails.ifscCode || "",
        };
      } else if (bodyData.salary !== undefined && (!employee.salaryDetails || !employee.salaryDetails.basicSalary)) {
        const basic = Math.round(employee.salary * 0.4);
        const hra = Math.round(basic * 0.4);
        const allowances = Math.max(0, employee.salary - (basic + hra));
        employee.salaryDetails = {
          ...currentSalaryDetails,
          currency: currentSalaryDetails.currency || "INR",
          basicSalary: basic,
          hra: hra,
          allowances: allowances,
          paymentMethod: currentSalaryDetails.paymentMethod || "Bank Transfer",
        };
      }

      await employee.save();

      const populatedEmployee = await UserModel.findById(employee._id)
        .select("-password -otp")
        .populate("department", "departmentName icon color")
        .populate("designation", "designationName level icon")
        .populate("shift", "shiftName startTime endTime durationHours workHoursDisplay breakTime teaBreaks color")
        .populate("customRole", "roleTitle category badgeColor permissions");

      const resultObj = populatedEmployee.toObject();
      resultObj.weeklyOff = employee.shiftAndSchedule?.weeklyOff || "Sat - Sun";
      delete resultObj.shiftAndSchedule;

      return res.status(200).json({
        success: true,
        message: "Employee profile updated successfully",
        result: resultObj,
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

      const oldStatus = employee.employeeStatus || "Active";
      employee.isUserDeleted = true;
      employee.employeeStatus = "Terminated";
      await employee.save({ validateBeforeSave: false });

      await recordAuditLog(req, {
        action: "Employee Terminated",
        category: "Employees",
        description: `Terminated employee profile for ${employee.name || employee.firstName || "Employee"} (${employee.employeeId || ""})`,
        targetResource: `${employee.name || employee.firstName || "Employee"} (${employee.employeeId || ""})`,
        diff: {
          before: `Employee Status: ${oldStatus}`,
          after: "Employee Status: Terminated",
        },
      });

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

      const oldStatus = employee.employeeStatus || "Probation";
      employee.employeeStatus = status;
      await employee.save();

      await recordAuditLog(req, {
        action: `Status Change to ${status}`,
        category: "Employees",
        description: `Completed probation review for ${employee.name || employee.firstName || "Employee"} (${employee.employeeId || ""})`,
        targetResource: `${employee.name || employee.firstName || "Employee"} (${employee.employeeId || ""})`,
        diff: {
          before: `Employee Status: ${oldStatus}`,
          after: `Employee Status: ${status}`,
        },
      });

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
