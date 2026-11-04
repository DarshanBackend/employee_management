import mongoose from "mongoose";
import ShiftModel from "../model/shift.model.js";
import ShiftRosterModel from "../model/shiftRoster.model.js";
import UserModel from "../model/user.model.js";
import DepartmentModel from "../model/department.model.js";
import { recordAuditLog } from "../utils/auditLogger.js";
import {
  sendCreatedResponse,
  sendSuccessResponse,
  sendErrorResponse,
  sendBadRequestResponse,
  sendNotFoundResponse,
} from "../utils/Response.utils.js";

// Helper: Parse time string like "09:00 AM", "06:30 PM", "14:30" to total minutes from midnight
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

// Helper: Calculate duration between start time and end time (supporting overnight shifts)
export const calculateShiftDuration = (startTime, endTime) => {
  const startMins = parseTimeToMinutes(startTime);
  const endMins = parseTimeToMinutes(endTime);

  let diffMins = endMins - startMins;
  // If end is less than or equal to start, it crosses midnight (e.g. 10:00 PM to 07:00 AM)
  if (diffMins <= 0) {
    diffMins += 24 * 60;
  }

  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  const durationHours = Number((diffMins / 60).toFixed(2));
  const workHoursDisplay = mins > 0 ? `${hours}h ${mins}m` : `${hours} Hours`;

  return { durationHours, workHoursDisplay };
};

