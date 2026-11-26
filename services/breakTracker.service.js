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

export const combineDateAndTimeWithShift = (dateStr, timeStr, shiftStartTime = null) => {
  try {
    const [year, month, day] = dateStr.split("-").map(Number);
    const mins = parseTimeToMinutes(timeStr);
    const hours = Math.floor(mins / 60);
    const minutes = mins % 60;
    const d = new Date(year, month - 1, day, hours, minutes, 0, 0);

    if (shiftStartTime) {
      const shiftStartMins = parseTimeToMinutes(shiftStartTime);
      if (shiftStartMins > 720 && mins < shiftStartMins && mins < 720) {
        d.setDate(d.getDate() + 1);
      }
    }
    return d;
  } catch (e) {
    return new Date();
  }
};

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

export const extractBreaksFromShift = (shift = null) => {
  const breaksList = [];

  const shiftStartTime = shift?.startTime || "09:00 AM";
  const shiftEndTime = shift?.endTime || "06:00 PM";
  const shiftStartMins = parseTimeToMinutes(shiftStartTime);

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
      mainBreakName = "Lunch Break";
      mainBreakType = "Lunch Break";
    } else if (mainStartMins >= 1080 && mainStartMins < 1350) {
      mainBreakName = "Dinner Break";
      mainBreakType = "Dinner Break";
    } else if (mainStartMins >= 1350 || mainStartMins < 360) {
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

  let mainBreakOffset = mainStartMins - shiftStartMins;
  if (mainBreakOffset < 0) mainBreakOffset += 24 * 60;

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
  }

  beforeBreaks.sort((a, b) => a.offset - b.offset);
  afterBreaks.sort((a, b) => a.offset - b.offset);

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

  breaksList.push({
    ...mainBreakObj,
    offset: mainBreakOffset,
  });

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

  breaksList.sort((a, b) => a.offset - b.offset);

  breaksList.forEach((b) => {
    delete b.offset;
  });

  return breaksList;
};

