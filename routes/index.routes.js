import express from "express";
import { AuthController } from "../controller/auth.controller.js";
import { EmployeeController } from "../controller/employee.controller.js";
import { DepartmentController } from "../controller/department.controller.js";
import { DesignationController } from "../controller/designation.controller.js";
import { LeaveTypeController } from "../controller/leaveType.controller.js";
import { HolidayController } from "../controller/holiday.controller.js";
import { AttendanceRuleController } from "../controller/attendanceRule.controller.js";
import {
  getProfile,
  updateProfile,
  getSettings,
  updateSettings,
  getAnalytics,
  getInsights,
  recordCompletedLesson,
  deleteAccount,
} from "../controller/user.controller.js";
import { UserAuth, adminAuth, employeeAuth, requireSubscription } from "../middleware/auth.middleware.js";
import { upload, listBucketObjects, deleteManyFromS3 } from "../middleware/imageupload.js";
import {
  sendResponse,
  sendSuccessResponse,
  sendErrorResponse,
  sendBadRequestResponse,
} from "../utils/Response.utils.js";

const indexRouter = express.Router();

const employeeUploadFields = upload.fields([
  { name: "profilePhoto", maxCount: 1 },
  { name: "panCard", maxCount: 1 },
  { name: "aadhaarCard", maxCount: 1 },
  { name: "addressProof", maxCount: 1 },
  { name: "educationCertificate", maxCount: 1 },
  { name: "experienceLetter", maxCount: 1 },
  { name: "joiningLetter", maxCount: 1 },
]);

indexRouter.post("/auth/send-register-otp", AuthController.sendRegisterOtp);
indexRouter.post("/auth/verify-register-otp", AuthController.verifyRegisterOtp);
indexRouter.post("/auth/create-password", AuthController.createPassword);

indexRouter.post("/auth/login", AuthController.login);

indexRouter.post("/auth/forgot-password", AuthController.sendForgotMailOtp);
indexRouter.post("/auth/verify-otp", AuthController.verifyForgetOtp);
indexRouter.post("/auth/reset-password", AuthController.resetPassword);

indexRouter.post("/addEmployee", UserAuth, adminAuth, employeeUploadFields, EmployeeController.addEmployee);
indexRouter.get("/getAllEmployees", UserAuth, adminAuth, EmployeeController.getAllEmployees);
indexRouter.get("/getEmployeeById/:id", UserAuth, EmployeeController.getEmployeeById);
indexRouter.patch("/updateEmployee/:id", UserAuth, adminAuth, employeeUploadFields, EmployeeController.updateEmployee);
indexRouter.patch("/updateStatus/:id", UserAuth, adminAuth, EmployeeController.updateStatus);
indexRouter.delete("/deleteEmployee/:id", UserAuth, adminAuth, EmployeeController.deleteEmployee);

indexRouter.post("/addDepartment", UserAuth, adminAuth, upload.single("icon"), DepartmentController.addDepartment);
indexRouter.get("/getAllDepartments", UserAuth, DepartmentController.getAllDepartments);
indexRouter.get("/getDepartmentById/:id", UserAuth, DepartmentController.getDepartmentById);
indexRouter.patch("/updateDepartment/:id", UserAuth, adminAuth, upload.single("icon"), DepartmentController.updateDepartment);
indexRouter.delete("/deleteDepartment/:id", UserAuth, adminAuth, DepartmentController.deleteDepartment);
indexRouter.get("/getDepartmentHeadsList", UserAuth, adminAuth, DepartmentController.getDepartmentHeadsList);

indexRouter.post("/addDesignation", UserAuth, adminAuth, upload.single("icon"), DesignationController.addDesignation);
indexRouter.get("/getAllDesignations", UserAuth, DesignationController.getAllDesignations);
indexRouter.get("/getDesignationById/:id", UserAuth, DesignationController.getDesignationById);
indexRouter.patch("/updateDesignation/:id", UserAuth, adminAuth, upload.single("icon"), DesignationController.updateDesignation);
indexRouter.delete("/deleteDesignation/:id", UserAuth, adminAuth, DesignationController.deleteDesignation);
indexRouter.get("/getDesignationLevels", DesignationController.getDesignationLevels);