// Helper: Format minutes from midnight to "hh:mm AM/PM"
export const formatMinutesToTime = (totalMinutes) => {
  let mins = Math.round(totalMinutes) % (24 * 60);
  if (mins < 0) mins += 24 * 60;
  let hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${ampm}`;
};

// Helper: Compute or standardize breakTime and teaBreaks for a Shift
export const resolveShiftBreaks = ({
  shiftStartTime,
  shiftEndTime,
  breakTimeInput,
  breakStartTimeInput,
  breakEndTimeInput,
  breakDurationInput,
  teaBreakCountInput,
  teaBreakDurationInput,
  beforeBreakCountInput,
  afterBreakCountInput,
  teaBreaksInput,
  teaBreak1StartTimeInput,
  teaBreak1EndTimeInput,
  teaBreak2StartTimeInput,
  teaBreak2EndTimeInput,
}) => {
  const shiftStartMins = parseTimeToMinutes(shiftStartTime || "09:00 AM");
  let shiftEndMins = parseTimeToMinutes(shiftEndTime || "06:00 PM");
  if (shiftEndMins <= shiftStartMins) shiftEndMins += 24 * 60;

  // 1. Resolve Lunch / Meal Break Time
  let lunchStart =
    (typeof breakTimeInput === "object" ? breakTimeInput?.startTime : null) ||
    breakStartTimeInput ||
    null;
  let lunchEnd =
    (typeof breakTimeInput === "object" ? breakTimeInput?.endTime : null) ||
    breakEndTimeInput ||
    null;
  let lunchDuration =
    (typeof breakTimeInput === "object"
      ? (breakTimeInput?.durationMinutes || breakTimeInput?.duration)
      : null) ||
    breakDurationInput ||
    null;

  if (!lunchStart && !lunchEnd) {
    // Default: roughly 4 hours after shift start (e.g. 01:00 PM for 09:00 AM shift)
    const defaultLunchStartMins = shiftStartMins + 4 * 60;
    lunchStart = formatMinutesToTime(defaultLunchStartMins);
    lunchEnd = formatMinutesToTime(defaultLunchStartMins + (parseInt(lunchDuration, 10) || 60));
    lunchDuration = 60;
  } else if (lunchStart && !lunchEnd) {
    const dur = parseInt(lunchDuration, 10) || 60;
    lunchEnd = formatMinutesToTime(parseTimeToMinutes(lunchStart) + dur);
    lunchDuration = dur;
  } else if (!lunchStart && lunchEnd) {
    const dur = parseInt(lunchDuration, 10) || 60;
    lunchStart = formatMinutesToTime(parseTimeToMinutes(lunchEnd) - dur);
    lunchDuration = dur;
  } else {
    // Both lunchStart and lunchEnd provided
    let sMin = parseTimeToMinutes(lunchStart);
    let eMin = parseTimeToMinutes(lunchEnd);
    if (eMin <= sMin) eMin += 24 * 60;
    lunchDuration = eMin - sMin;
  }

  // Determine appropriate main meal break name based on shift & time
  const lunchMins = parseTimeToMinutes(lunchStart);
  let resolvedBreakName = "Meal Break";
  if (lunchMins >= 660 && lunchMins < 930) {
    resolvedBreakName = "Lunch Break";
  } else if (lunchMins >= 1080 && lunchMins < 1350) {
    resolvedBreakName = "Dinner Break";
  } else if (lunchMins >= 1350 || lunchMins < 360) {
    resolvedBreakName = "Night Meal Break";
  } else {
    resolvedBreakName = "Meal Break";
  }

  const resolvedBreakTime = {
    name:
      (typeof breakTimeInput === "object" ? breakTimeInput?.name : null) ||
      resolvedBreakName,
    startTime: lunchStart,
    endTime: lunchEnd,
    durationMinutes: Number(lunchDuration) || 60,
  };

  // 2. Resolve Tea Breaks Count & Duration (Tea break is NOT compulsory!)
  let teaCount = 0;
  if (teaBreakCountInput !== undefined && teaBreakCountInput !== null) {
    const parsed = parseInt(teaBreakCountInput, 10);
    teaCount = isNaN(parsed) || parsed < 0 ? 0 : parsed;
  } else if (Array.isArray(teaBreaksInput)) {
    teaCount = teaBreaksInput.length;
  } else if (teaBreak1StartTimeInput || teaBreak2StartTimeInput) {
    teaCount = (teaBreak1StartTimeInput ? 1 : 0) + (teaBreak2StartTimeInput ? 1 : 0);
  } else if (beforeBreakCountInput !== undefined || afterBreakCountInput !== undefined) {
    teaCount = (parseInt(beforeBreakCountInput, 10) || 0) + (parseInt(afterBreakCountInput, 10) || 0);
  } else {
    teaCount = 0; // Not compulsory! Default is 0 unless explicitly configured.
  }

  let teaDuration =
    teaBreakDurationInput !== undefined && teaBreakDurationInput !== null
      ? parseInt(teaBreakDurationInput, 10)
      : 15;
  if (isNaN(teaDuration) || teaDuration <= 0) teaDuration = 15;

  let lunchStartMins = parseTimeToMinutes(resolvedBreakTime.startTime);
  let lunchEndMins = parseTimeToMinutes(resolvedBreakTime.endTime);
  if (lunchStartMins < shiftStartMins) lunchStartMins += 24 * 60;
  if (lunchEndMins < lunchStartMins) lunchEndMins += 24 * 60;

  // 3. Resolve Individual Tea Breaks
  let resolvedTeaBreaks = [];

  if (Array.isArray(teaBreaksInput) && teaBreaksInput.length > 0) {
    const beforeList = [];
    const afterList = [];

    teaBreaksInput.forEach((tb) => {
      const tbStart = tb.startTime || "11:00 AM";
      const dur = parseInt(tb.durationMinutes || tb.duration, 10) || teaDuration;
      const tbEnd = tb.endTime || formatMinutesToTime(parseTimeToMinutes(tbStart) + dur);

      let tbMins = parseTimeToMinutes(tbStart);
      if (tbMins < shiftStartMins) tbMins += 24 * 60;

      const isBefore =
        tb.position === "before_break"
          ? true
          : tb.position === "after_break"
            ? false
            : tbMins < lunchStartMins;

      const item = {
        name: tb.name,
        startTime: tbStart,
        endTime: tbEnd,
        durationMinutes: dur,
        position: isBefore ? "before_break" : "after_break",
        mins: tbMins,
      };

      if (isBefore) beforeList.push(item);
      else afterList.push(item);
    });

    beforeList.sort((a, b) => a.mins - b.mins);
    afterList.sort((a, b) => a.mins - b.mins);

    beforeList.forEach((b, idx) => {
      resolvedTeaBreaks.push({
        name: b.name && !b.name.includes("Tea Break") ? b.name : `Before Break ${idx + 1}`,
        startTime: b.startTime,
        endTime: b.endTime,
        durationMinutes: b.durationMinutes,
        position: "before_break",
      });
    });

    afterList.forEach((b, idx) => {
      resolvedTeaBreaks.push({
        name: b.name && !b.name.includes("Tea Break") ? b.name : `After Break ${idx + 1}`,
        startTime: b.startTime,
        endTime: b.endTime,
        durationMinutes: b.durationMinutes,
        position: "after_break",
      });
    });

    teaCount = resolvedTeaBreaks.length;
  } else if (teaBreak1StartTimeInput || teaBreak2StartTimeInput) {
    if (teaBreak1StartTimeInput) {
      const tb1End =
        teaBreak1EndTimeInput ||
        formatMinutesToTime(parseTimeToMinutes(teaBreak1StartTimeInput) + teaDuration);
      resolvedTeaBreaks.push({
        name: "Before Break 1",
        startTime: teaBreak1StartTimeInput,
        endTime: tb1End,
        durationMinutes: teaDuration,
        position: "before_break",
      });
    }
    if (teaBreak2StartTimeInput) {
      const tb2End =
        teaBreak2EndTimeInput ||
        formatMinutesToTime(parseTimeToMinutes(teaBreak2StartTimeInput) + teaDuration);
      resolvedTeaBreaks.push({
        name: "After Break 1",
        startTime: teaBreak2StartTimeInput,
        endTime: tb2End,
        durationMinutes: teaDuration,
        position: "after_break",
      });
    }
    teaCount = resolvedTeaBreaks.length;
  } else if (teaCount > 0) {
    // Auto-calculate positions only when teaCount > 0
    let beforeCount = 0;
    let afterCount = 0;

    if (beforeBreakCountInput !== undefined && beforeBreakCountInput !== null) {
      beforeCount = parseInt(beforeBreakCountInput, 10);
    } else if (teaCount === 1) {
      beforeCount = 1;
    } else if (teaCount === 3) {
      beforeCount = 2;
    } else if (teaCount >= 4) {
      beforeCount = Math.ceil(teaCount / 2);
    } else if (teaCount === 2) {
      beforeCount = 1;
    }

    if (afterBreakCountInput !== undefined && afterBreakCountInput !== null) {
      afterCount = parseInt(afterBreakCountInput, 10);
    } else if (teaCount === 1) {
      afterCount = 0;
    } else {
      afterCount = Math.max(0, teaCount - beforeCount);
    }

    // Distribute before breaks
    if (beforeCount > 0) {
      const beforeSpan = lunchStartMins - shiftStartMins;
      const step = beforeSpan / (beforeCount + 1);
      for (let i = 0; i < beforeCount; i++) {
        const startM = Math.floor(shiftStartMins + step * (i + 1));
        resolvedTeaBreaks.push({
          name: `Before Break ${i + 1}`,
          startTime: formatMinutesToTime(startM),
          endTime: formatMinutesToTime(startM + teaDuration),
          durationMinutes: teaDuration,
          position: "before_break",
        });
      }
    }

    // Distribute after breaks
    if (afterCount > 0) {
      const afterSpan = shiftEndMins - lunchEndMins;
      const step = afterSpan / (afterCount + 1);
      for (let i = 0; i < afterCount; i++) {
        const startM = Math.floor(lunchEndMins + step * (i + 1));
        resolvedTeaBreaks.push({
          name: `After Break ${i + 1}`,
          startTime: formatMinutesToTime(startM),
          endTime: formatMinutesToTime(startM + teaDuration),
          durationMinutes: teaDuration,
          position: "after_break",
        });
      }
    }

    teaCount = resolvedTeaBreaks.length;
  }

  return {
    breakTime: resolvedBreakTime,
    teaBreakCount: teaCount,
    teaBreakDuration: teaDuration,
    teaBreaks: resolvedTeaBreaks,
  };
};

// Helper: Get Monday and Sunday dates for a given date
export const getWeekBounds = (inputDate) => {
  const date = inputDate ? new Date(inputDate) : new Date();
  const day = date.getDay(); // 0 is Sunday, 1 is Monday...
  // Calculate distance to previous Monday (if Sunday (0), distance is -6)
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const formatDate = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dt = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dt}`;
  };

  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  const formattedRange = `${monthNames[monday.getMonth()]} ${String(
    monday.getDate()
  ).padStart(2, "0")} – ${monthNames[sunday.getMonth()]} ${String(
    sunday.getDate()
  ).padStart(2, "0")}, ${sunday.getFullYear()}`;

  const days = [];
  const dayNames = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const dayShortNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  for (let i = 0; i < 7; i++) {
    const curr = new Date(monday);
    curr.setDate(monday.getDate() + i);
    days.push({
      key: dayNames[i],
      shortName: dayShortNames[i],
      date: formatDate(curr),
      dayNumber: curr.getDate(),
      month: monthNames[curr.getMonth()],
    });
  }

  return {
    weekStartDate: formatDate(monday),
    weekEndDate: formatDate(sunday),
    formattedRange,
    days,
  };
};