export const syncAttendanceBreakStatus = (attendance, shift = null, now = new Date()) => {
  if (!attendance) return { modified: false };

  if (attendance.checkOutTime) {
    if (attendance.trackerStatus !== "COMPLETED") {
      attendance.trackerStatus = "COMPLETED";
      return { modified: true };
    }
    return { modified: false };
  }

  if (!attendance.checkInTime) {
    if (attendance.trackerStatus !== "NOT_STARTED") {
      attendance.trackerStatus = "NOT_STARTED";
      return { modified: true };
    }
    return { modified: false };
  }

  let modified = false;

  if (!attendance.breaks || attendance.breaks.length === 0) {
    attendance.breaks = extractBreaksFromShift(shift);
    modified = true;
  }

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

    if (brk.status === "Completed" || brk.resumedAt) {
      continue;
    }

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

    if (now >= endDt) {
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

  const currentActiveBreak = activeBreakFound || pendingResumeBreakFound || null;
  attendance.activeBreak = currentActiveBreak;

  if (!activeBreakFound && !pendingResumeBreakFound) {
    if (attendance.trackerStatus === "ON_BREAK" || attendance.trackerStatus === "BREAK_ENDED_PENDING_START") {
      attendance.trackerStatus = "RUNNING";
      modified = true;
    } else if (attendance.trackerStatus === "NOT_STARTED") {
      attendance.trackerStatus = "RUNNING";
      modified = true;
    }
  }

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

  const checkInDt = new Date(attendance.checkInTime);
  const totalElapsedMs = Math.max(0, now.getTime() - checkInDt.getTime());

  let totalDeductedBreakMs = 0;
  for (const brk of attendance.breaks) {
    const sDt = combineDateAndTimeWithShift(attendanceDateStr, brk.scheduledStartTime, shiftStartTime);
    const eDt = combineDateAndTimeWithShift(attendanceDateStr, brk.scheduledEndTime, shiftStartTime);

    if (brk.status === "Completed") {
      if (brk.stoppedAt && brk.resumedAt) {
        const actualBreakMs = Math.max(
          0,
          new Date(brk.resumedAt).getTime() - new Date(brk.stoppedAt).getTime()
        );
        totalDeductedBreakMs += actualBreakMs;
      } else {
        totalDeductedBreakMs += ((brk.scheduledDurationMinutes || 15) + (brk.lateResumeMinutes || 0)) * 60000;
      }
    } else if (brk.status === "Active" && now >= sDt) {
      const brkStart = brk.stoppedAt ? new Date(brk.stoppedAt) : sDt;
      const elapsedOnBreakMs = Math.max(0, now.getTime() - brkStart.getTime());
      totalDeductedBreakMs += elapsedOnBreakMs;
    } else if (brk.status === "Pending Resume" && now >= eDt) {
      const brkStart = brk.stoppedAt ? new Date(brk.stoppedAt) : sDt;
      const elapsedOnBreakMs = Math.max(0, now.getTime() - brkStart.getTime());
      totalDeductedBreakMs += elapsedOnBreakMs;
    }
  }

  let totalManualPauseMs = (attendance.totalManualPauseMinutes || 0) * 60000;
  if (attendance.trackerStatus === "PAUSED" && attendance.activePause?.pausedAt) {
    const activePauseElapsedMs = Math.max(
      0,
      now.getTime() - new Date(attendance.activePause.pausedAt).getTime()
    );
    totalManualPauseMs += activePauseElapsedMs;
  }

  const activeWorkMs = Math.max(0, totalElapsedMs - totalDeductedBreakMs - totalManualPauseMs);
  const activeWorkMinutes = Math.floor(activeWorkMs / 60000);
  if (attendance.totalWorkMinutes !== activeWorkMinutes) {
    attendance.totalWorkMinutes = activeWorkMinutes;
    const h = Math.floor(activeWorkMinutes / 60);
    const m = activeWorkMinutes % 60;
    attendance.totalWorkHoursDisplay = `${h}h ${String(m).padStart(2, "0")}m`;
    modified = true;
  }

  return { modified, activeBreak: currentActiveBreak };
};

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

  if (attendance.trackerStatus === "PAUSED" || attendance.activePause?.pausedAt) {
    resumedType = "MANUAL_PAUSE";
    const pauseStart = attendance.activePause?.pausedAt
      ? new Date(attendance.activePause.pausedAt)
      : null;

    if (pauseStart) {
      pausedMinutes = Math.max(0, Math.floor((now.getTime() - pauseStart.getTime()) / 60000));
    }

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
  else {
    resumedType = "SCHEDULED_BREAK";

    let targetBreak = attendance.breaks.find(
      (b) => b && (b.status === "Pending Resume" || b.status === "Active")
    );

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

    let totalLate = 0;
    for (const b of attendance.breaks) {
      if (b.status === "Completed" && b.lateResumeMinutes > 0) {
        totalLate += b.lateResumeMinutes;
      }
    }
    attendance.totalBreakLateMinutes = totalLate;
    attendance.activeBreak = null;
  }

  const baseCheckout = new Date(
    attendance.originalEarliestAllowedCheckOut || attendance.earliestAllowedCheckOut
  );
  const totalExtraDelayMinutes =
    (attendance.totalBreakLateMinutes || 0) + (attendance.totalManualPauseMinutes || 0);

  const updatedEarliestCheckout = new Date(baseCheckout.getTime() + totalExtraDelayMinutes * 60000);
  attendance.earliestAllowedCheckOut = updatedEarliestCheckout;
  attendance.earliestAllowedCheckOutDisplay = formatTimeDisplay(updatedEarliestCheckout);

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

  await attendance.save();
  return {
    success: true,
    trackerStatus: attendance.trackerStatus,
    activePause: attendance.activePause,
    manualPauses: attendance.manualPauses,
  };
};

let cronTask = null;

export const initBreakTrackerCron = (io = null) => {
  if (cronTask) {
    cronTask.stop();
  }

  console.log("⏱️ Initializing Auto-Break & Late Penalty Tracker Cron Job (every minute)...");

  cronTask = cron.schedule("* * * * *", async () => {
    try {
      const todayDate = getNormalizedDateString();
      const now = new Date();

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