indexRouter.post("/addLeaveType", UserAuth, adminAuth, upload.single("icon"), LeaveTypeController.addLeaveType);
indexRouter.get("/getAllLeaveTypes", UserAuth, LeaveTypeController.getAllLeaveTypes);
indexRouter.get("/getLeaveTypeById/:id", UserAuth, LeaveTypeController.getLeaveTypeById);
indexRouter.patch("/updateLeaveType/:id", UserAuth, adminAuth, upload.single("icon"), LeaveTypeController.updateLeaveType);
indexRouter.delete("/deleteLeaveType/:id", UserAuth, adminAuth, LeaveTypeController.deleteLeaveType);
indexRouter.post("/seedDefaultLeaveTypes", UserAuth, adminAuth, LeaveTypeController.seedDefaultLeaveTypes);

indexRouter.post("/addHoliday", UserAuth, adminAuth, HolidayController.addHoliday);
indexRouter.get("/getAllHolidays", UserAuth, HolidayController.getAllHolidays);
indexRouter.get("/getHolidayById/:id", UserAuth, HolidayController.getHolidayById);
indexRouter.patch("/updateHoliday/:id", UserAuth, adminAuth, HolidayController.updateHoliday);
indexRouter.delete("/deleteHoliday/:id", UserAuth, adminAuth, HolidayController.deleteHoliday);
indexRouter.get("/getHolidayCalendar", UserAuth, HolidayController.getCalendarHolidays);

indexRouter.get("/getAttendanceRules", UserAuth, AttendanceRuleController.getAttendanceRules);
indexRouter.patch("/updateAttendanceRules", UserAuth, adminAuth, AttendanceRuleController.updateAllAttendanceRules);
indexRouter.patch("/updateWorkingHours", UserAuth, adminAuth, AttendanceRuleController.updateWorkingHours);
indexRouter.patch("/updateGraceTime", UserAuth, adminAuth, AttendanceRuleController.updateGraceTime);
indexRouter.patch("/updateBreakTime", UserAuth, adminAuth, AttendanceRuleController.updateBreakTime);
indexRouter.patch("/updateOvertimeRules", UserAuth, adminAuth, AttendanceRuleController.updateOvertimeRules);
indexRouter.patch("/updateAutoAttendance", UserAuth, adminAuth, AttendanceRuleController.updateAutoAttendance);
indexRouter.patch("/updateGeofencing", UserAuth, adminAuth, AttendanceRuleController.updateGeofencing);
indexRouter.patch("/updateIpRestriction", UserAuth, adminAuth, AttendanceRuleController.updateIpRestriction);

indexRouter.post("/auth/change-password", UserAuth, AuthController.changePassword);

indexRouter.get("/auth/me", UserAuth, AuthController.getUser);
indexRouter.post("/auth/logout", UserAuth, AuthController.logout);
indexRouter.patch("/auth/update-fcm-token", UserAuth, AuthController.updateFcmToken);

indexRouter.patch("/user/updateProfile", UserAuth, upload.single("avatar"), updateProfile);
indexRouter.get("/user/getProfile", UserAuth, getProfile);

indexRouter.patch("/user/updateSettings", UserAuth, updateSettings);
indexRouter.get("/user/getSettings", UserAuth, getSettings);

indexRouter.patch("/user/updateAnalytics", UserAuth, requireSubscription, recordCompletedLesson);
indexRouter.get("/user/getAnalytics", UserAuth, getAnalytics);
indexRouter.get("/user/getInsights", UserAuth, getInsights);

indexRouter.delete("/user/deleteAccount", UserAuth, deleteAccount);

indexRouter.get("/list", async (req, res) => {
  try {
    const images = await listBucketObjects();

    return sendSuccessResponse(res, "Get all images successfully", {
      total: images.length,
      images: images.map((e) => `${e.url}`),
    });
  } catch (error) {
    console.log("ERROR WHILE GET ALL IMAGE FROM S3:", error);
    return sendErrorResponse(res, 500, "ERROR WHILE GET ALL IMAGE FROM S3", error);
  }
});

indexRouter.delete("/deleteMany", async (req, res) => {
  try {
    const { images } = req.body;
    if (!Array.isArray(images) || !images.length) return sendBadRequestResponse(res, "URLs array required");

    const keys = images
      .map((url) => {
        if (String(url).includes(".amazonaws.com/")) {
          return String(url).split(".amazonaws.com/")[1];
        } else if (String(url).includes("/uploads/")) {
          return String(url).split("/uploads/")[1];
        } else {
          return String(url).substring(String(url).lastIndexOf("/") + 1);
        }
      })
      .filter(Boolean);

    if (!keys.length) return sendBadRequestResponse(res, "Invalid URLs");

    await deleteManyFromS3(keys);

    return sendSuccessResponse(res, "Deleted multiple files", {
      deleted: keys.length,
      keys,
    });
  } catch (error) {
    return sendErrorResponse(res, 500, "Delete many error", error);
  }
});

export default indexRouter;