export class ShiftController {
  /**
   * Create a new Shift
   * POST /addShift
   */
  static async addShift(req, res) {
    try {
      const {
        shiftName,
        shiftCode,
        startTime,
        endTime,
        color = "#3B82F6",
        description = "",
        isDefault = false,
        breakTime,
        breakStartTime,
        breakEndTime,
        breakDuration,
        lunchBreak,
        teaBreakCount,
        shortBreakCount,
        beforeBreakCount,
        afterBreakCount,
        teaBreakDuration,
        teaBreaks,
        teaBreak1StartTime,
        teaBreak1EndTime,
        teaBreak2StartTime,
        teaBreak2EndTime,
      } = req.body;

      if (!shiftName || !shiftName.trim()) {
        return sendBadRequestResponse(res, "Shift name is required!");
      }
      if (!startTime || !startTime.trim()) {
        return sendBadRequestResponse(res, "Shift start time is required (e.g. 09:00 AM)!");
      }
      if (!endTime || !endTime.trim()) {
        return sendBadRequestResponse(res, "Shift end time is required (e.g. 06:00 PM)!");
      }

      const cleanShiftName = shiftName.trim();

      const existingShift = await ShiftModel.findOne({
        shiftName: { $regex: new RegExp(`^${cleanShiftName}$`, "i") },
      });

      if (existingShift) {
        return res.status(409).json({
          success: false,
          message: `Shift '${cleanShiftName}' already exists.`,
        });
      }

      const { durationHours, workHoursDisplay } = calculateShiftDuration(startTime, endTime);

      // Compute break time (Meal/Lunch break) and tea breaks (short breaks)
      const {
        breakTime: resolvedBreakTime,
        teaBreakCount: resolvedTeaBreakCount,
        teaBreakDuration: resolvedTeaBreakDuration,
        teaBreaks: resolvedTeaBreaks,
      } = resolveShiftBreaks({
        shiftStartTime: startTime.trim(),
        shiftEndTime: endTime.trim(),
        breakTimeInput: breakTime || lunchBreak,
        breakStartTimeInput: breakStartTime,
        breakEndTimeInput: breakEndTime,
        breakDurationInput: breakDuration,
        teaBreakCountInput: teaBreakCount !== undefined ? teaBreakCount : shortBreakCount,
        teaBreakDurationInput: teaBreakDuration,
        beforeBreakCountInput: beforeBreakCount,
        afterBreakCountInput: afterBreakCount,
        teaBreaksInput: teaBreaks,
        teaBreak1StartTimeInput: teaBreak1StartTime,
        teaBreak1EndTimeInput: teaBreak1EndTime,
        teaBreak2StartTimeInput: teaBreak2StartTime,
        teaBreak2EndTimeInput: teaBreak2EndTime,
      });

      if (isDefault) {
        await ShiftModel.updateMany({}, { isDefault: false });
      }

      const newShift = await ShiftModel.create({
        shiftName: cleanShiftName,
        shiftCode: shiftCode ? shiftCode.trim().toUpperCase() : undefined,
        startTime: startTime.trim(),
        endTime: endTime.trim(),
        durationHours,
        workHoursDisplay,
        breakTime: resolvedBreakTime,
        teaBreakCount: resolvedTeaBreakCount,
        teaBreakDuration: resolvedTeaBreakDuration,
        teaBreaks: resolvedTeaBreaks,
        color: color ? color.trim() : "#3B82F6",
        description: description ? description.trim() : "",
        isDefault: Boolean(isDefault),
        status: "Active",
      });

      await recordAuditLog(req, {
        action: "Created New Shift",
        category: "Attendance & Shifts",
        description: `Created shift ${cleanShiftName} (${startTime.trim()} - ${endTime.trim()})`,
        targetResource: cleanShiftName,
        diff: {
          before: "None",
          after: `Timing: ${startTime.trim()} - ${endTime.trim()} (${workHoursDisplay})`,
        },
      });

      return sendCreatedResponse(res, "Shift created successfully!", {
        ...newShift.toObject(),
        assignedCount: 0,
      });
    } catch (error) {
      console.error("Add Shift Error:", error);
      return sendErrorResponse(res, 500, "Failed to create shift", error);
    }
  }

