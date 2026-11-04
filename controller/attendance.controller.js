import mongoose from "mongoose";
import AttendanceModel from "../model/attendance.model.js";
import AttendanceRegularizationModel from "../model/attendanceRegularization.model.js";
import LeaveModel from "../model/leave.model.js";
import ShiftModel from "../model/shift.model.js";
import ShiftRosterModel from "../model/shiftRoster.model.js";
import UserModel from "../model/user.model.js";
import { recordAuditLog } from "../utils/auditLogger.js";
import {
  sendCreatedResponse,
  sendSuccessResponse,
  sendErrorResponse,
  sendBadRequestResponse,
  sendNotFoundResponse,
} from "../utils/Response.utils.js";
import {
  syncAttendanceBreakStatus,
  resumeEmployeeTracker,
  pauseEmployeeTracker,
  extractBreaksFromShift,
} from "../services/breakTracker.service.js";

// Helper: Format Date to YYYY-MM-DD
export const getNormalizedDateString = (inputDate) => {
  const d = inputDate ? new Date(inputDate) : new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// Helper: Format Date to "08 Oct 2026"
export const formatDisplayDate = (inputDate) => {
  const d = inputDate ? new Date(inputDate) : new Date();
  const day = String(d.getDate()).padStart(2, "0");
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const month = monthNames[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
};

// Helper: Format Date to "09:30 AM"
export const formatTimeDisplay = (date) => {
  if (!date) return "";
  const d = new Date(date);
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${String(hours).padStart(2, "0")}:${minutes} ${ampm}`;
};

// Helper: Parse "09:30 AM" or "18:00" to minutes from midnight
export const parseTimeToMinutes = (timeStr) => {
  if (!timeStr || typeof timeStr !== "string") return 0;
  const clean = timeStr.trim().toUpperCase();

  const is12Hour = clean.includes("AM") || clean.includes("PM");
  if (is12Hour) {
    const isPM = clean.includes("PM");
    const isAM = clean.includes("AM");
    const timeOnly = clean.replace(/AM|PM/g, "").trim();
    const parts = timeOnly.split(":");
    let hours = parseInt(parts[0], 10) || 0;
    const minutes = parseInt(parts[1], 10) || 0;

    if (isPM && hours < 12) hours += 12;
    if (isAM && hours === 12) hours = 0;

    return hours * 60 + minutes;
  }

  const parts = clean.split(":");
  const hours = parseInt(parts[0], 10) || 0;
  const minutes = parseInt(parts[1], 10) || 0;
  return hours * 60 + minutes;
};

// Helper: Combine Date string (YYYY-MM-DD) and Time string (09:30 AM) into a Date object
export const combineDateAndTime = (dateStr, timeStr) => {
  try {
    const [year, month, day] = dateStr.split("-").map(Number);
    const mins = parseTimeToMinutes(timeStr);
    const hours = Math.floor(mins / 60);
    const minutes = mins % 60;
    return new Date(year, month - 1, day, hours, minutes, 0, 0);
  } catch (e) {
    return new Date();
  }
};

// Helper: Evaluate shift timing status (handles normal daytime shifts and overnight night shifts like 11:00 PM to 07:00 AM)
export const evaluateShiftTiming = (shiftStartTime, shiftEndTime, checkTime = new Date(), earlyBufferMinutes = 30) => {
  if (!shiftStartTime || !shiftEndTime) {
    return { isShiftActive: true, isShiftEnded: false, isShiftNotStarted: false };
  }

  const startM = parseTimeToMinutes(shiftStartTime);
  const endM = parseTimeToMinutes(shiftEndTime);
  const curM = checkTime.getHours() * 60 + checkTime.getMinutes();

  if (startM < endM) {
    // Same-day daytime shift: e.g. 09:00 AM to 06:00 PM
    if (curM > endM) {
      return { isShiftActive: false, isShiftEnded: true, isShiftNotStarted: false };
    }
    if (curM < startM - earlyBufferMinutes) {
      return { isShiftActive: false, isShiftEnded: false, isShiftNotStarted: true };
    }
    return { isShiftActive: true, isShiftEnded: false, isShiftNotStarted: false };
  } else {
    // Overnight / night shift: e.g. 11:00 PM to 07:00 AM
    // Active check-in window: from (11 PM - 30m = 10:30 PM) to midnight (1440), OR from midnight (0) to 07:00 AM (420)
    const earlyAllowedM = startM - earlyBufferMinutes;
    const isDuringShift = (curM >= earlyAllowedM) || (curM <= endM);

    if (isDuringShift) {
      return { isShiftActive: true, isShiftEnded: false, isShiftNotStarted: false };
    }

    // Outside active shift window (between endM e.g. 07:00 AM and earlyAllowedM e.g. 10:30 PM):
    // From shift end (07:00 AM) to midpoint (~02:45 PM): The night shift has ended/completed!
    // Employee cannot check in after shift end time (07:00 AM).
    // From midpoint to earlyAllowedM (~02:45 PM to 10:30 PM): Tonight's shift has not started yet.
    const gap = earlyAllowedM - endM;
    const midpoint = Math.floor(endM + gap / 2);

    if (curM > endM && curM < midpoint) {
      return { isShiftActive: false, isShiftEnded: true, isShiftNotStarted: false };
    } else {
      return { isShiftActive: false, isShiftEnded: false, isShiftNotStarted: true };
    }
  }
};

// Helper: Get logical shift date (handles post-midnight check-ins for night shifts)
export const getLogicalShiftDate = (shiftStartTime, shiftEndTime, checkTime = new Date()) => {
  const todayStr = getNormalizedDateString(checkTime);
  if (!shiftStartTime || !shiftEndTime) return todayStr;

  const startM = parseTimeToMinutes(shiftStartTime);
  const endM = parseTimeToMinutes(shiftEndTime);
  const curM = checkTime.getHours() * 60 + checkTime.getMinutes();

  // If overnight shift (startM > endM) and checking in between midnight (0) and shiftEndTime (e.g. 00:00 to 07:00 AM)
  if (startM > endM && curM <= endM) {
    const yesterday = new Date(checkTime);
    yesterday.setDate(yesterday.getDate() - 1);
    return getNormalizedDateString(yesterday);
  }

  return todayStr;
};

// Helper: Check if check-in time is after the shift end time
export const isAfterShiftEndTime = (shiftStartTime, shiftEndTime, checkTime = new Date()) => {
  const result = evaluateShiftTiming(shiftStartTime, shiftEndTime, checkTime);
  return result.isShiftEnded;
};

// Helper: Determine if check-in is late considering daytime or overnight shifts
export const checkIsLate = (shiftStartTime, checkTime = new Date()) => {
  if (!shiftStartTime) return false;
  const startM = parseTimeToMinutes(shiftStartTime);
  const curM = checkTime.getHours() * 60 + checkTime.getMinutes();

  if (startM < 720) {
    // Normal daytime shift (e.g. 09:00 AM)
    return curM > startM;
  } else {
    // Overnight / night shift (e.g. 11:00 PM = 1380)
    // If checking in after midnight and before noon, it is definitely late
    if (curM < 720) return true;
    return curM > startM;
  }
};

export class AttendanceController {
  /**
   * Employee Check-In
   * POST /attendance/checkIn
   */
  static async checkIn(req, res) {
    try {
      const employeeId = req.user?._id;
      const isAdmin = req.user?.role === "admin";
      if (!employeeId) {
        return sendBadRequestResponse(res, "Authentication required");
      }

      const todayDate = getNormalizedDateString();
      const formattedToday = formatDisplayDate();
      let now = new Date();
      if (req.body?.checkInTime || req.body?.time) {
        now = combineDateAndTime(todayDate, req.body.checkInTime || req.body.time);
      }
      const checkInDisplay = formatTimeDisplay(now);

      let activeShift = null;
      let shiftStartTime = null;
      let shiftEndTime = null;
      let shiftId = null;
      let isLate = false;
      let requiredWorkMinutes = 540;

      if (isAdmin) {
        // 🌟 ADMIN HAS NO SHIFT RESTRICTIONS 🌟
        // Admin has no shift time and can check in at any time
        requiredWorkMinutes = 0;
      } else {
        // 🌟 EMPLOYEE SHIFT RESOLUTION 🌟
        // 1. Check if shiftId is passed explicitly in request body
        const requestedShiftId = req.body?.shiftId || req.body?.shift || null;
        if (requestedShiftId) {
          if (!mongoose.Types.ObjectId.isValid(requestedShiftId)) {
            return sendBadRequestResponse(res, "Invalid shiftId provided");
          }
          const foundShift = await ShiftModel.findById(requestedShiftId);
          if (!foundShift) {
            return res.status(404).json({ success: false, message: "Specified shift not found" });
          }
          activeShift = foundShift;
        }

        // 2. Check employee's assigned shift in UserModel
        if (!activeShift) {
          const user = await UserModel.findById(employeeId)
            .populate("shift")
            .populate("shiftAndSchedule.shift");
          activeShift = user?.shift || user?.shiftAndSchedule?.shift || null;
        }

        // 3. Check weekly roster for day-specific shift
        if (!activeShift) {
          const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
          const dayOfWeek = dayNames[now.getDay()];
          const roster = await ShiftRosterModel.findOne({
            employee: employeeId,
            weekStartDate: { $lte: todayDate },
            weekEndDate: { $gte: todayDate },
          }).populate(`schedule.${dayOfWeek}.shift`);

          if (roster?.schedule?.[dayOfWeek]?.shift) {
            activeShift = roster.schedule[dayOfWeek].shift;
          }
        }

        // 4. Default active shift if none assigned
        if (!activeShift) {
          activeShift =
            (await ShiftModel.findOne({ isDefault: true, status: "Active" })) ||
            (await ShiftModel.findOne({ status: "Active" }));
        }

        if (activeShift) {
          shiftStartTime = activeShift.startTime || "09:00 AM";
          shiftEndTime = activeShift.endTime || "06:00 PM";
          shiftId = activeShift._id;

          if (activeShift.durationHours) {
            requiredWorkMinutes = Math.round(activeShift.durationHours * 60);
          } else if (activeShift.startTime && activeShift.endTime) {
            const sMin = parseTimeToMinutes(activeShift.startTime);
            const eMin = parseTimeToMinutes(activeShift.endTime);
            let diff = eMin - sMin;
            if (diff <= 0) diff += 1440;
            requiredWorkMinutes = diff;
          }
        } else {
          shiftStartTime = "09:00 AM";
          shiftEndTime = "06:00 PM";
        }
      }

      // Determine logical target date for attendance record (supporting post-midnight overnight shifts)
      const targetDate = isAdmin
        ? todayDate
        : getLogicalShiftDate(shiftStartTime, shiftEndTime, now);

      // Check if attendance already recorded for this target date
      let attendance = await AttendanceModel.findOne({
        employee: employeeId,
        date: targetDate,
      });

      if (attendance && attendance.checkInTime) {
        return res.status(400).json({
          success: false,
          message: `Already checked in for ${targetDate === todayDate ? "today" : "shift date (" + targetDate + ")"} at ${attendance.checkInDisplay}`,
          result: attendance,
        });
      }

      if (!isAdmin) {
        // 🌟 EVALUATE SHIFT TIMING WINDOW 🌟
        const timingStatus = evaluateShiftTiming(shiftStartTime, shiftEndTime, now);

        if (timingStatus.isShiftEnded) {
          const pendingRegularization = await AttendanceRegularizationModel.findOne({
            employee: employeeId,
            date: targetDate,
            correctionType: "Missed Check-In",
            status: "Pending",
          });

          if (pendingRegularization) {
            return res.status(400).json({
              success: false,
              canCheckIn: false,
              isShiftEnded: true,
              isPendingApproval: true,
              canRegularize: false,
              message: `Shift has already ended! Your shift was from ${shiftStartTime} to ${shiftEndTime}. Your 'Missed Check-In' regularization request is currently PENDING approval from Admin.`,
              shiftStartTime,
              shiftEndTime,
              attemptedCheckInTime: checkInDisplay,
              pendingRequest: pendingRegularization,
            });
          }

          return res.status(400).json({
            success: false,
            canCheckIn: false,
            isShiftEnded: true,
            isPendingApproval: false,
            canRegularize: true,
            message: `Shift has already ended! Your shift was from ${shiftStartTime} to ${shiftEndTime}. You cannot check in after your shift end time (${shiftEndTime}). If you worked today, please submit an Attendance Regularization request for 'Missed Check-In' for Admin approval.`,
            shiftStartTime,
            shiftEndTime,
            attemptedCheckInTime: checkInDisplay,
          });
        }

        if (timingStatus.isShiftNotStarted) {
          return res.status(400).json({
            success: false,
            canCheckIn: false,
            isShiftEnded: false,
            isShiftNotStarted: true,
            message: `Shift has not started yet! Your shift is from ${shiftStartTime} to ${shiftEndTime}. You can check in during your shift hours.`,
            shiftStartTime,
            shiftEndTime,
            attemptedCheckInTime: checkInDisplay,
          });
        }

        isLate = checkIsLate(shiftStartTime, now);
      }

      const initialStatus = isAdmin ? "Present" : isLate ? "Late" : "Present";
      const earliestAllowedCheckOut = isAdmin
        ? null
        : new Date(now.getTime() + requiredWorkMinutes * 60 * 1000);
      const earliestAllowedCheckOutDisplay = isAdmin
        ? null
        : formatTimeDisplay(earliestAllowedCheckOut);

      const targetFormattedDate =
        targetDate === todayDate ? formattedToday : formatDisplayDate(new Date(targetDate));

      const breaksList = isAdmin ? [] : extractBreaksFromShift(activeShift);

      if (!attendance) {
        attendance = new AttendanceModel({
          employee: employeeId,
          date: targetDate,
          formattedDate: targetFormattedDate,
          shift: isAdmin ? null : shiftId,
          checkInTime: now,
          checkInDisplay,
          status: initialStatus,
          requiredWorkMinutes: isAdmin ? 0 : requiredWorkMinutes,
          earliestAllowedCheckOut,
          earliestAllowedCheckOutDisplay,
          originalEarliestAllowedCheckOut: earliestAllowedCheckOut,
          originalEarliestAllowedCheckOutDisplay: earliestAllowedCheckOutDisplay,
          totalBreakLateMinutes: 0,
          trackerStatus: "RUNNING",
          trackerLastStartedAt: now,
          breaks: breaksList,
          notes: isAdmin
            ? "Admin check-in"
            : isLate
              ? "Late check-in"
              : "On-time check-in",
        });
      } else {
        // Attendance record existed, update checkIn
        attendance.checkInTime = now;
        attendance.checkInDisplay = checkInDisplay;
        attendance.status = initialStatus;
        attendance.requiredWorkMinutes = isAdmin ? 0 : requiredWorkMinutes;
        attendance.earliestAllowedCheckOut = earliestAllowedCheckOut;
        attendance.earliestAllowedCheckOutDisplay = earliestAllowedCheckOutDisplay;
        if (!attendance.originalEarliestAllowedCheckOut) {
          attendance.originalEarliestAllowedCheckOut = earliestAllowedCheckOut;
          attendance.originalEarliestAllowedCheckOutDisplay = earliestAllowedCheckOutDisplay;
        }
        attendance.totalBreakLateMinutes = 0;
        attendance.trackerStatus = "RUNNING";
        attendance.trackerLastStartedAt = now;
        attendance.shift = isAdmin ? null : shiftId;
        if (!attendance.breaks || attendance.breaks.length === 0) {
          attendance.breaks = breaksList;
        }
      }

      if (!isAdmin) {
        syncAttendanceBreakStatus(attendance, activeShift, now);
      }

      await attendance.save();

      return sendSuccessResponse(res, `Check-in successful at ${checkInDisplay}`, {
        ...attendance.toObject(),
        isLate: isAdmin ? false : isLate,
        isAdmin,
        shift: isAdmin ? null : attendance.shift,
        shiftStartTime: isAdmin ? null : shiftStartTime,
        shiftEndTime: isAdmin ? null : shiftEndTime,
        requiredWorkHours: isAdmin ? "Flexible" : `${Math.round(requiredWorkMinutes / 60)} Hours`,
        earliestAllowedCheckOut: isAdmin ? null : attendance.earliestAllowedCheckOutDisplay || earliestAllowedCheckOutDisplay,
        originalEarliestAllowedCheckOut: isAdmin ? null : attendance.originalEarliestAllowedCheckOutDisplay || earliestAllowedCheckOutDisplay,
        trackerStatus: attendance.trackerStatus,
        activeBreak: attendance.activeBreak,
        breaks: attendance.breaks,
      });
    } catch (error) {
      console.error("Check-In Error:", error);
      return sendErrorResponse(res, 500, "Failed to record check-in", error);
    }
  }

  /**
   * Employee Check-Out
   * POST /attendance/checkOut
   *
   * STRICT REQUIREMENTS:
   * 1. If employee forgot check-in, check-out is strictly blocked!
   * 2. Compulsory shift hours completion: e.g. If checked in at 9:10 AM,
   *    earliest checkout is at 6:10 PM (9 hours / compulsory hours must be completed).
   * 3. Early Checkout Exception: If employee applied for 'Early Out Regularization'
   *    (e.g. leave early at 3:25 PM) and Admin APPROVED it, then employee CAN check out early!
   */
  static async checkOut(req, res) {
    try {
      const employeeId = req.user?._id;
      const isAdmin = req.user?.role === "admin";
      if (!employeeId) {
        return sendBadRequestResponse(res, "Authentication required");
      }

      const todayDate = getNormalizedDateString();
      let now = new Date();
      if (req.body?.checkOutTime || req.body?.time) {
        now = combineDateAndTime(todayDate, req.body.checkOutTime || req.body.time);
      }
      const checkOutDisplay = formatTimeDisplay(now);

      // 1. Look for today's attendance record
      let attendance = await AttendanceModel.findOne({
        employee: employeeId,
        date: todayDate,
      });

      // If no check-in today, check if there is an active checked-in shift from yesterday (e.g. overnight shift 11 PM to 7 AM)
      if (!attendance || !attendance.checkInTime) {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayDate = getNormalizedDateString(yesterday);

        const openOvernight = await AttendanceModel.findOne({
          employee: employeeId,
          date: yesterdayDate,
          checkInTime: { $ne: null },
          checkOutTime: null,
        });

        if (openOvernight) {
          attendance = openOvernight;
        }
      }

      // Check if check-in exists
      if (!attendance || !attendance.checkInTime) {
        // Check if employee already submitted a pending regularization request
        const pendingRegularization = await AttendanceRegularizationModel.findOne({
          employee: employeeId,
          date: attendance?.date || todayDate,
          correctionType: "Missed Check-In",
          status: "Pending",
        });

        if (pendingRegularization) {
          return res.status(400).json({
            success: false,
            canCheckOut: false,
            isPendingApproval: true,
            canRegularize: false,
            message:
              "You did not check in today. Your 'Missed Check-In' regularization request is currently Pending admin approval. You can only check out after Admin approves your request.",
            pendingRequest: pendingRegularization,
          });
        }

        return res.status(400).json({
          success: false,
          canCheckOut: false,
          isPendingApproval: false,
          canRegularize: true,
          message:
            "Check-in not found for today! You cannot check out without check-in. Please submit an Attendance Regularization request for 'Missed Check-In'. Once Admin approves, you can check out.",
        });
      }

      // 2. CHECK IF ALREADY CHECKED OUT
      if (attendance.checkOutTime) {
        return res.status(400).json({
          success: false,
          message: `Already checked out for today at ${attendance.checkOutDisplay}`,
          result: attendance,
        });
      }

      // 3. CHECK COMPULSORY WORK HOURS COMPLETION OR APPROVED EARLY LEAVE
      // Resolve employee shift for accurate break sync
      let activeShift = null;
      if (!isAdmin) {
        const user = await UserModel.findById(employeeId).populate("shift").populate("shiftAndSchedule.shift");
        activeShift = user?.shift || user?.shiftAndSchedule?.shift || null;
        if (!activeShift) {
          activeShift =
            (await ShiftModel.findOne({ isDefault: true, status: "Active" })) ||
            (await ShiftModel.findOne({ status: "Active" }));
        }

        // Synchronize break auto-stop and late resume penalties
        syncAttendanceBreakStatus(attendance, activeShift, now);
      }

      const targetDate = attendance.date || todayDate;
      const checkInDate = new Date(attendance.checkInTime);
      const diffMs = now.getTime() - checkInDate.getTime();
      const elapsedMinutes = Math.max(0, Math.floor(diffMs / (1000 * 60)));
      const requiredMinutes = attendance.requiredWorkMinutes || 540;
      const earliestCheckoutDate =
        attendance.earliestAllowedCheckOut ||
        new Date(checkInDate.getTime() + requiredMinutes * 60 * 1000);
      const earliestCheckoutDisplay =
        attendance.earliestAllowedCheckOutDisplay || formatTimeDisplay(earliestCheckoutDate);

      // Admin has no compulsory shift hours restriction
      const isHoursCompleted =
        isAdmin || now.getTime() >= earliestCheckoutDate.getTime();

      // Check if Admin approved a Leave for this date in LeaveModel
      const approvedLeave = await LeaveModel.findOne({
        employee: employeeId,
        fromDate: { $lte: targetDate },
        toDate: { $gte: targetDate },
        status: "Approved",
      });

      // Check if Admin approved an early out / leave request in AttendanceRegularizationModel
      const approvedEarlyOut = await AttendanceRegularizationModel.findOne({
        employee: employeeId,
        date: targetDate,
        correctionType: {
          $in: ["Early Out Regularization", "Leave", "Half Day Leave", "Early Departure"],
        },
        status: "Approved",
      });

      const approvedEarlyOutTime =
        attendance.approvedEarlyOutTime ||
        approvedEarlyOut?.requestedTimestamp ||
        (approvedLeave ? "Approved Leave" : null);

      const isEarlyDepartureApproved = Boolean(
        attendance.isEarlyOutApproved || approvedEarlyOut || approvedLeave
      );

      // If neither shift hours are completed NOR leave has been approved by admin, checkout is strictly BLOCKED
      if (!isHoursCompleted && !isEarlyDepartureApproved) {
        // Check if employee applied for leave and it is Pending
        const pendingLeave = await LeaveModel.findOne({
          employee: employeeId,
          fromDate: { $lte: targetDate },
          toDate: { $gte: targetDate },
          status: "Pending",
        });

        // Check if early out regularization is Pending
        const pendingEarlyOut = await AttendanceRegularizationModel.findOne({
          employee: employeeId,
          date: targetDate,
          correctionType: {
            $in: ["Early Out Regularization", "Leave", "Half Day Leave", "Early Departure"],
          },
          status: "Pending",
        });

        const remainingMs = Math.max(0, earliestCheckoutDate.getTime() - now.getTime());
        const remainingMins = Math.ceil(remainingMs / (1000 * 60));
        const remH = Math.floor(remainingMins / 60);
        const remM = remainingMins % 60;
        const remainingDisplay = `${remH}h ${String(remM).padStart(2, "0")}m remaining`;

        const latePenaltyText =
          (attendance.totalBreakLateMinutes || 0) > 0
            ? ` (includes ${attendance.totalBreakLateMinutes} minute(s) added to shift end due to late restart after break)`
            : "";

        if (pendingLeave || pendingEarlyOut) {
          const pendingItem = pendingLeave || pendingEarlyOut;
          const pendingDescription = pendingLeave
            ? `Your leave request (${pendingLeave.leaveTypeName}) for today is currently PENDING approval from Admin.`
            : `Your 'Early Out Regularization' request is currently PENDING approval from Admin.`;

          return res.status(400).json({
            success: false,
            canCheckOut: false,
            isEarlyCheckOut: true,
            isPendingApproval: true,
            canRegularize: false,
            message: `You cannot check out yet! You must complete your shift hours. You checked in at ${attendance.checkInDisplay}, so your earliest checkout time is ${earliestCheckoutDisplay}${latePenaltyText}. ${pendingDescription} You can only check out once Admin approves your request.`,
            checkInTime: attendance.checkInDisplay,
            earliestAllowedCheckOut: earliestCheckoutDisplay,
            totalBreakLateMinutes: attendance.totalBreakLateMinutes || 0,
            remainingMinutes: remainingMins,
            remainingTimeDisplay: remainingDisplay,
            pendingRequest: pendingItem,
          });
        }

        return res.status(400).json({
          success: false,
          canCheckOut: false,
          isEarlyCheckOut: true,
          isPendingApproval: false,
          canRegularize: true,
          message: `You cannot check out yet! You must complete your compulsory shift hours (${Math.round(requiredMinutes / 60)} Hours). You checked in at ${attendance.checkInDisplay}, so you can check out at or after ${earliestCheckoutDisplay}${latePenaltyText}. If you need to leave early, please apply for a leave for today and get it approved by Admin. Once Admin approves, you will be allowed to check out.`,
          checkInTime: attendance.checkInDisplay,
          earliestAllowedCheckOut: earliestCheckoutDisplay,
          totalBreakLateMinutes: attendance.totalBreakLateMinutes || 0,
          remainingMinutes: remainingMins,
          remainingTimeDisplay: remainingDisplay,
        });
      }

      // 4. PROCEED WITH CHECK-OUT (Shift hours completed OR early checkout approved via Admin-approved leave)
      // Auto-finalize any active or pending breaks and pauses so checkout proceeds cleanly
      if (Array.isArray(attendance.breaks)) {
        for (const brk of attendance.breaks) {
          if (brk.status === "Active" || brk.status === "Pending Resume") {
            brk.status = "Completed";
            brk.resumedAt = brk.resumedAt || now;
            brk.resumedAtDisplay = brk.resumedAtDisplay || checkOutDisplay;
          }
        }
      }
      if (attendance.activePause) {
        const pauseStart = attendance.activePause?.pausedAt ? new Date(attendance.activePause.pausedAt) : null;
        if (pauseStart) {
          const pauseMins = Math.max(0, Math.floor((now.getTime() - pauseStart.getTime()) / 60000));
          attendance.totalManualPauseMinutes = (attendance.totalManualPauseMinutes || 0) + pauseMins;
        }
        const openPause = attendance.manualPauses?.slice().reverse().find((p) => !p.resumedAt);
        if (openPause) {
          openPause.resumedAt = now;
          openPause.resumedAtDisplay = checkOutDisplay;
        }
        attendance.activePause = null;
      }

      // Re-calculate pure working time with breaks finalized
      syncAttendanceBreakStatus(attendance, activeShift, now);

      attendance.checkOutTime = now;
      attendance.checkOutDisplay = checkOutDisplay;
      attendance.trackerStatus = "COMPLETED";
      attendance.activeBreak = null;
      if (!attendance.totalWorkMinutes) {
        attendance.totalWorkMinutes = elapsedMinutes;
      }
      const hours = Math.floor(attendance.totalWorkMinutes / 60);
      const mins = attendance.totalWorkMinutes % 60;
      attendance.totalWorkHoursDisplay = `${hours}h ${String(mins).padStart(2, "0")}m`;

      if (isEarlyDepartureApproved) {
        attendance.isEarlyOutApproved = true;
        if (approvedLeave) {
          attendance.leaveRecord = approvedLeave._id;
          if (approvedLeave.isHalfDay) {
            attendance.status = "Half Day";
          }
        } else if (elapsedMinutes < requiredMinutes) {
          attendance.status = "Half Day";
        }
        const noteReason =
          approvedLeave?.reason ||
          approvedEarlyOut?.reason ||
          attendance.approvedEarlyOutTime ||
          "Authorized early departure / approved leave";
        attendance.notes = attendance.notes
          ? `${attendance.notes} | Leave approved by Admin: ${noteReason}`
          : `Leave approved by Admin: ${noteReason}`;
      }

      await attendance.save();

      return sendSuccessResponse(res, `Check-out successful at ${checkOutDisplay}`, {
        ...attendance.toObject(),
        totalWorkHours: attendance.totalWorkHoursDisplay,
        totalBreakLateMinutes: attendance.totalBreakLateMinutes || 0,
        isEarlyCheckout: !isHoursCompleted && isEarlyDepartureApproved,
      });
    } catch (error) {
      console.error("Check-Out Error:", error);
      return sendErrorResponse(res, 500, "Failed to record check-out", error);
    }
  }

  /**
   * Get Today's Attendance Punch Status for Logged-in Employee
   * GET /attendance/todayStatus
   */
  static async getTodayAttendanceStatus(req, res) {
    try {
      const employeeId = req.user?._id;
      const isAdmin = req.user?.role === "admin";
      const todayDate = getNormalizedDateString();
      const formattedToday = formatDisplayDate();

      // 🌟 IF ADMIN: NO SHIFT RESTRICTIONS 🌟
      if (isAdmin) {
        let attendance = await AttendanceModel.findOne({ employee: employeeId, date: todayDate });
        const hasCheckedIn = Boolean(attendance && attendance.checkInTime);
        const hasCheckedOut = Boolean(attendance && attendance.checkOutTime);
        let elapsedMinutes = 0;
        if (hasCheckedIn) {
          const checkInDate = new Date(attendance.checkInTime);
          const now = new Date();
          elapsedMinutes = Math.max(0, Math.floor((now.getTime() - checkInDate.getTime()) / (1000 * 60)));
        }

        return sendSuccessResponse(res, "Today's attendance status retrieved", {
          date: todayDate,
          formattedDate: formattedToday,
          hasCheckedIn,
          canCheckIn: !hasCheckedIn,
          isShiftEnded: false,
          isShiftNotStarted: false,
          shiftStartTime: null,
          shiftEndTime: null,
          checkInTime: attendance?.checkInDisplay || null,
          isCheckInRegularized: attendance?.isCheckInRegularized || false,
          hasCheckedOut,
          checkOutTime: attendance?.checkOutDisplay || null,
          isCheckOutRegularized: attendance?.isCheckOutRegularized || false,
          totalWorkHours: attendance?.totalWorkHoursDisplay || "0h 00m",
          status: attendance?.status || (hasCheckedIn ? "Present" : "Not Checked In"),
          requiredWorkHours: "Flexible",
          earliestAllowedCheckOut: null,
          elapsedMinutes,
          remainingMinutes: 0,
          remainingTimeDisplay: "Completed",
          isHoursCompleted: true,
          isEarlyOutApproved: false,
          approvedEarlyOutTime: null,
          canCheckOut: hasCheckedIn && !hasCheckedOut,
          isPendingRegularization: false,
          pendingRegularization: null,
          isPendingEarlyOut: false,
          pendingEarlyOutRequest: null,
          approvedLeave: null,
          isPendingLeave: false,
          pendingLeaveRequest: null,
          assignedShift: null,
        });
      }

      // 🌟 FOR EMPLOYEE: RETRIEVE TODAY'S OR OVERNIGHT ATTENDANCE 🌟
      let attendance = await AttendanceModel.findOne({ employee: employeeId, date: todayDate });

      // If no check-in today, check if there is an active checked-in shift from yesterday (e.g. overnight shift 11 PM to 7 AM)
      if (!attendance || !attendance.checkInTime) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayDate = getNormalizedDateString(yesterday);

        const openOvernight = await AttendanceModel.findOne({
          employee: employeeId,
          date: yesterdayDate,
          checkInTime: { $ne: null },
          checkOutTime: null,
        });

        if (openOvernight) {
          attendance = openOvernight;
        }
      }

      const [
        pendingRegularization,
        pendingEarlyOut,
        approvedEarlyOut,
        approvedLeave,
        pendingLeave,
        user,
      ] = await Promise.all([
        AttendanceRegularizationModel.findOne({
          employee: employeeId,
          date: attendance?.date || todayDate,
          correctionType: "Missed Check-In",
          status: "Pending",
        }),
        AttendanceRegularizationModel.findOne({
          employee: employeeId,
          date: attendance?.date || todayDate,
          correctionType: {
            $in: ["Early Out Regularization", "Leave", "Half Day Leave", "Early Departure"],
          },
          status: "Pending",
        }),
        AttendanceRegularizationModel.findOne({
          employee: employeeId,
          date: attendance?.date || todayDate,
          correctionType: {
            $in: ["Early Out Regularization", "Leave", "Half Day Leave", "Early Departure"],
          },
          status: "Approved",
        }),
        LeaveModel.findOne({
          employee: employeeId,
          fromDate: { $lte: attendance?.date || todayDate },
          toDate: { $gte: attendance?.date || todayDate },
          status: "Approved",
        }),
        LeaveModel.findOne({
          employee: employeeId,
          fromDate: { $lte: attendance?.date || todayDate },
          toDate: { $gte: attendance?.date || todayDate },
          status: "Pending",
        }),
        UserModel.findById(employeeId)
          .populate("shift")
          .populate("shiftAndSchedule.shift"),
      ]);

      // 🌟 RESOLVE TARGET SHIFT FOR EMPLOYEE 🌟
      let targetShift = null;
      if (req.query?.shiftId && mongoose.Types.ObjectId.isValid(req.query.shiftId)) {
        targetShift = await ShiftModel.findById(req.query.shiftId);
      }
      if (!targetShift) {
        targetShift = user?.shift || user?.shiftAndSchedule?.shift || null;
      }
      if (!targetShift) {
        targetShift =
          (await ShiftModel.findOne({ isDefault: true, status: "Active" })) ||
          (await ShiftModel.findOne({ status: "Active" }));
      }

      const hasCheckedIn = Boolean(attendance && attendance.checkInTime);
      const hasCheckedOut = Boolean(attendance && attendance.checkOutTime);

      // Synchronize break auto-stop and late penalties if employee is currently checked in
      if (hasCheckedIn && !hasCheckedOut && attendance) {
        const { modified } = syncAttendanceBreakStatus(attendance, targetShift, new Date());
        if (modified) {
          await attendance.save();
        }
      }

      const requiredWorkMinutes = attendance?.requiredWorkMinutes || 540;
      let earliestCheckoutDisplay = attendance?.earliestAllowedCheckOutDisplay || null;
      let elapsedMinutes = 0;
      let remainingMinutes = 0;
      let remainingTimeDisplay = "0h 00m";
      let isHoursCompleted = false;

      if (hasCheckedIn) {
        const checkInDate = new Date(attendance.checkInTime);
        const now = new Date();
        elapsedMinutes = Math.max(0, Math.floor((now.getTime() - checkInDate.getTime()) / (1000 * 60)));

        if (!earliestCheckoutDisplay) {
          const earliestDate = new Date(checkInDate.getTime() + requiredWorkMinutes * 60 * 1000);
          earliestCheckoutDisplay = formatTimeDisplay(earliestDate);
        }

        const effectiveEarliestCheckout = attendance.earliestAllowedCheckOut || new Date(checkInDate.getTime() + requiredWorkMinutes * 60000);
        isHoursCompleted = now.getTime() >= effectiveEarliestCheckout.getTime();
        const remainingMs = Math.max(0, effectiveEarliestCheckout.getTime() - now.getTime());
        remainingMinutes = Math.ceil(remainingMs / (1000 * 60));
        const remH = Math.floor(remainingMinutes / 60);
        const remM = remainingMinutes % 60;
        remainingTimeDisplay = isHoursCompleted ? "Completed" : `${remH}h ${String(remM).padStart(2, "0")}m remaining`;
      }

      const isEarlyOutApproved = Boolean(
        attendance?.isEarlyOutApproved || approvedEarlyOut || approvedLeave
      );
      const approvedEarlyOutTime =
        attendance?.approvedEarlyOutTime ||
        approvedEarlyOut?.requestedTimestamp ||
        (approvedLeave ? "Approved Leave" : null);

      let canCheckOut = false;
      if (hasCheckedIn && !hasCheckedOut) {
        if (isHoursCompleted || isEarlyOutApproved) {
          canCheckOut = true;
        }
      }

      const shiftStartTime = targetShift?.startTime || "09:00 AM";
      const shiftEndTime = targetShift?.endTime || "06:00 PM";
      const shiftTimingStatus = evaluateShiftTiming(shiftStartTime, shiftEndTime, new Date());
      const isShiftEnded = !hasCheckedIn && shiftTimingStatus.isShiftEnded;
      const isShiftNotStarted = !hasCheckedIn && shiftTimingStatus.isShiftNotStarted;
      const canCheckIn = !hasCheckedIn && shiftTimingStatus.isShiftActive;

      const canStartTracker = Boolean(
        hasCheckedIn &&
        !hasCheckedOut &&
        (attendance?.trackerStatus === "BREAK_ENDED_PENDING_START" ||
          attendance?.trackerStatus === "ON_BREAK" ||
          attendance?.trackerStatus === "PAUSED" ||
          attendance?.trackerStatus === "STOPPED")
      );

      const canPauseTracker = Boolean(
        hasCheckedIn && !hasCheckedOut && attendance?.trackerStatus === "RUNNING"
      );

      const breakPenaltyDisplay =
        (attendance?.totalBreakLateMinutes || 0) > 0
          ? `+${attendance.totalBreakLateMinutes} mins added to shift end due to late break resume`
          : "No penalty";

      return sendSuccessResponse(res, "Today's attendance status retrieved", {
        date: todayDate,
        formattedDate: formattedToday,
        hasCheckedIn,
        canCheckIn,
        isShiftEnded,
        isShiftNotStarted,
        shiftStartTime,
        shiftEndTime,
        checkInTime: attendance?.checkInDisplay || null,
        isCheckInRegularized: attendance?.isCheckInRegularized || false,
        hasCheckedOut,
        checkOutTime: attendance?.checkOutDisplay || null,
        isCheckOutRegularized: attendance?.isCheckOutRegularized || false,
        totalWorkHours: attendance?.totalWorkHoursDisplay || "0h 00m",
        status: attendance?.status || "Not Checked In",
        requiredWorkHours: `${Math.round(requiredWorkMinutes / 60)} Hours`,
        originalEarliestAllowedCheckOut: attendance?.originalEarliestAllowedCheckOutDisplay || earliestCheckoutDisplay,
        earliestAllowedCheckOut: earliestCheckoutDisplay,
        elapsedMinutes,
        remainingMinutes,
        remainingTimeDisplay,
        isHoursCompleted,
        isEarlyOutApproved,
        approvedEarlyOutTime: attendance?.approvedEarlyOutTime || approvedEarlyOut?.requestedTimestamp || null,
        canCheckOut,
        // Tracker & Break Automation Fields
        trackerStatus: attendance?.trackerStatus || (hasCheckedOut ? "COMPLETED" : hasCheckedIn ? "RUNNING" : "NOT_STARTED"),
        activeBreak: attendance?.activeBreak || null,
        breaks: attendance?.breaks || [],
        totalBreakLateMinutes: attendance?.totalBreakLateMinutes || 0,
        breakPenaltyDisplay,
        canStartTracker,
        canPauseTracker,
        isPendingRegularization: Boolean(pendingRegularization),
        pendingRegularization: pendingRegularization || null,
        isPendingEarlyOut: Boolean(pendingEarlyOut),
        pendingEarlyOutRequest: pendingEarlyOut || null,
        approvedLeave: approvedLeave || null,
        isPendingLeave: Boolean(pendingLeave),
        pendingLeaveRequest: pendingLeave || null,
        assignedShift: targetShift
          ? {
            _id: targetShift._id,
            shiftName: targetShift.shiftName,
            startTime: targetShift.startTime,
            endTime: targetShift.endTime,
            durationHours: targetShift.durationHours,
            workHoursDisplay: targetShift.workHoursDisplay,
            color: targetShift.color,
            breakTime: targetShift.breakTime,
            teaBreakCount: targetShift.teaBreakCount,
            teaBreakDuration: targetShift.teaBreakDuration,
            teaBreaks: targetShift.teaBreaks,
          }
          : null,
      });
    } catch (error) {
      console.error("Get Today Status Error:", error);
      return sendErrorResponse(res, 500, "Failed to retrieve attendance status", error);
    }
  }

  /**
   * Submit Attendance Regularization Request
   * (Employee applies, or Admin creates for employee)
   * POST /attendance/applyRegularization
   */
  static async applyRegularization(req, res) {
    try {
      const {
        date,
        correctionType,
        requestedTimestamp,
        reason,
        originalPunch: customOriginalPunch,
        employeeId: targetEmployeeId,
      } = req.body;

      if (!date || !date.trim()) {
        const todayNormalized = getNormalizedDateString();
        const todayDisplay = formatDisplayDate();
        return sendBadRequestResponse(
          res,
          `Date is required (e.g. '${todayNormalized}' or '${todayDisplay}')`
        );
      }
      if (!correctionType || !correctionType.trim()) {
        return sendBadRequestResponse(
          res,
          "Correction type is required (Missed Check-In, Missed Check-Out, Late In Regularization, Early Out Regularization, Leave, Half Day Leave)"
        );
      }
      if (!requestedTimestamp || !requestedTimestamp.trim()) {
        const currentTime = formatTimeDisplay(new Date());
        return sendBadRequestResponse(
          res,
          `Requested timestamp is required (e.g. '${currentTime}')`
        );
      }
      if (!reason || !reason.trim()) {
        return sendBadRequestResponse(res, "Reason for regularization is required");
      }

      // Determine target employee
      let finalEmployeeId = req.user?._id;
      if (req.user?.role === "admin" && targetEmployeeId) {
        if (!mongoose.Types.ObjectId.isValid(targetEmployeeId)) {
          return sendBadRequestResponse(res, "Invalid target employee ID");
        }
        finalEmployeeId = targetEmployeeId;
      }

      // Format date
      const normalizedDate = getNormalizedDateString(date);
      const displayDate = formatDisplayDate(date);

      // Check for existing pending request for this employee, date, and correctionType
      const existingPending = await AttendanceRegularizationModel.findOne({
        employee: finalEmployeeId,
        date: normalizedDate,
        correctionType: correctionType.trim(),
        status: "Pending",
      });

      if (existingPending) {
        return res.status(409).json({
          success: false,
          message: `A pending regularization request for '${correctionType.trim()}' on ${displayDate} already exists.`,
          result: existingPending,
        });
      }

      // Determine original punch
      let originalPunch = customOriginalPunch;
      if (!originalPunch || !originalPunch.trim()) {
        const attendance = await AttendanceModel.findOne({
          employee: finalEmployeeId,
          date: normalizedDate,
        });

        if (correctionType.trim() === "Missed Check-In") {
          originalPunch = "Missed Check-In";
        } else if (correctionType.trim() === "Missed Check-Out") {
          originalPunch = "Missed Check-Out";
        } else if (correctionType.trim() === "Late In Regularization") {
          originalPunch = attendance?.checkInDisplay
            ? `${attendance.checkInDisplay} (Late)`
            : "Late Punch";
        } else if (
          [
            "Early Out Regularization",
            "Leave",
            "Half Day Leave",
            "Early Departure",
          ].includes(correctionType.trim())
        ) {
          originalPunch = attendance?.checkInDisplay
            ? `Checked In at ${attendance.checkInDisplay}`
            : attendance?.checkOutDisplay
              ? `${attendance.checkOutDisplay} (Early)`
              : "Leave / Early Departure Request";
        } else {
          originalPunch = "Discrepancy";
        }
      }

      const newRequest = await AttendanceRegularizationModel.create({
        employee: finalEmployeeId,
        date: normalizedDate,
        formattedDate: displayDate,
        correctionType: correctionType.trim(),
        originalPunch: originalPunch.trim(),
        requestedTimestamp: requestedTimestamp.trim(),
        reason: reason.trim(),
        status: "Pending",
        submittedBy: req.user?._id,
      });

      const populated = await AttendanceRegularizationModel.findById(newRequest._id).populate(
        "employee",
        "name firstName lastName employeeId avatarUrl email department designation"
      );

      await recordAuditLog(req, {
        action: "Submitted Attendance Regularization Request",
        category: "Attendance & Regularization",
        description: `Submitted ${correctionType.trim()} request for ${displayDate} (${requestedTimestamp.trim()})`,
        targetResource: `${displayDate} - ${correctionType.trim()}`,
      });

      return sendCreatedResponse(res, "Regularization request submitted successfully!", populated);
    } catch (error) {
      console.error("Apply Regularization Error:", error);
      return sendErrorResponse(res, 500, "Failed to submit regularization request", error);
    }
  }

  /**
   * Get Logged-in Employee's Submitted Regularization Requests
   * (Screenshot 4: "My Submitted Correction Requests")
   * GET /attendance/myRegularizations
   */
  static async getMyRegularizations(req, res) {
    try {
      const employeeId = req.user?._id;
      const { status, search, page = 1, limit = 10 } = req.query;

      const filter = { employee: employeeId };
      if (status && status !== "all") {
        filter.status = new RegExp(`^${status.trim()}$`, "i");
      }

      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        filter.$or = [
          { reason: regex },
          { correctionType: regex },
          { formattedDate: regex },
          { date: regex },
        ];
      }

      const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

      const [requests, total] = await Promise.all([
        AttendanceRegularizationModel.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit, 10)),
        AttendanceRegularizationModel.countDocuments(filter),
      ]);

      return sendSuccessResponse(res, "My regularization requests retrieved successfully", {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(total / parseInt(limit, 10)),
        requests,
      });
    } catch (error) {
      console.error("Get My Regularizations Error:", error);
      return sendErrorResponse(res, 500, "Failed to retrieve requests", error);
    }
  }

  /**
   * Get Admin Regularization Inbox
   * (Screenshot 1: "Attendance Corrections - Regularization Inbox")
   * GET /attendance/regularizationInbox
   *
   * Query params:
   *   - status: "all" | "pending" | "approved" | "rejected"
   *   - search: employee name, employeeId, reason, date
   */
  static async getRegularizationInbox(req, res) {
    try {
      const { status, search, page = 1, limit = 10 } = req.query;

      // 1. Compute Tab Counters (All, Pending, Approved, Rejected)
      const [allCount, pendingCount, approvedCount, rejectedCount] = await Promise.all([
        AttendanceRegularizationModel.countDocuments({}),
        AttendanceRegularizationModel.countDocuments({ status: "Pending" }),
        AttendanceRegularizationModel.countDocuments({ status: "Approved" }),
        AttendanceRegularizationModel.countDocuments({ status: "Rejected" }),
      ]);

      const counters = {
        all: allCount,
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
      };

      // 2. Build filter
      const filter = {};
      if (status && status.toLowerCase() !== "all") {
        filter.status = new RegExp(`^${status.trim()}$`, "i");
      }

      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");

        // Find matching employees first
        const matchingUsers = await UserModel.find({
          $or: [{ name: regex }, { firstName: regex }, { lastName: regex }, { employeeId: regex }],
        }).select("_id");

        const userIds = matchingUsers.map((u) => u._id);

        filter.$or = [
          { employee: { $in: userIds } },
          { reason: regex },
          { correctionType: regex },
          { formattedDate: regex },
          { date: regex },
        ];
      }

      const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

      const [requests, total] = await Promise.all([
        AttendanceRegularizationModel.find(filter)
          .populate("employee", "name firstName lastName employeeId avatarUrl email department designation")
          .populate("actionBy", "name firstName lastName email")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit, 10)),
        AttendanceRegularizationModel.countDocuments(filter),
      ]);

      return sendSuccessResponse(res, "Regularization inbox retrieved successfully", {
        counters,
        pagination: {
          total,
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          totalPages: Math.ceil(total / parseInt(limit, 10)),
        },
        requests,
      });
    } catch (error) {
      console.error("Get Regularization Inbox Error:", error);
      return sendErrorResponse(res, 500, "Failed to retrieve inbox", error);
    }
  }

  /**
   * Admin Approve or Reject Regularization Request
   * PATCH /attendance/actionRegularization/:id
   *
   * WHEN APPROVED:
   * Updates or creates Attendance record for that day.
   * If 'Missed Check-In' is approved, check-in is saved, enabling the employee to Check-Out!
   */
  static async actionRegularization(req, res) {
    try {
      const { id } = req.params;
      const { action, managerNote = "", rejectionReason = "" } = req.body;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid regularization request ID");
      }

      if (!action || !["approve", "reject"].includes(action.toLowerCase())) {
        return sendBadRequestResponse(res, "Action must be either 'approve' or 'reject'");
      }

      const request = await AttendanceRegularizationModel.findById(id).populate("employee");
      if (!request) {
        return sendNotFoundResponse(res, "Regularization request not found");
      }

      if (request.status !== "Pending") {
        return sendBadRequestResponse(
          res,
          `This request has already been ${request.status.toLowerCase()} and cannot be modified.`
        );
      }

      const isApprove = action.toLowerCase() === "approve";

      if (isApprove) {
        request.status = "Approved";
        request.managerNote = managerNote ? managerNote.trim() : "Approved by administrator.";
        request.actionBy = req.user?._id;
        request.actionAt = new Date();

        // 🌟 APPLY REGULARIZATION TO ATTENDANCE RECORD 🌟
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
          // Record the regularized check-in!
          attendance.checkInTime = requestedDateObj;
          attendance.checkInDisplay = request.requestedTimestamp;
          attendance.isCheckInRegularized = true;
          attendance.status = "Present";
          attendance.notes = `Check-in regularized by Admin: ${request.reason}`;
        } else if (request.correctionType === "Missed Check-Out") {
          // Record the regularized check-out!
          attendance.checkOutTime = requestedDateObj;
          attendance.checkOutDisplay = request.requestedTimestamp;
          attendance.isCheckOutRegularized = true;
          attendance.notes = `Check-out regularized by Admin: ${request.reason}`;

          // Calculate work hours if check-in is present
          if (attendance.checkInTime) {
            const diffMs = requestedDateObj.getTime() - new Date(attendance.checkInTime).getTime();
            const totalMinutes = Math.max(0, Math.floor(diffMs / (1000 * 60)));
            const hours = Math.floor(totalMinutes / 60);
            const mins = totalMinutes % 60;
            attendance.totalWorkMinutes = totalMinutes;
            attendance.totalWorkHoursDisplay = `${hours}h ${String(mins).padStart(2, "0")}m`;
          }
        } else if (request.correctionType === "Late In Regularization") {
          attendance.checkInTime = requestedDateObj;
          attendance.checkInDisplay = request.requestedTimestamp;
          attendance.isCheckInRegularized = true;
          attendance.status = "Present"; // Overrides 'Late' to 'Present'
          attendance.notes = `Late punch regularized by Admin: ${request.reason}`;
        } else if (
          [
            "Early Out Regularization",
            "Leave",
            "Half Day Leave",
            "Early Departure",
          ].includes(request.correctionType)
        ) {
          const todayDate = getNormalizedDateString();
          attendance.isEarlyOutApproved = true;
          attendance.approvedEarlyOutTime = request.requestedTimestamp || formatTimeDisplay(new Date());

          if (request.correctionType === "Half Day Leave") {
            attendance.status = "Half Day";
          } else if (request.correctionType === "Leave") {
            attendance.status = attendance.checkInTime ? "Half Day" : "On Leave";
          }

          attendance.notes = attendance.notes
            ? `${attendance.notes} | ${request.correctionType} approved by Admin (${request.requestedTimestamp}): ${request.reason}`
            : `${request.correctionType} approved by Admin (${request.requestedTimestamp}): ${request.reason}`;

          // If the request was for a past date, also set checkout time directly
          if (request.date !== todayDate) {
            attendance.checkOutTime = requestedDateObj;
            attendance.checkOutDisplay = request.requestedTimestamp;
            attendance.isCheckOutRegularized = true;
            if (attendance.checkInTime) {
              const diffMs = requestedDateObj.getTime() - new Date(attendance.checkInTime).getTime();
              const totalMinutes = Math.max(0, Math.floor(diffMs / (1000 * 60)));
              const hours = Math.floor(totalMinutes / 60);
              const mins = totalMinutes % 60;
              attendance.totalWorkMinutes = totalMinutes;
              attendance.totalWorkHoursDisplay = `${hours}h ${String(mins).padStart(2, "0")}m`;
            }
          }
        }

        await attendance.save();
      } else {
        // Reject
        request.status = "Rejected";
        request.rejectionReason = rejectionReason
          ? rejectionReason.trim()
          : managerNote || "Request rejected by administrator.";
        request.actionBy = req.user?._id;
        request.actionAt = new Date();
      }

      await request.save();

      await recordAuditLog(req, {
        action: `${isApprove ? "Approved" : "Rejected"} Attendance Regularization`,
        category: "Attendance & Regularization",
        description: `${isApprove ? "Approved" : "Rejected"} ${request.correctionType} for ${request.employee?.name || "Employee"
          } on ${request.formattedDate}`,
        targetResource: `${request.employee?.name} - ${request.formattedDate}`,
      });

      return sendSuccessResponse(
        res,
        `Attendance regularization request ${request.status.toLowerCase()} successfully!`,
        request
      );
    } catch (error) {
      console.error("Action Regularization Error:", error);
      return sendErrorResponse(res, 500, "Failed to update regularization request", error);
    }
  }

  /**
   * Start / Resume Employee Tracker
   * POST /attendance/startTracker or POST /attendance/resumeTracker
   *
   * BUSINESS REQUIREMENT:
   * When break (tea break or lunch break) finishes, tracker DOES NOT auto-start.
   * Employee must manually click start.
   * If employee starts tracker late after break finish time, that late delay is
   * added at the end ("last ma add thy jase") -> earliestAllowedCheckOut is extended!
   */
  static async startTracker(req, res) {
    try {
      const employeeId = req.user?._id;
      const isAdmin = req.user?.role === "admin";
      if (!employeeId) {
        return sendBadRequestResponse(res, "Authentication required");
      }

      const todayDate = getNormalizedDateString();
      const now = new Date();

      let attendance = await AttendanceModel.findOne({
        employee: employeeId,
        date: todayDate,
      });

      // If no check-in today, check if there is an active overnight shift
      if (!attendance || !attendance.checkInTime) {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayDate = getNormalizedDateString(yesterday);

        const openOvernight = await AttendanceModel.findOne({
          employee: employeeId,
          date: yesterdayDate,
          checkInTime: { $ne: null },
          checkOutTime: null,
        });

        if (openOvernight) {
          attendance = openOvernight;
        }
      }

      if (!attendance || !attendance.checkInTime) {
        return sendBadRequestResponse(
          res,
          "You have not checked in yet! Please check in first before starting the tracker."
        );
      }

      if (attendance.checkOutTime) {
        return sendBadRequestResponse(
          res,
          `You have already checked out for today at ${attendance.checkOutDisplay}.`
        );
      }

      // Resolve employee shift
      let activeShift = null;
      if (!isAdmin) {
        const user = await UserModel.findById(employeeId)
          .populate("shift")
          .populate("shiftAndSchedule.shift");
        activeShift = user?.shift || user?.shiftAndSchedule?.shift || null;
        if (!activeShift) {
          activeShift =
            (await ShiftModel.findOne({ isDefault: true, status: "Active" })) ||
            (await ShiftModel.findOne({ status: "Active" }));
        }
      }

      // 1. Sync current break status first
      const { modified } = syncAttendanceBreakStatus(attendance, activeShift, now);
      if (modified) {
        await attendance.save();
      }

      // If already running and no active break or manual pause to resume
      if (attendance.trackerStatus === "RUNNING" && !attendance.activeBreak && !attendance.activePause) {
        return sendSuccessResponse(res, "Tracker is already running.", {
          trackerStatus: attendance.trackerStatus,
          earliestAllowedCheckOut: attendance.earliestAllowedCheckOutDisplay,
          totalBreakLateMinutes: attendance.totalBreakLateMinutes || 0,
          totalManualPauseMinutes: attendance.totalManualPauseMinutes || 0,
          totalWorkHours: attendance.totalWorkHoursDisplay,
          breaks: attendance.breaks,
        });
      }

      // 2. Resume tracker and compute late restart penalties or manual pause durations
      const result = await resumeEmployeeTracker(attendance, now, activeShift?.startTime);

      await recordAuditLog(req, {
        action: "Started / Resumed Attendance Tracker",
        category: "Attendance & Breaks",
        description: `Employee resumed tracker. ${result.penaltyMessage}`,
        targetResource: `${attendance.date} - Tracker Resumed`,
      });

      let responseMsg = "";
      if (result.resumedType === "MANUAL_PAUSE") {
        responseMsg =
          result.pausedMinutes > 0
            ? `Tracker resumed successfully! You paused for ${result.pausedMinutes} minute(s). ${result.pausedMinutes} minute(s) added to your shift checkout time. Earliest checkout is now ${attendance.earliestAllowedCheckOutDisplay}.`
            : "Tracker resumed successfully from manual pause.";
      } else {
        responseMsg =
          result.lateMinutes > 0
            ? `Tracker started! You resumed ${result.lateMinutes} minute(s) late after ${result.resumedBreak?.name || "break"}. ${result.lateMinutes} minute(s) added to your shift end time. New earliest checkout is ${attendance.earliestAllowedCheckOutDisplay}.`
            : `Tracker started successfully! Resumed on time from ${result.resumedBreak?.name || "break"}.`;
      }

      return sendSuccessResponse(
        res,
        responseMsg,
        {
          trackerStatus: attendance.trackerStatus,
          resumedType: result.resumedType,
          lateMinutesAdded: result.lateMinutes || 0,
          manualPauseMinutesAdded: result.pausedMinutes || 0,
          totalBreakLateMinutes: attendance.totalBreakLateMinutes || 0,
          totalManualPauseMinutes: attendance.totalManualPauseMinutes || 0,
          originalEarliestAllowedCheckOut: attendance.originalEarliestAllowedCheckOutDisplay,
          earliestAllowedCheckOut: attendance.earliestAllowedCheckOutDisplay,
          totalWorkHours: attendance.totalWorkHoursDisplay,
          activeBreak: null,
          activePause: null,
          resumedBreak: result.resumedBreak,
          manualPauses: attendance.manualPauses || [],
          breaks: attendance.breaks,
          notes: attendance.notes,
        }
      );
    } catch (error) {
      console.error("Start Tracker Error:", error);
      return sendErrorResponse(res, 500, "Failed to start tracker", error);
    }
  }

  /**
   * Pause Tracker / Custom Pause Manually (for employee's own reason)
   * POST /attendance/pauseTracker
   * NOTE: This does NOT consume scheduled breaks (Lunch / Tea Break).
   * Scheduled breaks only trigger automatically at scheduled times.
   */
  static async pauseTracker(req, res) {
    try {
      const employeeId = req.user?._id;
      if (!employeeId) {
        return sendBadRequestResponse(res, "Authentication required");
      }

      const todayDate = getNormalizedDateString();
      const now = new Date();

      let attendance = await AttendanceModel.findOne({
        employee: employeeId,
        date: todayDate,
      });

      // If no check-in today, check if there is an active overnight shift
      if (!attendance || !attendance.checkInTime) {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayDate = getNormalizedDateString(yesterday);

        const openOvernight = await AttendanceModel.findOne({
          employee: employeeId,
          date: yesterdayDate,
          checkInTime: { $ne: null },
          checkOutTime: null,
        });

        if (openOvernight) {
          attendance = openOvernight;
        }
      }

      if (!attendance || !attendance.checkInTime) {
        return sendBadRequestResponse(res, "You have not checked in today.");
      }

      if (attendance.checkOutTime) {
        return sendBadRequestResponse(res, "You have already checked out for today.");
      }

      if (attendance.trackerStatus === "ON_BREAK" || attendance.trackerStatus === "BREAK_ENDED_PENDING_START") {
        return sendBadRequestResponse(
          res,
          `Tracker is already stopped for scheduled break (${attendance.activeBreak?.name || "Break"}).`
        );
      }

      if (attendance.trackerStatus === "PAUSED") {
        return sendBadRequestResponse(
          res,
          "Tracker is already paused."
        );
      }

      // Safe body handling (defaults gracefully if body is empty or undefined)
      const body = req.body || {};
      const reason = body.reason || body.breakName || "Manual Pause / Personal Reason";

      await pauseEmployeeTracker(attendance, reason, now);

      await recordAuditLog(req, {
        action: "Paused Attendance Tracker",
        category: "Attendance & Breaks",
        description: `Employee paused tracker. Reason: ${reason}`,
        targetResource: `${attendance.date} - ${reason}`,
      });

      return sendSuccessResponse(res, `Tracker paused successfully (${reason}).`, {
        trackerStatus: attendance.trackerStatus,
        activePause: attendance.activePause,
        activeBreak: attendance.activeBreak || null,
        totalManualPauseMinutes: attendance.totalManualPauseMinutes || 0,
        manualPauses: attendance.manualPauses || [],
        breaks: attendance.breaks,
        earliestAllowedCheckOut: attendance.earliestAllowedCheckOutDisplay,
      });
    } catch (error) {
      console.error("Pause Tracker Error:", error);
      return sendErrorResponse(res, 500, "Failed to pause tracker", error);
    }
  }

  /**
   * Get Today's Break Summary & Late Penalty Details
   * GET /attendance/breakSummary
   */
  static async getBreakSummary(req, res) {
    try {
      const employeeId = req.user?._id;
      if (!employeeId) {
        return sendBadRequestResponse(res, "Authentication required");
      }

      const todayDate = getNormalizedDateString();
      const attendance = await AttendanceModel.findOne({
        employee: employeeId,
        date: todayDate,
      });

      if (!attendance || !attendance.checkInTime) {
        return sendSuccessResponse(res, "No active attendance record found for today", {
          hasCheckedIn: false,
          trackerStatus: "NOT_STARTED",
          breaks: [],
          totalBreakLateMinutes: 0,
        });
      }

      const user = await UserModel.findById(employeeId)
        .populate("shift")
        .populate("shiftAndSchedule.shift");
      const activeShift =
        user?.shift ||
        user?.shiftAndSchedule?.shift ||
        (await ShiftModel.findOne({ isDefault: true, status: "Active" }));

      const { modified } = syncAttendanceBreakStatus(attendance, activeShift, new Date());
      if (modified) {
        await attendance.save();
      }

      const totalBreakLateMinutes = attendance.totalBreakLateMinutes || 0;
      const totalManualPauseMinutes = attendance.totalManualPauseMinutes || 0;
      const totalDelay = totalBreakLateMinutes + totalManualPauseMinutes;

      let penaltyMessage = "No penalties or pause delays today";
      if (totalBreakLateMinutes > 0 && totalManualPauseMinutes > 0) {
        penaltyMessage = `+${totalDelay} minute(s) added to shift end (${totalBreakLateMinutes}m break late + ${totalManualPauseMinutes}m manual pause)`;
      } else if (totalBreakLateMinutes > 0) {
        penaltyMessage = `+${totalBreakLateMinutes} minute(s) added to shift end due to late break resume`;
      } else if (totalManualPauseMinutes > 0) {
        penaltyMessage = `+${totalManualPauseMinutes} minute(s) added to shift end due to manual pause`;
      }

      return sendSuccessResponse(res, "Break summary retrieved successfully", {
        trackerStatus: attendance.trackerStatus,
        activeBreak: attendance.activeBreak,
        activePause: attendance.activePause || null,
        breaks: attendance.breaks,
        manualPauses: attendance.manualPauses || [],
        totalBreakLateMinutes,
        totalManualPauseMinutes,
        originalEarliestAllowedCheckOut: attendance.originalEarliestAllowedCheckOutDisplay,
        earliestAllowedCheckOut: attendance.earliestAllowedCheckOutDisplay,
        totalWorkMinutes: attendance.totalWorkMinutes,
        totalWorkHoursDisplay: attendance.totalWorkHoursDisplay,
        penaltyMessage,
      });
    } catch (error) {
      console.error("Get Break Summary Error:", error);
      return sendErrorResponse(res, 500, "Failed to retrieve break summary", error);
    }
  }
}