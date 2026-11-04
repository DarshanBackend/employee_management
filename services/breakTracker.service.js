import cron from "node-cron";
import AttendanceModel from "../model/attendance.model.js";
import ShiftModel from "../model/shift.model.js";
import UserModel from "../model/user.model.js";
import {
  getNormalizedDateString,
  formatDisplayDate,
  formatTimeDisplay,
  combineDateAndTime,
  parseTimeToMinutes,
} from "../controller/attendance.controller.js";

// Helper: Combine Date string and Time string, accounting for overnight shift wrap past midnight
export const combineDateAndTimeWithShift = (dateStr, timeStr, shiftStartTime = null) => {
  try {
    const [year, month, day] = dateStr.split("-").map(Number);
    const mins = parseTimeToMinutes(timeStr);
    const hours = Math.floor(mins / 60);
    const minutes = mins % 60;
    const d = new Date(year, month - 1, day, hours, minutes, 0, 0);

    if (shiftStartTime) {
      const shiftStartMins = parseTimeToMinutes(shiftStartTime);
      // If shift starts in evening/night (> 12:00 PM) and this break time is in early morning (< 12:00 PM)
      if (shiftStartMins > 720 && mins < shiftStartMins && mins < 720) {
        d.setDate(d.getDate() + 1);
      }
    }
    return d;
  } catch (e) {
    return new Date();
  }
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

/**
 * Standardize and extract today's breaks from an employee's assigned shift
 * or fall back to default shift / attendance rules.
 * 
 * DYNAMIC NAMING RULES:
 * 1. Big / Main Break:
 *    - 11:00 AM to 03:30 PM: "Lunch Break" (breakType: "Lunch Break")
 *    - 06:00 PM to 10:30 PM: "Dinner Break" (breakType: "Dinner Break")
 *    - 10:30 PM to 06:00 AM: "Night Meal Break" (breakType: "Meal Break")
 *    - Other: "Meal Break" (breakType: "Meal Break")
 *    - Or if customized by admin: shift.breakTime.name
 * 2. Tea Breaks:
 *    - Breaks occurring BEFORE the main break:
 *      "Before Break 1", "Before Break 2", etc.
 *    - Breaks occurring AFTER the main break:
 *      "After Break 1", "After Break 2", etc.
 *    - NEVER generic "Morning Tea Break" / "Evening Tea Break" on night or afternoon shifts!
 */
export const extractBreaksFromShift = (shift = null) => {
  const breaksList = [];

  const shiftStartTime = shift?.startTime || "09:00 AM";
  const shiftEndTime = shift?.endTime || "06:00 PM";
  const shiftStartMins = parseTimeToMinutes(shiftStartTime);

  // 1. Resolve Main Meal Break (Big Break)
  const breakTime = shift?.breakTime || {};
  const mainBreakStartTime = breakTime.startTime || "01:00 PM";
  const mainBreakEndTime = breakTime.endTime || "02:00 PM";
  const mainBreakDur = Number(breakTime.durationMinutes) || 60;
  const mainStartMins = parseTimeToMinutes(mainBreakStartTime);

  let mainBreakName = breakTime.name;
  let mainBreakType = "Meal Break";

  if (
    !mainBreakName ||
    mainBreakName === "Lunch Break" ||
    mainBreakName === "Main Break" ||
    mainBreakName === "Break" ||
    mainBreakName === "Meal Break"
  ) {
    if (mainStartMins >= 660 && mainStartMins < 930) {
      // 11:00 AM to 03:30 PM
      mainBreakName = "Lunch Break";
      mainBreakType = "Lunch Break";
    } else if (mainStartMins >= 1080 && mainStartMins < 1350) {
      // 06:00 PM to 10:30 PM
      mainBreakName = "Dinner Break";
      mainBreakType = "Dinner Break";
    } else if (mainStartMins >= 1350 || mainStartMins < 360) {
      // 10:30 PM to 06:00 AM (Night Shift)
      mainBreakName = "Night Meal Break";
      mainBreakType = "Meal Break";
    } else {
      mainBreakName = "Meal Break";
      mainBreakType = "Meal Break";
    }
  } else {
    mainBreakType = mainBreakName.toLowerCase().includes("lunch")
      ? "Lunch Break"
      : mainBreakName.toLowerCase().includes("dinner")
        ? "Dinner Break"
        : "Meal Break";
  }

  const mainBreakObj = {
    breakType: mainBreakType,
    name: mainBreakName,
    scheduledStartTime: mainBreakStartTime,
    scheduledEndTime: mainBreakEndTime,
    scheduledDurationMinutes: mainBreakDur,
    status: "Scheduled",
    autoStopped: false,
    stoppedAt: null,
    stoppedAtDisplay: null,
    resumedAt: null,
    resumedAtDisplay: null,
    lateResumeMinutes: 0,
  };

  // Calculate main break offset from shift start
  let mainBreakOffset = mainStartMins - shiftStartMins;
  if (mainBreakOffset < 0) mainBreakOffset += 24 * 60;

  // 2. Resolve Tea Breaks
  const beforeBreaks = [];
  const afterBreaks = [];

  if (Array.isArray(shift?.teaBreaks) && shift.teaBreaks.length > 0) {
    for (const tb of shift.teaBreaks) {
      const tbStart = tb.startTime || "11:00 AM";
      const tbDur = Number(tb.durationMinutes) || Number(shift?.teaBreakDuration) || 15;
      const tbEnd = tb.endTime || formatMinutesToTime(parseTimeToMinutes(tbStart) + tbDur);

      const tbStartMins = parseTimeToMinutes(tbStart);
      let tbOffset = tbStartMins - shiftStartMins;
      if (tbOffset < 0) tbOffset += 24 * 60;

      let isBefore = false;
      if (tb.position === "before_break") {
        isBefore = true;
      } else if (tb.position === "after_break") {
        isBefore = false;
      } else {
        isBefore = tbOffset < mainBreakOffset;
      }

      const item = {
        startTime: tbStart,
        endTime: tbEnd,
        durationMinutes: tbDur,
        offset: tbOffset,
      };

      if (isBefore) {
        beforeBreaks.push(item);
      } else {
        afterBreaks.push(item);
      }
    }
  } else if (shift?.teaBreakCount !== undefined && Number(shift?.teaBreakCount) > 0) {
    // Only generate tea breaks if explicitly configured with teaBreakCount > 0
    const defaultTeaDuration = Number(shift?.teaBreakDuration) || 15;
    const count = Number(shift.teaBreakCount);

    let shiftEndMins = parseTimeToMinutes(shiftEndTime);
    let shiftDurationMins = shiftEndMins - shiftStartMins;
    if (shiftDurationMins <= 0) shiftDurationMins += 24 * 60;

    let mainEndMins = parseTimeToMinutes(mainBreakEndTime);
    let mainEndOffset = mainEndMins - shiftStartMins;
    if (mainEndOffset < 0) mainEndOffset += 24 * 60;

    if (count === 1) {
      const midOffset = Math.floor(mainBreakOffset / 2);
      beforeBreaks.push({
        startTime: formatMinutesToTime(shiftStartMins + midOffset),
        endTime: formatMinutesToTime(shiftStartMins + midOffset + defaultTeaDuration),
        durationMinutes: defaultTeaDuration,
        offset: midOffset,
      });
    } else {
      const mid1Offset = Math.floor(mainBreakOffset / 2);
      beforeBreaks.push({
        startTime: formatMinutesToTime(shiftStartMins + mid1Offset),
        endTime: formatMinutesToTime(shiftStartMins + mid1Offset + defaultTeaDuration),
        durationMinutes: defaultTeaDuration,
        offset: mid1Offset,
      });

      const remainingDuration = shiftDurationMins - mainEndOffset;
      const mid2Offset = mainEndOffset + Math.floor(remainingDuration / 2);
      afterBreaks.push({
        startTime: formatMinutesToTime(shiftStartMins + mid2Offset),
        endTime: formatMinutesToTime(shiftStartMins + mid2Offset + defaultTeaDuration),
        durationMinutes: defaultTeaDuration,
        offset: mid2Offset,
      });
    }
  } else {
    // Tea break is NOT compulsory! If a shift has 0 tea breaks or no tea breaks configured,
    // do NOT add any tea breaks. Only the main meal break will exist.
  }

  // Sort beforeBreaks chronologically by offset
  beforeBreaks.sort((a, b) => a.offset - b.offset);
  // Sort afterBreaks chronologically by offset
  afterBreaks.sort((a, b) => a.offset - b.offset);

  // Assign clean dynamic names: "Before Break 1", "Before Break 2", etc.
  beforeBreaks.forEach((b, idx) => {
    breaksList.push({
      breakType: "Tea Break",
      name: `Before Break ${idx + 1}`,
      scheduledStartTime: b.startTime,
      scheduledEndTime: b.endTime,
      scheduledDurationMinutes: b.durationMinutes,
      status: "Scheduled",
      autoStopped: false,
      stoppedAt: null,
      stoppedAtDisplay: null,
      resumedAt: null,
      resumedAtDisplay: null,
      lateResumeMinutes: 0,
      offset: b.offset,
    });
  });

  // Push the main meal break
  breaksList.push({
    ...mainBreakObj,
    offset: mainBreakOffset,
  });

  // Assign clean dynamic names: "After Break 1", "After Break 2", etc.
  afterBreaks.forEach((b, idx) => {
    breaksList.push({
      breakType: "Tea Break",
      name: `After Break ${idx + 1}`,
      scheduledStartTime: b.startTime,
      scheduledEndTime: b.endTime,
      scheduledDurationMinutes: b.durationMinutes,
      status: "Scheduled",
      autoStopped: false,
      stoppedAt: null,
      stoppedAtDisplay: null,
      resumedAt: null,
      resumedAtDisplay: null,
      lateResumeMinutes: 0,
      offset: b.offset,
    });
  });

  // Sort all breaks chronologically by offset from shift start
  breaksList.sort((a, b) => a.offset - b.offset);

  // Clean up temporary offset property
  breaksList.forEach((b) => {
    delete b.offset;
  });

  return breaksList;
};

/**
 * Synchronize and evaluate break auto-stop and late restart penalties for an attendance record.
 * 
 * CORE RULES:
 * 1. When break or tea break start time arrives, tracker AUTO STOPS at that scheduled time.
 * 2. When break finishes, tracker DOES NOT AUTO START ("auto start no thavu joy").
 * 3. Tracker stays stopped until the employee manually starts it.
 * 4. If employee starts tracker late after break finish time, the late time is added at the end
 *    ("last ma add thy jase") -> earliestAllowedCheckOut is extended by that late duration!
 */
export const syncAttendanceBreakStatus = (attendance, shift = null, now = new Date()) => {
  if (!attendance) return { modified: false };

  // If already checked out, tracker is completed
  if (attendance.checkOutTime) {
    if (attendance.trackerStatus !== "COMPLETED") {
      attendance.trackerStatus = "COMPLETED";
      return { modified: true };
    }
    return { modified: false };
  }

  // If checkIn not yet recorded, tracker not started
  if (!attendance.checkInTime) {
    if (attendance.trackerStatus !== "NOT_STARTED") {
      attendance.trackerStatus = "NOT_STARTED";
      return { modified: true };
    }
    return { modified: false };
  }

  let modified = false;

  // Ensure breaks array is populated
  if (!attendance.breaks || attendance.breaks.length === 0) {
    attendance.breaks = extractBreaksFromShift(shift);
    modified = true;
  }

  // Standardize existing legacy names if present ("Morning Tea Break" -> "Before Break 1", "Evening Tea Break" -> "After Break 1")
  if (Array.isArray(attendance.breaks)) {
    for (const brk of attendance.breaks) {
      if (brk.name === "Morning Tea Break") {
        brk.name = "Before Break 1";
        modified = true;
      } else if (brk.name === "Evening Tea Break") {
        brk.name = "After Break 1";
        modified = true;
      }
    }
  }

  // Initialize original checkout time if not already set
  if (!attendance.originalEarliestAllowedCheckOut) {
    const checkInDate = new Date(attendance.checkInTime);
    const reqMinutes = attendance.requiredWorkMinutes || 540;
    const baseCheckout = attendance.earliestAllowedCheckOut || new Date(checkInDate.getTime() + reqMinutes * 60000);
    attendance.originalEarliestAllowedCheckOut = baseCheckout;
    attendance.originalEarliestAllowedCheckOutDisplay = formatTimeDisplay(baseCheckout);
    modified = true;
  }

  const attendanceDateStr = attendance.date;
  const shiftStartTime = shift?.startTime || "09:00 AM";
  let activeBreakFound = null;
  let pendingResumeBreakFound = null;

  for (const brk of attendance.breaks) {
    const startDt = combineDateAndTimeWithShift(attendanceDateStr, brk.scheduledStartTime, shiftStartTime);
    const endDt = combineDateAndTimeWithShift(attendanceDateStr, brk.scheduledEndTime, shiftStartTime);

    // Auto-repair mistakenly modified future scheduled breaks
    // (e.g. if a manual pause mistakenly marked Lunch Break or Evening Tea Break as Completed or Active before its time)
    if (now < startDt && (brk.autoStopped === false || brk.status !== "Scheduled")) {
      brk.status = "Scheduled";
      brk.autoStopped = false;
      brk.stoppedAt = null;
      brk.stoppedAtDisplay = null;
      brk.resumedAt = null;
      brk.resumedAtDisplay = null;
      brk.lateResumeMinutes = 0;
      modified = true;
    }

    // Case 1: Break has already been manually completed by employee
    if (brk.status === "Completed" || brk.resumedAt) {
      continue;
    }

    // Case 2: Currently DURING this scheduled break time
    if (now >= startDt && now < endDt) {
      if (brk.status !== "Active") {
        brk.status = "Active";
        brk.autoStopped = true;
        brk.stoppedAt = brk.stoppedAt || startDt;
        brk.stoppedAtDisplay = brk.stoppedAtDisplay || brk.scheduledStartTime;
        modified = true;
      }

      if (attendance.trackerStatus !== "ON_BREAK") {
        attendance.trackerStatus = "ON_BREAK";
        modified = true;
      }

      activeBreakFound = {
        breakType: brk.breakType,
        name: brk.name,
        scheduledStartTime: brk.scheduledStartTime,
        scheduledEndTime: brk.scheduledEndTime,
        scheduledDurationMinutes: brk.scheduledDurationMinutes,
        autoStopped: true,
        stoppedAt: brk.stoppedAt || startDt,
        stoppedAtDisplay: brk.stoppedAtDisplay || brk.scheduledStartTime,
        isOverdue: false,
        currentLateMinutes: 0,
      };
      break;
    }

    // Case 3: Scheduled break has FINISHED, but employee has NOT yet started/resumed tracker!
    if (now >= endDt) {
      // Auto-stop at break start time if not previously marked
      if (!brk.stoppedAt) {
        brk.autoStopped = true;
        brk.stoppedAt = startDt;
        brk.stoppedAtDisplay = brk.scheduledStartTime;
        modified = true;
      }

      if (brk.status !== "Pending Resume") {
        brk.status = "Pending Resume";
        modified = true;
      }

      // DO NOT AUTO-START! Tracker must remain stopped until employee manually starts it.
      if (attendance.trackerStatus !== "BREAK_ENDED_PENDING_START") {
        attendance.trackerStatus = "BREAK_ENDED_PENDING_START";
        modified = true;
      }

      const overdueMins = Math.max(0, Math.floor((now.getTime() - endDt.getTime()) / 60000));

      pendingResumeBreakFound = {
        breakType: brk.breakType,
        name: brk.name,
        scheduledStartTime: brk.scheduledStartTime,
        scheduledEndTime: brk.scheduledEndTime,
        scheduledDurationMinutes: brk.scheduledDurationMinutes,
        autoStopped: true,
        stoppedAt: brk.stoppedAt || startDt,
        stoppedAtDisplay: brk.stoppedAtDisplay || brk.scheduledStartTime,
        isOverdue: overdueMins > 0,
        currentLateMinutes: overdueMins,
      };
      break;
    }
  }

  // Update activeBreak field
  const currentActiveBreak = activeBreakFound || pendingResumeBreakFound || null;
  attendance.activeBreak = currentActiveBreak;

  // If not currently on break and not pending resume after break
  if (!activeBreakFound && !pendingResumeBreakFound) {
    if (attendance.trackerStatus === "ON_BREAK" || attendance.trackerStatus === "BREAK_ENDED_PENDING_START") {
      attendance.trackerStatus = "RUNNING";
      modified = true;
    } else if (attendance.trackerStatus === "NOT_STARTED") {
      attendance.trackerStatus = "RUNNING";
      modified = true;
    }
    // If trackerStatus is "PAUSED", preserve it!
  }

  // Sum up all locked-in late minutes from completed breaks
  let sumCompletedLateMinutes = 0;
  for (const brk of attendance.breaks) {
    if (brk.status === "Completed" && brk.lateResumeMinutes > 0) {
      sumCompletedLateMinutes += brk.lateResumeMinutes;
    }
  }

  if (attendance.totalBreakLateMinutes !== sumCompletedLateMinutes) {
    attendance.totalBreakLateMinutes = sumCompletedLateMinutes;
    modified = true;
  }

  // Recalculate earliest allowed check-out time (including penalty delay + manual pauses)
  const baseCheckout = new Date(attendance.originalEarliestAllowedCheckOut || attendance.earliestAllowedCheckOut);
  const totalExtraMinutes = sumCompletedLateMinutes + (attendance.totalManualPauseMinutes || 0);
  const updatedEarliestCheckout = new Date(baseCheckout.getTime() + totalExtraMinutes * 60000);

  if (
    !attendance.earliestAllowedCheckOut ||
    attendance.earliestAllowedCheckOut.getTime() !== updatedEarliestCheckout.getTime()
  ) {
    attendance.earliestAllowedCheckOut = updatedEarliestCheckout;
    attendance.earliestAllowedCheckOutDisplay = formatTimeDisplay(updatedEarliestCheckout);
    modified = true;
  }

  // Calculate actual working minutes (excluding stopped break durations, late delay, and manual pauses)
  const checkInDt = new Date(attendance.checkInTime);
  const totalElapsed = Math.max(0, Math.floor((now.getTime() - checkInDt.getTime()) / 60000));

  let totalDeductedBreakTime = 0;
  for (const brk of attendance.breaks) {
    const sDt = combineDateAndTimeWithShift(attendanceDateStr, brk.scheduledStartTime, shiftStartTime);
    const eDt = combineDateAndTimeWithShift(attendanceDateStr, brk.scheduledEndTime, shiftStartTime);

    if (brk.status === "Completed") {
      // If actual stoppedAt and resumedAt are recorded, deduct actual duration
      if (brk.stoppedAt && brk.resumedAt) {
        const actualBreakMins = Math.max(
          0,
          Math.floor((new Date(brk.resumedAt).getTime() - new Date(brk.stoppedAt).getTime()) / 60000)
        );
        totalDeductedBreakTime += actualBreakMins;
      } else {
        totalDeductedBreakTime += (brk.scheduledDurationMinutes || 15) + (brk.lateResumeMinutes || 0);
      }
    } else if (brk.status === "Active" && now >= sDt) {
      // Currently on break: deduct elapsed time spent on this break so far
      const elapsedOnBreak = Math.max(0, Math.floor((now.getTime() - sDt.getTime()) / 60000));
      totalDeductedBreakTime += elapsedOnBreak;
    } else if (brk.status === "Pending Resume" && now >= eDt) {
      // Break finished, awaiting employee start: deduct full break duration + pending delay
      const overdueDelay = Math.max(0, Math.floor((now.getTime() - eDt.getTime()) / 60000));
      totalDeductedBreakTime += (brk.scheduledDurationMinutes || 15) + overdueDelay;
    }
  }

  // Deduct manual pause time (completed pauses + active pause if currently paused)
  let totalManualPauseTime = attendance.totalManualPauseMinutes || 0;
  if (attendance.trackerStatus === "PAUSED" && attendance.activePause?.pausedAt) {
    const activePauseElapsed = Math.max(
      0,
      Math.floor((now.getTime() - new Date(attendance.activePause.pausedAt).getTime()) / 60000)
    );
    totalManualPauseTime += activePauseElapsed;
  }

  const activeWorkMinutes = Math.max(0, totalElapsed - totalDeductedBreakTime - totalManualPauseTime);
  if (attendance.totalWorkMinutes !== activeWorkMinutes) {
    attendance.totalWorkMinutes = activeWorkMinutes;
    const h = Math.floor(activeWorkMinutes / 60);
    const m = activeWorkMinutes % 60;
    attendance.totalWorkHoursDisplay = `${h}h ${String(m).padStart(2, "0")}m`;
    modified = true;
  }

  return { modified, activeBreak: currentActiveBreak };
};

/**
 * Handle manual employee start / resume of tracker after scheduled break or manual pause.
 * 1. Resuming from a MANUAL PAUSE:
 *    - Closes activePause, calculates pause duration, adds to totalManualPauseMinutes.
 *    - Extends shift earliestAllowedCheckOut by manual pause duration.
 *    - Does NOT touch scheduled breaks!
 * 2. Resuming from a SCHEDULED BREAK:
 *    - Finds active/pending scheduled break, calculates late penalty if after scheduledEndTime.
 *    - Marks scheduled break Completed (autoStopped remains true).
 *    - Extends shift checkout time ("last ma add thy jase").
 */
export const resumeEmployeeTracker = async (attendance, now = new Date(), shiftStartTime = null) => {
  const attendanceDateStr = attendance.date;

  if (!Array.isArray(attendance.breaks)) {
    attendance.breaks = [];
  }
  if (!Array.isArray(attendance.manualPauses)) {
    attendance.manualPauses = [];
  }

  let resumedType = "NONE";
  let lateMinutes = 0;
  let pausedMinutes = 0;
  let penaltyMessage = "";
  let resumedBreak = null;

  // CASE A: Resuming from a MANUAL PAUSE
  if (attendance.trackerStatus === "PAUSED" || attendance.activePause?.pausedAt) {
    resumedType = "MANUAL_PAUSE";
    const pauseStart = attendance.activePause?.pausedAt
      ? new Date(attendance.activePause.pausedAt)
      : null;

    if (pauseStart) {
      pausedMinutes = Math.max(0, Math.floor((now.getTime() - pauseStart.getTime()) / 60000));
    }

    // Find and update the open manual pause entry
    const openPause = attendance.manualPauses
      .slice()
      .reverse()
      .find((p) => !p.resumedAt);

    if (openPause) {
      openPause.resumedAt = now;
      openPause.resumedAtDisplay = formatTimeDisplay(now);
      openPause.durationMinutes = pausedMinutes;
    }

    attendance.totalManualPauseMinutes = (attendance.totalManualPauseMinutes || 0) + pausedMinutes;
    const pauseReason = attendance.activePause?.reason || "Manual Pause";
    attendance.activePause = null;

    penaltyMessage =
      pausedMinutes > 0
        ? `Resumed tracker after ${pausedMinutes} min manual pause (${pauseReason}). ${pausedMinutes} min(s) added to shift checkout time.`
        : `Resumed tracker from manual pause (${pauseReason}).`;
  }
  // CASE B: Resuming from a SCHEDULED BREAK
  else {
    resumedType = "SCHEDULED_BREAK";

    // Find the break that was active or pending resume
    let targetBreak = attendance.breaks.find(
      (b) => b && (b.status === "Pending Resume" || b.status === "Active")
    );

    // If no break explicitly marked Active/Pending Resume, look for any break whose startTime has passed and hasn't resumed
    if (!targetBreak) {
      targetBreak = attendance.breaks.find((b) => {
        if (!b || b.status === "Completed" || b.resumedAt) return false;
        const sDt = combineDateAndTimeWithShift(attendanceDateStr, b.scheduledStartTime, shiftStartTime);
        return now >= sDt;
      });
    }

    if (targetBreak) {
      resumedBreak = targetBreak;
      if (targetBreak.scheduledEndTime) {
        const endDt = combineDateAndTimeWithShift(attendanceDateStr, targetBreak.scheduledEndTime, shiftStartTime);
        if (now > endDt) {
          // Employee started tracker late after the scheduled break finished!
          lateMinutes = Math.floor((now.getTime() - endDt.getTime()) / 60000);
        }
      }

      targetBreak.resumedAt = now;
      targetBreak.resumedAtDisplay = formatTimeDisplay(now);
      targetBreak.lateResumeMinutes = lateMinutes;
      targetBreak.status = "Completed";

      if (lateMinutes > 0) {
        penaltyMessage = `${lateMinutes} minute(s) late start after ${targetBreak.name} added to your shift checkout time.`;
      } else {
        penaltyMessage = `Resumed on time from ${targetBreak.name}.`;
      }
    }

    // Lock in new total late penalty from all completed scheduled breaks
    let totalLate = 0;
    for (const b of attendance.breaks) {
      if (b.status === "Completed" && b.lateResumeMinutes > 0) {
        totalLate += b.lateResumeMinutes;
      }
    }
    attendance.totalBreakLateMinutes = totalLate;
    attendance.activeBreak = null;
  }

  // Recalculate shift checkout time with all delays (break late penalty + manual pause minutes)
  const baseCheckout = new Date(
    attendance.originalEarliestAllowedCheckOut || attendance.earliestAllowedCheckOut
  );
  const totalExtraDelayMinutes =
    (attendance.totalBreakLateMinutes || 0) + (attendance.totalManualPauseMinutes || 0);

  const updatedEarliestCheckout = new Date(baseCheckout.getTime() + totalExtraDelayMinutes * 60000);
  attendance.earliestAllowedCheckOut = updatedEarliestCheckout;
  attendance.earliestAllowedCheckOutDisplay = formatTimeDisplay(updatedEarliestCheckout);

  // Resume tracker status
  attendance.trackerStatus = "RUNNING";
  attendance.trackerLastStartedAt = now;

  if (penaltyMessage) {
    attendance.notes = attendance.notes
      ? `${attendance.notes} | ${penaltyMessage}`
      : penaltyMessage;
  }

  await attendance.save();

  return {
    success: true,
    resumedType,
    lateMinutes,
    pausedMinutes,
    totalBreakLateMinutes: attendance.totalBreakLateMinutes || 0,
    totalManualPauseMinutes: attendance.totalManualPauseMinutes || 0,
    earliestAllowedCheckOut: attendance.earliestAllowedCheckOutDisplay,
    trackerStatus: attendance.trackerStatus,
    penaltyMessage,
    resumedBreak,
  };
};

/**
 * Handle manual employee pause of tracker (for personal / another reason)
 * IMPORTANT: DOES NOT TOUCH SCHEDULED BREAKS (Tea Break, Lunch Break)!
 * Scheduled breaks only trigger when auto-stopped at their scheduled time.
 */
export const pauseEmployeeTracker = async (attendance, reason = "Manual Pause", now = new Date()) => {
  attendance.trackerStatus = "PAUSED";

  const pauseRecord = {
    pausedAt: now,
    pausedAtDisplay: formatTimeDisplay(now),
    resumedAt: null,
    resumedAtDisplay: null,
    durationMinutes: 0,
    reason: reason || "Manual Pause",
  };

  attendance.activePause = {
    pausedAt: now,
    pausedAtDisplay: formatTimeDisplay(now),
    reason: reason || "Manual Pause",
  };

  if (!Array.isArray(attendance.manualPauses)) {
    attendance.manualPauses = [];
  }
  attendance.manualPauses.push(pauseRecord);

  // Scheduled breaks (attendance.breaks) remain completely untouched!
  // attendance.activeBreak remains null or untouched.

  await attendance.save();
  return {
    success: true,
    trackerStatus: attendance.trackerStatus,
    activePause: attendance.activePause,
    manualPauses: attendance.manualPauses,
  };
};

/**
 * Background Cron Job: Runs every minute to auto-stop tracker when break starts,
 * and ensure tracker stays stopped when break finishes without auto-starting.
 */
let cronTask = null;

export const initBreakTrackerCron = (io = null) => {
  if (cronTask) {
    cronTask.stop();
  }

  console.log("⏱️ Initializing Auto-Break & Late Penalty Tracker Cron Job (every minute)...");

  // Run every minute: "* * * * *"
  cronTask = cron.schedule("* * * * *", async () => {
    try {
      const todayDate = getNormalizedDateString();
      const now = new Date();

      // Find all active attendance records for today (checked in, not checked out)
      const openAttendances = await AttendanceModel.find({
        date: todayDate,
        checkInTime: { $ne: null },
        checkOutTime: null,
      }).populate("shift");

      for (const att of openAttendances) {
        try {
          const shift = att.shift || (await ShiftModel.findOne({ isDefault: true, status: "Active" }));
          const { modified } = syncAttendanceBreakStatus(att, shift, now);

          if (modified) {
            await att.save();

            if (io) {
              io.emit("attendance:breakStatusUpdate", {
                employeeId: att.employee,
                trackerStatus: att.trackerStatus,
                activeBreak: att.activeBreak,
                earliestAllowedCheckOut: att.earliestAllowedCheckOutDisplay,
                totalBreakLateMinutes: att.totalBreakLateMinutes,
              });
            }
          }
        } catch (innerErr) {
          console.error("Error processing attendance break sync for doc:", att._id, innerErr);
        }
      }
    } catch (err) {
      console.error("Break Tracker Cron Error:", err);
    }
  });

  return cronTask;
};