  /**
   * Get all active Shifts with dynamic assigned employee count
   * GET /getAllShifts
   */
  static async getAllShifts(req, res) {
    try {
      const { search, status, page, limit } = req.query;

      const filter = { isDeleted: { $ne: true } };
      if (status && status !== "All") {
        filter.status = status;
      }
      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        filter.$or = [{ shiftName: regex }, { shiftCode: regex }, { description: regex }];
      }

      const totalMatched = await ShiftModel.countDocuments(filter);

      let query = ShiftModel.find(filter).sort({ isDefault: -1, createdAt: 1 });

      if (page && limit) {
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const skip = (pageNum - 1) * limitNum;
        query = query.skip(skip).limit(limitNum);
      }

      const shifts = await query;

      // Calculate dynamic assigned employee count for each shift
      const shiftsWithCounts = await Promise.all(
        shifts.map(async (shift) => {
          const shiftObj = shift.toObject();

          // Count employees assigned to this shift (prioritizing employee.shift, falling back only when shift is unset)
          const assignedCount = await UserModel.countDocuments({
            role: "employee",
            isUserDeleted: { $ne: true },
            employeeStatus: { $ne: "Terminated" },
            $or: [
              { shift: shift._id },
              {
                $and: [
                  { shift: { $in: [null, undefined] } },
                  {
                    $or: [
                      { "shiftAndSchedule.shift": shift._id },
                      { "shiftAndSchedule.shiftTiming": shift.shiftName },
                    ],
                  },
                ],
              },
            ],
          });

          shiftObj.assignedCount = assignedCount;
          return shiftObj;
        })
      );

      const totalEmployeesWithShift = shiftsWithCounts.reduce(
        (sum, s) => sum + (s.assignedCount || 0),
        0
      );

      return sendSuccessResponse(res, "Shifts fetched successfully", {
        total: totalMatched,
        activeShiftsCount: shiftsWithCounts.filter((s) => s.status === "Active").length,
        totalAssignedEmployees: totalEmployeesWithShift,
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : totalMatched,
        totalPages: limit ? Math.ceil(totalMatched / parseInt(limit, 10)) || 1 : 1,
        shifts: shiftsWithCounts,
      });
    } catch (error) {
      console.error("Get All Shifts Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch shifts", error);
    }
  }

  /**
   * Get Shift by ID with list of assigned employees
   * GET /getShiftById/:id
   */
  static async getShiftById(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid shift ID");
      }

      const shift = await ShiftModel.findById(id);
      if (!shift) {
        return sendNotFoundResponse(res, "Shift not found");
      }

      const assignedEmployees = await UserModel.find({
        role: "employee",
        isUserDeleted: { $ne: true },
        $or: [
          { shift: shift._id },
          { "shiftAndSchedule.shift": shift._id },
          { "shiftAndSchedule.shiftTiming": shift.shiftName },
        ],
      })
        .select("_id name firstName lastName employeeId avatarUrl email employeeStatus department designation shiftAndSchedule")
        .populate("department", "departmentName icon color")
        .populate("designation", "designationName level");

      const shiftData = shift.toObject();
      shiftData.assignedCount = assignedEmployees.length;
      shiftData.assignedEmployees = assignedEmployees;

      return sendSuccessResponse(res, "Shift retrieved successfully", shiftData);
    } catch (error) {
      console.error("Get Shift By Id Error:", error);
      return sendErrorResponse(res, 500, "Failed to retrieve shift", error);
    }
  }

  /**
   * Update an existing Shift
   * PATCH /updateShift/:id
   */
  static async updateShift(req, res) {
    try {
      const { id } = req.params;
      const {
        shiftName,
        shiftCode,
        startTime,
        endTime,
        color,
        description,
        status,
        isDefault,
        breakTime,
        breakStartTime,
        breakEndTime,
        breakDuration,
        lunchBreak,
        teaBreakCount,
        shortBreakCount,
        beforeBreakCount,
        afterBreakCount,
        teaBreakDuration,
        teaBreaks,
        teaBreak1StartTime,
        teaBreak1EndTime,
        teaBreak2StartTime,
        teaBreak2EndTime,
      } = req.body;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid shift ID");
      }

      const shift = await ShiftModel.findById(id);
      if (!shift) {
        return sendNotFoundResponse(res, "Shift not found");
      }

      const oldName = shift.shiftName;

      if (shiftName && shiftName.trim() && shiftName.trim().toLowerCase() !== shift.shiftName.toLowerCase()) {
        const cleanName = shiftName.trim();
        const duplicate = await ShiftModel.findOne({
          _id: { $ne: id },
          shiftName: { $regex: new RegExp(`^${cleanName}$`, "i") },
        });

        if (duplicate) {
          return res.status(409).json({
            success: false,
            message: `Another shift with name '${cleanName}' already exists.`,
          });
        }
        shift.shiftName = cleanName;
      }

      if (shiftCode !== undefined) shift.shiftCode = shiftCode.trim().toUpperCase();
      if (startTime !== undefined) shift.startTime = startTime.trim();
      if (endTime !== undefined) shift.endTime = endTime.trim();

      if (startTime !== undefined || endTime !== undefined) {
        const { durationHours, workHoursDisplay } = calculateShiftDuration(shift.startTime, shift.endTime);
        shift.durationHours = durationHours;
        shift.workHoursDisplay = workHoursDisplay;
      }

      // Update breakTime and teaBreaks if provided or if timings changed
      if (
        breakTime !== undefined ||
        lunchBreak !== undefined ||
        breakStartTime !== undefined ||
        breakEndTime !== undefined ||
        breakDuration !== undefined ||
        teaBreakCount !== undefined ||
        shortBreakCount !== undefined ||
        beforeBreakCount !== undefined ||
        afterBreakCount !== undefined ||
        teaBreakDuration !== undefined ||
        teaBreaks !== undefined ||
        teaBreak1StartTime !== undefined ||
        teaBreak2StartTime !== undefined ||
        startTime !== undefined ||
        endTime !== undefined
      ) {
        const {
          breakTime: resolvedBreakTime,
          teaBreakCount: resolvedTeaBreakCount,
          teaBreakDuration: resolvedTeaBreakDuration,
          teaBreaks: resolvedTeaBreaks,
        } = resolveShiftBreaks({
          shiftStartTime: shift.startTime,
          shiftEndTime: shift.endTime,
          breakTimeInput:
            breakTime !== undefined
              ? breakTime
              : lunchBreak !== undefined
                ? lunchBreak
                : shift.breakTime,
          breakStartTimeInput: breakStartTime,
          breakEndTimeInput: breakEndTime,
          breakDurationInput: breakDuration,
          teaBreakCountInput:
            teaBreakCount !== undefined
              ? teaBreakCount
              : shortBreakCount !== undefined
                ? shortBreakCount
                : shift.teaBreakCount,
          teaBreakDurationInput:
            teaBreakDuration !== undefined ? teaBreakDuration : shift.teaBreakDuration,
          beforeBreakCountInput: beforeBreakCount,
          afterBreakCountInput: afterBreakCount,
          teaBreaksInput: teaBreaks !== undefined ? teaBreaks : shift.teaBreaks,
          teaBreak1StartTimeInput: teaBreak1StartTime,
          teaBreak1EndTimeInput: teaBreak1EndTime,
          teaBreak2StartTimeInput: teaBreak2StartTime,
          teaBreak2EndTimeInput: teaBreak2EndTime,
        });

        shift.breakTime = resolvedBreakTime;
        shift.teaBreakCount = resolvedTeaBreakCount;
        shift.teaBreakDuration = resolvedTeaBreakDuration;
        shift.teaBreaks = resolvedTeaBreaks;
      }

      if (color !== undefined) shift.color = color.trim();
      if (description !== undefined) shift.description = description.trim();
      if (status !== undefined && ["Active", "Inactive"].includes(status)) shift.status = status;

      if (isDefault !== undefined) {
        if (Boolean(isDefault)) {
          await ShiftModel.updateMany({ _id: { $ne: id }, isDeleted: false }, { isDefault: false });
        }
        shift.isDefault = Boolean(isDefault);
      }

      await shift.save();

      // If shift name was updated, synchronize employee records that have matching shiftTiming string
      if (oldName !== shift.shiftName) {
        await UserModel.updateMany(
          {
            $or: [{ shift: shift._id }, { "shiftAndSchedule.shift": shift._id }],
          },
          {
            $set: {
              "shiftAndSchedule.shiftTiming": shift.shiftName,
            },
          }
        );
      }

      await recordAuditLog(req, {
        action: "Updated Shift",
        category: "Attendance & Shifts",
        description: `Updated shift details for ${shift.shiftName}`,
        targetResource: shift.shiftName,
        diff: {
          before: `Old Shift Name: ${oldName}`,
          after: `Shift: ${shift.shiftName} (${shift.startTime} - ${shift.endTime})`,
        },
      });

      return sendSuccessResponse(res, "Shift updated successfully!", shift);
    } catch (error) {
      console.error("Update Shift Error:", error);
      return sendErrorResponse(res, 500, "Failed to update shift", error);
    }
  }

  /**
   * Delete Shift (Permanently removes record from database)
   * DELETE /deleteShift/:id
   */
  static async deleteShift(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid shift ID");
      }

      const shift = await ShiftModel.findById(id);
      if (!shift) {
        return sendNotFoundResponse(res, "Shift not found");
      }

      // Check how many employees are currently assigned
      const assignedCount = await UserModel.countDocuments({
        role: "employee",
        isUserDeleted: { $ne: true },
        $or: [
          { shift: shift._id },
          { "shiftAndSchedule.shift": shift._id },
          { "shiftAndSchedule.shiftTiming": shift.shiftName },
        ],
      });

      // Find an alternative default shift or general shift if employees need fallback
      const fallbackShift = await ShiftModel.findOne({
        _id: { $ne: id },
        status: "Active",
      }).sort({ isDefault: -1, createdAt: 1 });

      if (assignedCount > 0) {
        if (fallbackShift) {
          // Reassign to fallback shift
          await UserModel.updateMany(
            {
              role: "employee",
              $or: [
                { shift: shift._id },
                { "shiftAndSchedule.shift": shift._id },
                { "shiftAndSchedule.shiftTiming": shift.shiftName },
              ],
            },
            {
              $set: {
                shift: fallbackShift._id,
                "shiftAndSchedule.shift": fallbackShift._id,
                "shiftAndSchedule.shiftTiming": fallbackShift.shiftName,
              },
            }
          );
        } else {
          // Unassign if no other shift exists
          await UserModel.updateMany(
            {
              role: "employee",
              $or: [
                { shift: shift._id },
                { "shiftAndSchedule.shift": shift._id },
                { "shiftAndSchedule.shiftTiming": shift.shiftName },
              ],
            },
            {
              $set: {
                shift: null,
                "shiftAndSchedule.shift": null,
              },
            }
          );
        }
      }

      // Clean up weekly rosters referencing this deleted shift
      const dayKeys = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
      for (const day of dayKeys) {
        await ShiftRosterModel.updateMany(
          { [`schedule.${day}.shift`]: shift._id },
          { $set: { [`schedule.${day}.shift`]: fallbackShift ? fallbackShift._id : null } }
        );
      }

      // Hard delete: Permanently remove the shift record from database
      await ShiftModel.findByIdAndDelete(id);

      await recordAuditLog(req, {
        action: "Permanently Deleted Shift",
        category: "Attendance & Shifts",
        description: `Permanently deleted shift '${shift.shiftName}' from database. Reassigned ${assignedCount} employee(s) to ${fallbackShift ? fallbackShift.shiftName : "None"
          }`,
        targetResource: shift.shiftName,
      });

      return sendSuccessResponse(res, `Shift '${shift.shiftName}' permanently deleted from database successfully`, {
        deletedShiftId: id,
        shiftName: shift.shiftName,
        reassignedEmployeesCount: assignedCount,
        fallbackShiftName: fallbackShift ? fallbackShift.shiftName : null,
      });
    } catch (error) {
      console.error("Delete Shift Error:", error);
      return sendErrorResponse(res, 500, "Failed to delete shift", error);
    }
  }

  /**
   * Lightweight dropdown list for Employee Add/Edit modal
   * GET /getShiftDropdown
   */
  static async getShiftDropdown(req, res) {
    try {
      const shifts = await ShiftModel.find({
        status: "Active",
      })
        .select(
          "_id shiftName shiftCode startTime endTime durationHours workHoursDisplay color isDefault breakTime teaBreakCount teaBreakDuration teaBreaks"
        )
        .sort({ isDefault: -1, createdAt: 1 });

      return sendSuccessResponse(res, "Shift dropdown options retrieved successfully", shifts);
    } catch (error) {
      console.error("Get Shift Dropdown Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch shift options", error);
    }
  }

  /**
   * Weekly Shift Roster API
   * GET /getWeeklyRoster
   * Query params:
   *   - startDate: YYYY-MM-DD (e.g. 2026-10-05)
   *   - shift: Shift ID or Shift Name filter (e.g. "Morning", "General", "Evening", "Night")
   *   - department: Department ID filter
   *   - search: Search text for employee name, email, employeeId
   *   - page, limit
   */
  static async getWeeklyRoster(req, res) {
    try {
      const {
        startDate,
        shift: shiftFilter,
        department: deptFilter,
        search,
        page = 1,
        limit = 10,
      } = req.query;

      const weekBounds = getWeekBounds(startDate);
      const { weekStartDate, weekEndDate, formattedRange, days } = weekBounds;

      // 1. Fetch all active shifts to create filter badge counters
      const activeShifts = await ShiftModel.find({ status: "Active" }).sort({
        isDefault: -1,
        createdAt: 1,
      });

      // 2. Build employee search & department filter
      const empFilter = {
        role: "employee",
        isUserDeleted: { $ne: true },
        employeeStatus: { $ne: "Terminated" },
      };

      if (deptFilter && mongoose.Types.ObjectId.isValid(deptFilter.trim())) {
        empFilter.department = deptFilter.trim();
      }

      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        empFilter.$or = [
          { name: regex },
          { firstName: regex },
          { lastName: regex },
          { email: regex },
          { employeeId: regex },
        ];
      }

      // Fetch employees matching base filter
      const allActiveEmployees = await UserModel.find(empFilter)
        .select("_id name firstName lastName employeeId avatarUrl email employeeStatus department designation shift shiftAndSchedule")
        .populate("department", "departmentName icon color")
        .populate("designation", "designationName level")
        .populate("shift", "shiftName startTime endTime workHoursDisplay color")
        .populate("shiftAndSchedule.shift", "shiftName startTime endTime workHoursDisplay color")
        .sort({ employeeId: 1, createdAt: 1 });

      // Fetch existing roster assignments for this week
      const rosterEntries = await ShiftRosterModel.find({
        weekStartDate,
        employee: { $in: allActiveEmployees.map((e) => e._id) },
      })
        .populate("schedule.monday.shift", "shiftName startTime endTime color")
        .populate("schedule.tuesday.shift", "shiftName startTime endTime color")
        .populate("schedule.wednesday.shift", "shiftName startTime endTime color")
        .populate("schedule.thursday.shift", "shiftName startTime endTime color")
        .populate("schedule.friday.shift", "shiftName startTime endTime color")
        .populate("schedule.saturday.shift", "shiftName startTime endTime color")
        .populate("schedule.sunday.shift", "shiftName startTime endTime color");

      const rosterByEmpId = new Map();
      rosterEntries.forEach((r) => {
        rosterByEmpId.set(String(r.employee), r);
      });

      // Default shift fallback if employee has no custom roster
      const defaultGeneralShift =
        activeShifts.find((s) => s.isDefault) || activeShifts[0] || null;

      // Build roster row for every employee
      const employeeRosterRows = allActiveEmployees.map((emp) => {
        const primaryShift =
          emp.shift ||
          emp.shiftAndSchedule?.shift ||
          activeShifts.find((s) => s.shiftName === emp.shiftAndSchedule?.shiftTiming) ||
          defaultGeneralShift;

        const savedRoster = rosterByEmpId.get(String(emp._id));

        const weeklyOffStr = emp.shiftAndSchedule?.weeklyOff || "Sat - Sun";
        const isDefaultSatOff = weeklyOffStr.includes("Sat");
        const isDefaultSunOff = weeklyOffStr.includes("Sun");

        const getDaySchedule = (dayKey, isDefaultOff) => {
          if (savedRoster && savedRoster.schedule && savedRoster.schedule[dayKey]) {
            const dayEntry = savedRoster.schedule[dayKey];
            if (dayEntry.isOff) {
              return { isOff: true, shift: null, label: "OFF" };
            }
            if (dayEntry.shift) {
              return {
                isOff: false,
                shift: dayEntry.shift,
                label: dayEntry.shift.shiftName ? dayEntry.shift.shiftName.replace(" Shift", "") : "General",
                color: dayEntry.shift.color || "#10B981",
              };
            }
          }

          if (isDefaultOff) {
            return { isOff: true, shift: null, label: "OFF" };
          }

          return {
            isOff: false,
            shift: primaryShift
              ? {
                _id: primaryShift._id,
                shiftName: primaryShift.shiftName,
                startTime: primaryShift.startTime,
                endTime: primaryShift.endTime,
                color: primaryShift.color,
              }
              : null,
            label: primaryShift?.shiftName ? primaryShift.shiftName.replace(" Shift", "") : "General",
            color: primaryShift?.color || "#10B981",
          };
        };

        const schedule = {
          monday: getDaySchedule("monday", false),
          tuesday: getDaySchedule("tuesday", false),
          wednesday: getDaySchedule("wednesday", false),
          thursday: getDaySchedule("thursday", false),
          friday: getDaySchedule("friday", false),
          saturday: getDaySchedule("saturday", isDefaultSatOff),
          sunday: getDaySchedule("sunday", isDefaultSunOff),
        };

        return {
          employee: {
            _id: emp._id,
            name: emp.name || `${emp.firstName || ""} ${emp.lastName || ""}`.trim(),
            employeeId: emp.employeeId || "—",
            avatarUrl: emp.avatarUrl || null,
            email: emp.email,
            department: emp.department
              ? {
                _id: emp.department._id,
                name: emp.department.departmentName,
                color: emp.department.color,
              }
              : null,
            designation: emp.designation
              ? {
                _id: emp.designation._id,
                name: emp.designation.designationName,
              }
              : null,
          },
          primaryShift: primaryShift
            ? {
              _id: primaryShift._id,
              shiftName: primaryShift.shiftName,
              startTime: primaryShift.startTime,
              endTime: primaryShift.endTime,
              color: primaryShift.color,
            }
            : null,
          schedule,
        };
      });

      // 3. Compute Shift Filter Pill counts (as shown in screenshot: All Shifts: 6, Morning: 1, General: 2, etc.)
      const shiftFilterCounters = [
        {
          key: "all",
          label: "All Shifts",
          count: employeeRosterRows.length,
        },
      ];

      activeShifts.forEach((s) => {
        const cleanName = s.shiftName.replace(" Shift", "").trim();
        const count = employeeRosterRows.filter((r) => {
          const shiftId = r.primaryShift?._id ? String(r.primaryShift._id) : null;
          const shiftName = r.primaryShift?.shiftName || "";
          return (
            shiftId === String(s._id) ||
            shiftName.toLowerCase() === s.shiftName.toLowerCase() ||
            shiftName.toLowerCase().includes(cleanName.toLowerCase())
          );
        }).length;

        shiftFilterCounters.push({
          key: s._id,
          label: cleanName,
          fullName: s.shiftName,
          count,
          color: s.color,
        });
      });

      // 4. Apply shift filter to table rows if provided
      let filteredRows = employeeRosterRows;
      if (shiftFilter && shiftFilter !== "all") {
        filteredRows = employeeRosterRows.filter((r) => {
          if (!r.primaryShift) return false;
          const target = shiftFilter.trim().toLowerCase();
          return (
            String(r.primaryShift._id) === target ||
            r.primaryShift.shiftName.toLowerCase() === target ||
            r.primaryShift.shiftName.toLowerCase().includes(target)
          );
        });
      }

      // Pagination
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 10;
      const totalFiltered = filteredRows.length;
      const paginatedRows = filteredRows.slice((pageNum - 1) * limitNum, pageNum * limitNum);

      return sendSuccessResponse(res, "Weekly shift roster fetched successfully", {
        weekMetadata: {
          weekStartDate,
          weekEndDate,
          formattedRange,
          days,
        },
        shiftFilters: shiftFilterCounters,
        pagination: {
          total: totalFiltered,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(totalFiltered / limitNum),
        },
        roster: paginatedRows,
      });
    } catch (error) {
      console.error("Get Weekly Roster Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch weekly roster", error);
    }
  }

  /**
   * Assign or update weekly roster for an employee or bulk employees
   * POST /assignWeeklyRoster
   */
  static async assignWeeklyRoster(req, res) {
    try {
      const {
        employeeId,
        weekStartDate,
        weekEndDate: customWeekEndDate,
        schedule,
        bulkRoster, // Optional array of { employeeId, schedule }
      } = req.body;

      if (bulkRoster && Array.isArray(bulkRoster) && bulkRoster.length > 0) {
        const savedResults = [];

        for (const item of bulkRoster) {
          if (!item.employeeId || !mongoose.Types.ObjectId.isValid(item.employeeId)) continue;
          const bounds = getWeekBounds(item.weekStartDate || weekStartDate);

          const updated = await ShiftRosterModel.findOneAndUpdate(
            { employee: item.employeeId, weekStartDate: bounds.weekStartDate },
            {
              $set: {
                weekEndDate: bounds.weekEndDate,
                schedule: item.schedule,
                assignedBy: req.user?._id || null,
              },
            },
            { new: true, upsert: true }
          );
          savedResults.push(updated);
        }

        await recordAuditLog(req, {
          action: "Bulk Updated Weekly Shift Roster",
          category: "Attendance & Shifts",
          description: `Updated weekly shift roster for ${savedResults.length} employees`,
        });

        return sendSuccessResponse(res, "Bulk roster updated successfully!", savedResults);
      }

      // Single employee assignment
      if (!employeeId || !mongoose.Types.ObjectId.isValid(employeeId)) {
        return sendBadRequestResponse(res, "Valid employee ID is required");
      }

      const bounds = getWeekBounds(weekStartDate);
      const finalWeekStartDate = bounds.weekStartDate;
      const finalWeekEndDate = customWeekEndDate || bounds.weekEndDate;

      const employee = await UserModel.findOne({
        _id: employeeId,
        isUserDeleted: { $ne: true },
      });

      if (!employee) {
        return sendNotFoundResponse(res, "Employee not found");
      }

      const updatedRoster = await ShiftRosterModel.findOneAndUpdate(
        { employee: employeeId, weekStartDate: finalWeekStartDate },
        {
          $set: {
            weekEndDate: finalWeekEndDate,
            schedule: schedule || {},
            assignedBy: req.user?._id || null,
          },
        },
        { new: true, upsert: true }
      );

      await recordAuditLog(req, {
        action: "Updated Employee Weekly Roster",
        category: "Attendance & Shifts",
        description: `Updated roster for ${employee.name || employee.employeeId} (${finalWeekStartDate} - ${finalWeekEndDate})`,
        targetResource: employee.name || employee.employeeId,
      });

      return sendSuccessResponse(res, "Employee weekly roster assigned successfully!", updatedRoster);
    } catch (error) {
      console.error("Assign Weekly Roster Error:", error);
      return sendErrorResponse(res, 500, "Failed to assign weekly roster", error);
    }
  }

  /**
   * Fast assign employee(s) to a Shift
   * POST /assignEmployeeShift
   */
  static async assignEmployeeShift(req, res) {
    try {
      const { employeeId, employeeIds, shiftId } = req.body;

      if (!shiftId || !mongoose.Types.ObjectId.isValid(shiftId)) {
        return sendBadRequestResponse(res, "Valid Shift ID is required");
      }

      const shift = await ShiftModel.findOne({ _id: shiftId, isDeleted: false });
      if (!shift) {
        return sendNotFoundResponse(res, "Selected shift was not found");
      }

      const targetIds = [];
      if (employeeId && mongoose.Types.ObjectId.isValid(employeeId)) {
        targetIds.push(employeeId);
      }
      if (Array.isArray(employeeIds)) {
        employeeIds.forEach((id) => {
          if (mongoose.Types.ObjectId.isValid(id) && !targetIds.includes(id)) {
            targetIds.push(id);
          }
        });
      }

      if (targetIds.length === 0) {
        return sendBadRequestResponse(res, "Please provide at least one valid employee ID");
      }

      await UserModel.updateMany(
        { _id: { $in: targetIds }, isUserDeleted: { $ne: true } },
        {
          $set: {
            shift: shift._id,
            "shiftAndSchedule.shift": shift._id,
            "shiftAndSchedule.shiftTiming": shift.shiftName,
          },
        }
      );

      await recordAuditLog(req, {
        action: "Assigned Shift To Employees",
        category: "Attendance & Shifts",
        description: `Assigned shift ${shift.shiftName} to ${targetIds.length} employee(s)`,
        targetResource: shift.shiftName,
      });

      return sendSuccessResponse(res, `Successfully assigned ${targetIds.length} employee(s) to '${shift.shiftName}'`, {
        shiftId: shift._id,
        shiftName: shift.shiftName,
        assignedCount: targetIds.length,
      });
    } catch (error) {
      console.error("Assign Employee Shift Error:", error);
      return sendErrorResponse(res, 500, "Failed to assign shift to employees", error);
    }
  }
}
