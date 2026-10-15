import AttendanceRuleModel from "../model/attendanceRule.model.js";
import UserModel from "../model/user.model.js";
import {
  sendSuccessResponse,
  sendErrorResponse,
  sendBadRequestResponse,
} from "../utils/Response.utils.js";

const parseTimeToMinutes = (timeStr) => {
  if (!timeStr) return null;
  const match = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const meridiem = match[3] ? match[3].toUpperCase() : null;

  if (meridiem === "PM" && hours < 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;

  return hours * 60 + minutes;
};

const calculateTotalHours = (startTime, endTime) => {
  const startMin = parseTimeToMinutes(startTime);
  const endMin = parseTimeToMinutes(endTime);

  if (startMin === null || endMin === null) return "9h 00m";

  let diff = endMin - startMin;
  if (diff < 0) diff += 24 * 60; // Cross-midnight shift handling

  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
};

const parseCommaSeparated = (val) => {
  if (Array.isArray(val)) return val.map((s) => String(s).trim()).filter(Boolean);
  if (typeof val === "string") return val.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
};

const getOrCreateAttendanceRule = async (userId = null) => {
  let rules = await AttendanceRuleModel.findOne().populate(
    "updatedBy",
    "name firstName lastName email role"
  );

  if (!rules) {
    rules = await AttendanceRuleModel.create({
      updatedBy: userId,
    });
  }

  return rules;
};

export class AttendanceRuleController {
  /**
   * Get all attendance rules configuration
   */
  static async getAttendanceRules(req, res) {
    try {
      const rules = await getOrCreateAttendanceRule(req.user?._id);
      return sendSuccessResponse(
        res,
        "Attendance rules fetched successfully",
        rules
      );
    } catch (error) {
      console.error("Get Attendance Rules Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch attendance rules", error);
    }
  }

  /**
   * Update Working Hours settings (Screen 2)
   */
  static async updateWorkingHours(req, res) {
    try {
      const { enableWorkingHours, startTime, endTime, workingDays, totalHours } =
        req.body;

      const rules = await getOrCreateAttendanceRule(req.user?._id);

      if (enableWorkingHours !== undefined) {
        rules.workingHours.enableWorkingHours = Boolean(enableWorkingHours);
      }

      if (startTime !== undefined && String(startTime).trim()) {
        rules.workingHours.startTime = String(startTime).trim();
      }

      if (endTime !== undefined && String(endTime).trim()) {
        rules.workingHours.endTime = String(endTime).trim();
      }

      if (Array.isArray(workingDays)) {
        rules.workingHours.workingDays = workingDays;
      }

      // Auto-calculate totalHours if not explicitly passed
      if (totalHours !== undefined && String(totalHours).trim()) {
        rules.workingHours.totalHours = String(totalHours).trim();
      } else if (rules.workingHours.startTime && rules.workingHours.endTime) {
        rules.workingHours.totalHours = calculateTotalHours(
          rules.workingHours.startTime,
          rules.workingHours.endTime
        );
      }

      rules.updatedBy = req.user?._id || null;
      await rules.save();

      return sendSuccessResponse(
        res,
        "Working hours updated successfully",
        rules.workingHours
      );
    } catch (error) {
      console.error("Update Working Hours Error:", error);
      return sendErrorResponse(res, 500, "Failed to update working hours", error);
    }
  }

  /**
   * Update Grace Time settings (Screen 3)
   */
  static async updateGraceTime(req, res) {
    try {
      const {
        enableGracePeriod,
        graceDuration,
        maxGraceArrivalsPerMonth,
        actionIfLimitExceeded,
      } = req.body;

      const rules = await getOrCreateAttendanceRule(req.user?._id);

      if (enableGracePeriod !== undefined) {
        rules.graceTime.enableGracePeriod = Boolean(enableGracePeriod);
      }

      if (graceDuration !== undefined) {
        const duration = parseInt(graceDuration, 10);
        if (isNaN(duration) || duration < 0) {
          return sendBadRequestResponse(res, "Invalid grace duration");
        }
        rules.graceTime.graceDuration = duration;
      }

      if (maxGraceArrivalsPerMonth !== undefined) {
        const arrivals = parseInt(maxGraceArrivalsPerMonth, 10);
        if (isNaN(arrivals) || arrivals < 0) {
          return sendBadRequestResponse(res, "Invalid max grace arrivals value");
        }
        rules.graceTime.maxGraceArrivalsPerMonth = arrivals;
      }

      if (actionIfLimitExceeded !== undefined && String(actionIfLimitExceeded).trim()) {
        const allowedActions = [
          "Mark as Half Day",
          "Mark as Absent",
          "Deduct Leave",
          "Deduct Salary",
          "Warning Only",
        ];
        if (!allowedActions.includes(actionIfLimitExceeded.trim())) {
          return sendBadRequestResponse(
            res,
            `Action must be one of: ${allowedActions.join(", ")}`
          );
        }
        rules.graceTime.actionIfLimitExceeded = actionIfLimitExceeded.trim();
      }

      rules.updatedBy = req.user?._id || null;
      await rules.save();

      return sendSuccessResponse(
        res,
        "Grace time rules updated successfully",
        rules.graceTime
      );
    } catch (error) {
      console.error("Update Grace Time Error:", error);
      return sendErrorResponse(res, 500, "Failed to update grace time rules", error);
    }
  }

  /**
   * Update Break Time settings (Screen 4)
   */
  static async updateBreakTime(req, res) {
    try {
      const {
        trackEmployeeBreaks,
        lunchBreakAllowance,
        teaBreakAllowance,
        allowedShortBreaksPerShift,
        deductBreaksFromTotalHours,
      } = req.body;

      const rules = await getOrCreateAttendanceRule(req.user?._id);

      if (trackEmployeeBreaks !== undefined) {
        rules.breakTime.trackEmployeeBreaks = Boolean(trackEmployeeBreaks);
      }

      if (lunchBreakAllowance !== undefined) {
        const lunch = parseInt(lunchBreakAllowance, 10);
        if (isNaN(lunch) || lunch < 0) {
          return sendBadRequestResponse(res, "Invalid lunch break allowance");
        }
        rules.breakTime.lunchBreakAllowance = lunch;
      }

      if (teaBreakAllowance !== undefined) {
        const tea = parseInt(teaBreakAllowance, 10);
        if (isNaN(tea) || tea < 0) {
          return sendBadRequestResponse(res, "Invalid tea break allowance");
        }
        rules.breakTime.teaBreakAllowance = tea;
      }

      if (allowedShortBreaksPerShift !== undefined) {
        const breaks = parseInt(allowedShortBreaksPerShift, 10);
        if (isNaN(breaks) || breaks < 0) {
          return sendBadRequestResponse(res, "Invalid allowed short breaks value");
        }
        rules.breakTime.allowedShortBreaksPerShift = breaks;
      }

      if (deductBreaksFromTotalHours !== undefined) {
        rules.breakTime.deductBreaksFromTotalHours = Boolean(
          deductBreaksFromTotalHours
        );
      }

      rules.updatedBy = req.user?._id || null;
      await rules.save();

      return sendSuccessResponse(
        res,
        "Break time rules updated successfully",
        rules.breakTime
      );
    } catch (error) {
      console.error("Update Break Time Error:", error);
      return sendErrorResponse(res, 500, "Failed to update break time rules", error);
    }
  }

  /**
   * Update Overtime Rules settings (Screen 5)
   */
  static async updateOvertimeRules(req, res) {
    try {
      const {
        enableOvertimeTracking,
        minimumMinutesForOvertime,
        weekdayOvertimeRateMultiplier,
        weekendHolidayOvertimeMultiplier,
        requireManagerApproval,
      } = req.body;

      const rules = await getOrCreateAttendanceRule(req.user?._id);

      if (enableOvertimeTracking !== undefined) {
        rules.overtimeRules.enableOvertimeTracking = Boolean(
          enableOvertimeTracking
        );
      }

      if (minimumMinutesForOvertime !== undefined) {
        const minMins = parseInt(minimumMinutesForOvertime, 10);
        if (isNaN(minMins) || minMins < 0) {
          return sendBadRequestResponse(res, "Invalid minimum minutes value");
        }
        rules.overtimeRules.minimumMinutesForOvertime = minMins;
      }

      if (weekdayOvertimeRateMultiplier !== undefined) {
        const mult = parseFloat(weekdayOvertimeRateMultiplier);
        if (isNaN(mult) || mult < 0) {
          return sendBadRequestResponse(res, "Invalid weekday rate multiplier");
        }
        rules.overtimeRules.weekdayOvertimeRateMultiplier = mult;
      }

      if (weekendHolidayOvertimeMultiplier !== undefined) {
        const mult = parseFloat(weekendHolidayOvertimeMultiplier);
        if (isNaN(mult) || mult < 0) {
          return sendBadRequestResponse(res, "Invalid weekend/holiday rate multiplier");
        }
        rules.overtimeRules.weekendHolidayOvertimeMultiplier = mult;
      }

      if (requireManagerApproval !== undefined) {
        rules.overtimeRules.requireManagerApproval = Boolean(
          requireManagerApproval
        );
      }

      rules.updatedBy = req.user?._id || null;
      await rules.save();

      return sendSuccessResponse(
        res,
        "Overtime rules updated successfully",
        rules.overtimeRules
      );
    } catch (error) {
      console.error("Update Overtime Rules Error:", error);
      return sendErrorResponse(res, 500, "Failed to update overtime rules", error);
    }
  }

  /**
   * Update Auto Check-In / Out (Screen 6)
   */
  static async updateAutoAttendance(req, res) {
    try {
      const {
        autoCheckInAtShiftStart,
        autoCheckOutAtShiftEnd,
        bufferWindow,
        sendPushReminder,
      } = req.body;

      const rules = await getOrCreateAttendanceRule(req.user?._id);

      if (autoCheckInAtShiftStart !== undefined) {
        rules.autoAttendance.autoCheckInAtShiftStart = Boolean(
          autoCheckInAtShiftStart
        );
      }

      if (autoCheckOutAtShiftEnd !== undefined) {
        rules.autoAttendance.autoCheckOutAtShiftEnd = Boolean(
          autoCheckOutAtShiftEnd
        );
      }

      if (bufferWindow !== undefined) {
        const bw = parseInt(bufferWindow, 10);
        if (isNaN(bw) || bw < 0) {
          return sendBadRequestResponse(res, "Invalid buffer window value");
        }
        rules.autoAttendance.bufferWindow = bw;
      }

      if (sendPushReminder !== undefined) {
        rules.autoAttendance.sendPushReminder = Boolean(sendPushReminder);
      }

      rules.updatedBy = req.user?._id || null;
      await rules.save();

      return sendSuccessResponse(
        res,
        "Auto attendance rules updated successfully",
        rules.autoAttendance
      );
    } catch (error) {
      console.error("Update Auto Attendance Error:", error);
      return sendErrorResponse(res, 500, "Failed to update auto attendance rules", error);
    }
  }

  /**
   * Update Geofencing settings (Screen 7)
   */
  static async updateGeofencing(req, res) {
    try {
      const {
        enableGeofenceCheckIn,
        primaryOfficeLocation,
        radius,
        exemptRemoteWorkers,
        latitude,
        longitude,
      } = req.body;

      const rules = await getOrCreateAttendanceRule(req.user?._id);

      if (enableGeofenceCheckIn !== undefined) {
        rules.geofencing.enableGeofenceCheckIn = Boolean(enableGeofenceCheckIn);
      }

      if (primaryOfficeLocation !== undefined && String(primaryOfficeLocation).trim()) {
        rules.geofencing.primaryOfficeLocation = String(primaryOfficeLocation).trim();
      }

      if (radius !== undefined) {
        const rad = parseFloat(radius);
        if (isNaN(rad) || rad < 0) {
          return sendBadRequestResponse(res, "Invalid radius value");
        }
        rules.geofencing.radius = rad;
      }

      if (exemptRemoteWorkers !== undefined) {
        rules.geofencing.exemptRemoteWorkers = Boolean(exemptRemoteWorkers);
      }

      if (latitude !== undefined) {
        rules.geofencing.latitude = parseFloat(latitude);
      }

      if (longitude !== undefined) {
        rules.geofencing.longitude = parseFloat(longitude);
      }

      rules.updatedBy = req.user?._id || null;
      await rules.save();

      return sendSuccessResponse(
        res,
        "Geofencing rules updated successfully",
        rules.geofencing
      );
    } catch (error) {
      console.error("Update Geofencing Error:", error);
      return sendErrorResponse(res, 500, "Failed to update geofencing rules", error);
    }
  }

  /**
   * Update IP Restriction settings (Screen 8)
   */
  static async updateIpRestriction(req, res) {
    try {
      const {
        enableIpWhitelist,
        allowedIpSubnets,
        verifyWifiSsid,
        allowedWifiSsids,
      } = req.body;

      const rules = await getOrCreateAttendanceRule(req.user?._id);

      if (enableIpWhitelist !== undefined) {
        rules.ipRestriction.enableIpWhitelist = Boolean(enableIpWhitelist);
      }

      if (allowedIpSubnets !== undefined) {
        rules.ipRestriction.allowedIpSubnets = parseCommaSeparated(allowedIpSubnets);
      }

      if (verifyWifiSsid !== undefined) {
        rules.ipRestriction.verifyWifiSsid = Boolean(verifyWifiSsid);
      }

      if (allowedWifiSsids !== undefined) {
        rules.ipRestriction.allowedWifiSsids = parseCommaSeparated(allowedWifiSsids);
      }

      rules.updatedBy = req.user?._id || null;
      await rules.save();

      return sendSuccessResponse(
        res,
        "IP restriction rules updated successfully",
        rules.ipRestriction
      );
    } catch (error) {
      console.error("Update IP Restriction Error:", error);
      return sendErrorResponse(res, 500, "Failed to update IP restriction rules", error);
    }
  }

  /**
   * Update all or any section of attendance rules at once
   */
  static async updateAllAttendanceRules(req, res) {
    try {
      const {
        workingHours,
        graceTime,
        breakTime,
        overtimeRules,
        autoAttendance,
        geofencing,
        ipRestriction,
      } = req.body;

      const rules = await getOrCreateAttendanceRule(req.user?._id);

      if (workingHours && typeof workingHours === "object") {
        if (workingHours.enableWorkingHours !== undefined) {
          rules.workingHours.enableWorkingHours = Boolean(workingHours.enableWorkingHours);
        }
        if (workingHours.startTime) rules.workingHours.startTime = String(workingHours.startTime).trim();
        if (workingHours.endTime) rules.workingHours.endTime = String(workingHours.endTime).trim();
        if (Array.isArray(workingHours.workingDays)) rules.workingHours.workingDays = workingHours.workingDays;
        rules.workingHours.totalHours =
          workingHours.totalHours ||
          calculateTotalHours(rules.workingHours.startTime, rules.workingHours.endTime);
      }

      if (graceTime && typeof graceTime === "object") {
        if (graceTime.enableGracePeriod !== undefined) {
          rules.graceTime.enableGracePeriod = Boolean(graceTime.enableGracePeriod);
        }
        if (graceTime.graceDuration !== undefined) {
          rules.graceTime.graceDuration = parseInt(graceTime.graceDuration, 10) || 15;
        }
        if (graceTime.maxGraceArrivalsPerMonth !== undefined) {
          rules.graceTime.maxGraceArrivalsPerMonth =
            parseInt(graceTime.maxGraceArrivalsPerMonth, 10) || 3;
        }
        if (graceTime.actionIfLimitExceeded) {
          rules.graceTime.actionIfLimitExceeded = String(graceTime.actionIfLimitExceeded).trim();
        }
      }

      if (breakTime && typeof breakTime === "object") {
        if (breakTime.trackEmployeeBreaks !== undefined) {
          rules.breakTime.trackEmployeeBreaks = Boolean(breakTime.trackEmployeeBreaks);
        }
        if (breakTime.lunchBreakAllowance !== undefined) {
          rules.breakTime.lunchBreakAllowance = parseInt(breakTime.lunchBreakAllowance, 10) || 60;
        }
        if (breakTime.teaBreakAllowance !== undefined) {
          rules.breakTime.teaBreakAllowance = parseInt(breakTime.teaBreakAllowance, 10) || 15;
        }
        if (breakTime.allowedShortBreaksPerShift !== undefined) {
          rules.breakTime.allowedShortBreaksPerShift =
            parseInt(breakTime.allowedShortBreaksPerShift, 10) || 2;
        }
        if (breakTime.deductBreaksFromTotalHours !== undefined) {
          rules.breakTime.deductBreaksFromTotalHours = Boolean(breakTime.deductBreaksFromTotalHours);
        }
      }

      if (overtimeRules && typeof overtimeRules === "object") {
        if (overtimeRules.enableOvertimeTracking !== undefined) {
          rules.overtimeRules.enableOvertimeTracking = Boolean(overtimeRules.enableOvertimeTracking);
        }
        if (overtimeRules.minimumMinutesForOvertime !== undefined) {
          rules.overtimeRules.minimumMinutesForOvertime =
            parseInt(overtimeRules.minimumMinutesForOvertime, 10) || 30;
        }
        if (overtimeRules.weekdayOvertimeRateMultiplier !== undefined) {
          rules.overtimeRules.weekdayOvertimeRateMultiplier =
            parseFloat(overtimeRules.weekdayOvertimeRateMultiplier) || 1.5;
        }
        if (overtimeRules.weekendHolidayOvertimeMultiplier !== undefined) {
          rules.overtimeRules.weekendHolidayOvertimeMultiplier =
            parseFloat(overtimeRules.weekendHolidayOvertimeMultiplier) || 2.0;
        }
        if (overtimeRules.requireManagerApproval !== undefined) {
          rules.overtimeRules.requireManagerApproval = Boolean(overtimeRules.requireManagerApproval);
        }
      }

      if (autoAttendance && typeof autoAttendance === "object") {
        if (autoAttendance.autoCheckInAtShiftStart !== undefined) {
          rules.autoAttendance.autoCheckInAtShiftStart = Boolean(autoAttendance.autoCheckInAtShiftStart);
        }
        if (autoAttendance.autoCheckOutAtShiftEnd !== undefined) {
          rules.autoAttendance.autoCheckOutAtShiftEnd = Boolean(autoAttendance.autoCheckOutAtShiftEnd);
        }
        if (autoAttendance.bufferWindow !== undefined) {
          rules.autoAttendance.bufferWindow = parseInt(autoAttendance.bufferWindow, 10) || 30;
        }
        if (autoAttendance.sendPushReminder !== undefined) {
          rules.autoAttendance.sendPushReminder = Boolean(autoAttendance.sendPushReminder);
        }
      }

      if (geofencing && typeof geofencing === "object") {
        if (geofencing.enableGeofenceCheckIn !== undefined) {
          rules.geofencing.enableGeofenceCheckIn = Boolean(geofencing.enableGeofenceCheckIn);
        }
        if (geofencing.primaryOfficeLocation) {
          rules.geofencing.primaryOfficeLocation = String(geofencing.primaryOfficeLocation).trim();
        }
        if (geofencing.radius !== undefined) {
          rules.geofencing.radius = parseFloat(geofencing.radius) || 200;
        }
        if (geofencing.exemptRemoteWorkers !== undefined) {
          rules.geofencing.exemptRemoteWorkers = Boolean(geofencing.exemptRemoteWorkers);
        }
        if (geofencing.latitude !== undefined) rules.geofencing.latitude = parseFloat(geofencing.latitude);
        if (geofencing.longitude !== undefined) rules.geofencing.longitude = parseFloat(geofencing.longitude);
      }

      if (ipRestriction && typeof ipRestriction === "object") {
        if (ipRestriction.enableIpWhitelist !== undefined) {
          rules.ipRestriction.enableIpWhitelist = Boolean(ipRestriction.enableIpWhitelist);
        }
        if (ipRestriction.allowedIpSubnets !== undefined) {
          rules.ipRestriction.allowedIpSubnets = parseCommaSeparated(ipRestriction.allowedIpSubnets);
        }
        if (ipRestriction.verifyWifiSsid !== undefined) {
          rules.ipRestriction.verifyWifiSsid = Boolean(ipRestriction.verifyWifiSsid);
        }
        if (ipRestriction.allowedWifiSsids !== undefined) {
          rules.ipRestriction.allowedWifiSsids = parseCommaSeparated(ipRestriction.allowedWifiSsids);
        }
      }

      rules.updatedBy = req.user?._id || null;
      await rules.save();

      return sendSuccessResponse(
        res,
        "All attendance rules updated successfully",
        rules
      );
    } catch (error) {
      console.error("Update All Attendance Rules Error:", error);
      return sendErrorResponse(res, 500, "Failed to update attendance rules", error);
    }
  }
}
