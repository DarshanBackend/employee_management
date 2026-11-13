import mongoose from "mongoose";
import UserModel from "../model/user.model.js";
import HolidayModel, {
  HOLIDAY_TYPES,
  HOLIDAY_TYPE_COLORS,
  HOLIDAY_TYPE_DESCRIPTIONS,
  HOLIDAY_CLASSIFICATIONS,
} from "../model/holiday.model.js";
import {
  sendCreatedResponse,
  sendSuccessResponse,
  sendErrorResponse,
  sendBadRequestResponse,
  sendNotFoundResponse,
} from "../utils/Response.utils.js";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTH_SHORT = [
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

const DAYS_OF_WEEK = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const normalizeHolidayType = (typeInput) => {
  if (!typeInput) return "Public Holiday";
  const clean = String(typeInput).trim().toLowerCase();
  if (clean === "restricted" || clean === "restricted holiday") {
    return "Restricted Holiday";
  }
  if (clean === "optional" || clean === "optional holiday") {
    return "Optional Holiday";
  }
  return "Public Holiday";
};

const parseMonthParam = (monthInput) => {
  if (monthInput === undefined || monthInput === null || monthInput === "") {
    return null;
  }

  const str = String(monthInput).trim().toLowerCase();
  if (str === "all" || str === "0") {
    return null;
  }

  const num = parseInt(str, 10);
  if (!isNaN(num) && /^\d+$/.test(str)) {
    if (num >= 1 && num <= 12) {
      return num;
    }
    return { error: "Invalid month parameter! Month number must be between 1 and 12." };
  }

  const monthMap = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
  };

  if (monthMap[str]) {
    return monthMap[str];
  }

  return {
    error: `Invalid month '${monthInput}'! Please provide a valid month number (1-12) or month name (e.g. 'November' or 'Nov').`,
  };
};

const parseDateDetails = (dateVal, fieldName = "Date") => {
  if (!dateVal) return { error: `${fieldName} is required!` };

  let year, month, day;
  if (typeof dateVal === "string") {
    const trimmed = dateVal.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return { error: `Invalid ${fieldName} format! Use YYYY-MM-DD format.` };
    }
    const parts = trimmed.split("-");
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2], 10);
  } else {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) {
      return { error: `Invalid ${fieldName} format! Use YYYY-MM-DD format.` };
    }
    year = d.getUTCFullYear();
    month = d.getUTCMonth() + 1;
    day = d.getUTCDate();
  }

  if (isNaN(year) || year < 1900 || year > 2100) {
    return { error: `Invalid year in ${fieldName}! Year must be between 1900 and 2100.` };
  }

  if (isNaN(month) || month < 1 || month > 12) {
    return { error: `Invalid month '${month}' in ${fieldName}! Month must be between 1 and 12.` };
  }

  const maxDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthName = MONTH_NAMES[month - 1] || `Month ${month}`;

  if (isNaN(day) || day < 1 || day > maxDays) {
    return {
      error: `Invalid date '${dateVal}'! Day must be between 1 and ${maxDays} for ${monthName} ${year}.`,
    };
  }

  const d = new Date(Date.UTC(year, month - 1, day));
  if (isNaN(d.getTime())) {
    return { error: `Invalid calendar date for ${fieldName}!` };
  }

  const dayOfWeek = DAYS_OF_WEEK[d.getUTCDay()];
  const padMonth = String(month).padStart(2, "0");
  const padDay = String(day).padStart(2, "0");
  const dateString = `${year}-${padMonth}-${padDay}`;
  const monthShort = MONTH_SHORT[month - 1];
  const formattedDate = `${day} ${monthShort} ${year}`;
  const displayDate = `${dayOfWeek} • ${day} ${monthShort} ${year}`;

  return {
    date: d,
    dateString,
    formattedDate,
    displayDate,
    year,
    month,
    monthShort,
    monthName,
    day,
    dayOfWeek,
  };
};

const getTodayDateString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const calculateHolidayDateRange = (startDateInput, endDateInput, fallbackDateInput = null) => {
  const rawStart = startDateInput || fallbackDateInput;
  const rawEnd = endDateInput || rawStart;

  if (!rawStart) {
    return { error: "Holiday date or startDate is required!" };
  }

  const startDetails = parseDateDetails(rawStart, "startDate");
  if (startDetails.error) {
    return { error: startDetails.error };
  }

  const endDetails = parseDateDetails(rawEnd, "endDate");
  if (endDetails.error) {
    return { error: endDetails.error };
  }

  const startUTC = new Date(Date.UTC(startDetails.year, startDetails.month - 1, startDetails.day));
  const endUTC = new Date(Date.UTC(endDetails.year, endDetails.month - 1, endDetails.day));

  const diffTime = endUTC.getTime() - startUTC.getTime();
  if (diffTime < 0) {
    return { error: "End date cannot be before start date!" };
  }

  const totalDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;

  let formattedDate = startDetails.formattedDate;
  let displayDate = startDetails.displayDate;

  if (totalDays > 1) {
    formattedDate = `${startDetails.day} ${startDetails.monthShort} ${startDetails.year} - ${endDetails.day} ${endDetails.monthShort} ${endDetails.year}`;
    displayDate = `${startDetails.day} ${startDetails.monthShort} - ${endDetails.day} ${endDetails.monthShort} ${endDetails.year} (${totalDays} Days)`;
  }

  return {
    startDate: startDetails.date,
    startDateString: startDetails.dateString,
    endDate: endDetails.date,
    endDateString: endDetails.dateString,
    totalDays,
    date: startDetails.date,
    dateString: startDetails.dateString,
    formattedDate,
    displayDate,
    year: startDetails.year,
    month: startDetails.month,
    monthShort: startDetails.monthShort,
    monthName: startDetails.monthName,
    day: startDetails.day,
    dayOfWeek: startDetails.dayOfWeek,
  };
};

const formatHolidayItem = (h) => {
  const monthNum = h.month || (h.date ? new Date(h.date).getUTCMonth() + 1 : 1);
  const monthShort = h.monthShort || MONTH_SHORT[monthNum - 1] || "";
  const displayDate =
    h.displayDate || `${h.dayOfWeek} • ${h.day} ${monthShort} ${h.year}`;

  const classification =
    h.classification && h.classification.description
      ? h.classification
      : {
        type: h.type,
        color: h.color || HOLIDAY_TYPE_COLORS[h.type] || "#10B981",
        description:
          HOLIDAY_TYPE_DESCRIPTIONS[h.type] ||
          "Mandatory company-wide paid day off for all staff",
      };

  const startDateString = h.startDateString || h.dateString || "";
  const endDateString = h.endDateString || startDateString || "";

  const todayString = getTodayDateString();
  let status = h.status || "Active";
  if (status !== "Inactive") {
    const effectiveEnd = endDateString || startDateString || h.dateString || "";
    if (effectiveEnd && effectiveEnd < todayString) {
      status = "Expired";
    }
  }

  return {
    _id: h._id,
    holidayName: h.holidayName,
    startDate: startDateString,
    startDateString: startDateString,
    endDate: endDateString,
    endDateString: endDateString,
    totalDays: h.totalDays || 1,
    date: h.dateString,
    dateString: h.dateString,
    day: h.day,
    month: monthShort,
    monthNumber: monthNum,
    year: h.year,
    dayOfWeek: h.dayOfWeek,
    formattedDate: h.formattedDate,
    displayDate,
    type: h.type,
    color: h.color || classification.color,
    classification,
    description: h.description || "",
    status,
    createdBy: h.createdBy,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
  };
};

const syncExpiredHolidays = async () => {
  try {
    const todayString = getTodayDateString();
    await HolidayModel.updateMany(
      {
        isDeleted: false,
        status: "Active",
        $or: [
          { endDateString: { $exists: true, $ne: "", $lt: todayString } },
          {
            $and: [
              {
                $or: [
                  { endDateString: { $exists: false } },
                  { endDateString: null },
                  { endDateString: "" },
                ],
              },
              { dateString: { $lt: todayString } },
            ],
          },
        ],
      },
      { $set: { status: "Expired" } }
    );
  } catch (err) {
    console.error("Error syncing expired holidays:", err);
  }
};

const findOverlappingHoliday = async (startDateString, endDateString, excludeId = null) => {
  const query = {
    isDeleted: false,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    $or: [
      {
        startDateString: { $exists: true, $ne: null, $ne: "", $lte: endDateString },
        endDateString: { $exists: true, $ne: null, $ne: "", $gte: startDateString },
      },
      {
        startDateString: { $gte: startDateString, $lte: endDateString },
      },
      {
        endDateString: { $gte: startDateString, $lte: endDateString },
      },
      {
        dateString: { $gte: startDateString, $lte: endDateString },
      },
    ],
  };

  return await HolidayModel.findOne(query);
};

export class HolidayController {
  static async addHoliday(req, res) {
    try {
      const {
        holidayName,
        startDate,
        endDate,
        date,
        type = "Public Holiday",
        classification,
        description = "",
        color,
        status = "Active",
      } = req.body;

      if (!holidayName || !holidayName.trim()) {
        return sendBadRequestResponse(res, "Holiday name is required!");
      }

      if (!startDate && !date) {
        return sendBadRequestResponse(res, "Holiday date or startDate is required!");
      }

      const rangeDetails = calculateHolidayDateRange(startDate, endDate, date);
      if (rangeDetails.error) {
        return sendBadRequestResponse(res, rangeDetails.error);
      }

      const todayString = getTodayDateString();
      if (rangeDetails.startDateString < todayString) {
        return sendBadRequestResponse(
          res,
          `Holiday cannot be added for past dates! Start date must be today (${todayString}) or a future date.`
        );
      }

      const cleanName = holidayName.trim();
      const selectedType = classification || type;
      const normalizedType = normalizeHolidayType(selectedType);

      const overlappingHoliday = await findOverlappingHoliday(
        rangeDetails.startDateString,
        rangeDetails.endDateString
      );

      if (overlappingHoliday) {
        const overlapStart = overlappingHoliday.startDateString || overlappingHoliday.dateString;
        const overlapEnd = overlappingHoliday.endDateString || overlapStart;
        const overlapDisplay =
          overlapStart === overlapEnd ? overlapStart : `${overlapStart} to ${overlapEnd}`;

        return res.status(409).json({
          success: false,
          message: `Holiday '${overlappingHoliday.holidayName}' already exists on ${overlapDisplay}. Overlapping holiday dates are not allowed!`,
        });
      }

      const finalColor =
        color && color.trim()
          ? color.trim()
          : HOLIDAY_TYPE_COLORS[normalizedType] || "#10B981";

      const finalClassification = {
        type: normalizedType,
        color: finalColor,
        description:
          HOLIDAY_TYPE_DESCRIPTIONS[normalizedType] ||
          "Mandatory company-wide paid day off for all staff",
      };

      const newHoliday = await HolidayModel.create({
        holidayName: cleanName,
        startDate: rangeDetails.startDate,
        startDateString: rangeDetails.startDateString,
        endDate: rangeDetails.endDate,
        endDateString: rangeDetails.endDateString,
        totalDays: rangeDetails.totalDays,
        date: rangeDetails.date,
        dateString: rangeDetails.dateString,
        formattedDate: rangeDetails.formattedDate,
        displayDate: rangeDetails.displayDate,
        year: rangeDetails.year,
        month: rangeDetails.month,
        monthShort: rangeDetails.monthShort,
        day: rangeDetails.day,
        dayOfWeek: rangeDetails.dayOfWeek,
        type: normalizedType,
        classification: finalClassification,
        description: description ? description.trim() : "",
        color: finalColor,
        status: ["Active", "Inactive", "Expired"].includes(status)
          ? status
          : rangeDetails.endDateString < getTodayDateString()
            ? "Expired"
            : "Active",
        createdBy: req.user?._id || null,
      });

      return sendCreatedResponse(
        res,
        "Holiday added successfully!",
        formatHolidayItem(newHoliday)
      );
    } catch (error) {
      console.error("Add Holiday Error:", error);
      return sendErrorResponse(res, 500, "Failed to add holiday", error);
    }
  }

  static async getAllHolidays(req, res) {
    try {
      await syncExpiredHolidays();

      const {
        year,
        month,
        day,
        type,
        status,
        search,
        page,
        limit,
        sortBy = "date",
        order = "asc",
      } = req.query;

      const filter = { isDeleted: false };

      if (year) {
        filter.year = parseInt(year, 10);
      }

      if (month) {
        const parsedM = parseMonthParam(month);
        if (parsedM && !parsedM.error) {
          filter.month = parsedM;
        } else if (parsedM?.error) {
          return sendBadRequestResponse(res, parsedM.error);
        }
      }

      if (day) {
        filter.day = parseInt(day, 10);
      }

      if (type && type.trim()) {
        filter.type = normalizeHolidayType(type);
      }

      if (status && ["Active", "Inactive", "Expired"].includes(status)) {
        filter.status = status;
      }

      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        filter.$or = [{ holidayName: regex }, { description: regex }];
      }

      const sortOrder = order === "desc" ? -1 : 1;
      let query = HolidayModel.find(filter)
        .populate("createdBy", "name firstName lastName email role")
        .sort({ [sortBy]: sortOrder });

      const total = await HolidayModel.countDocuments(filter);

      if (page && limit) {
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const skip = (pageNum - 1) * limitNum;
        query = query.skip(skip).limit(limitNum);
      }

      const holidays = await query;

      const publicCount = await HolidayModel.countDocuments({
        ...filter,
        type: "Public Holiday",
      });
      const restrictedCount = await HolidayModel.countDocuments({
        ...filter,
        type: "Restricted Holiday",
      });
      const optionalCount = await HolidayModel.countDocuments({
        ...filter,
        type: "Optional Holiday",
      });

      return sendSuccessResponse(res, "Holidays fetched successfully", {
        total,
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : total,
        totalPages: limit ? Math.ceil(total / parseInt(limit, 10)) : 1,
        summary: {
          publicHolidays: publicCount,
          restrictedHolidays: restrictedCount,
          optionalHolidays: optionalCount,
        },
        holidays: holidays.map(formatHolidayItem),
      });
    } catch (error) {
      console.error("Get Holidays Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch holidays", error);
    }
  }

  static async getCalendarHolidays(req, res) {
    try {
      await syncExpiredHolidays();

      const now = new Date();
      const currentYear = now.getUTCFullYear();
      const currentMonth = now.getUTCMonth() + 1;

      const rawYear = req.query.year ?? req.body?.year;
      const rawMonth = req.query.month ?? req.body?.month;
      const rawDay = req.query.day ?? req.body?.day;
      const rawType = req.query.type ?? req.body?.type;
      const rawStatus = req.query.status ?? req.body?.status;

      const yearNum = rawYear ? parseInt(rawYear, 10) : currentYear;
      if (isNaN(yearNum) || yearNum < 1900 || yearNum > 2100) {
        return sendBadRequestResponse(res, "Invalid year parameter (must be between 1900 and 2100)");
      }

      const parsedMonth = parseMonthParam(rawMonth);
      if (parsedMonth && parsedMonth.error) {
        return sendBadRequestResponse(res, parsedMonth.error);
      }
      const monthNum = parsedMonth; // number 1-12 or null (all months)

      const dayNum = rawDay ? parseInt(rawDay, 10) : null;
      if (dayNum !== null && (isNaN(dayNum) || dayNum < 1 || dayNum > 31)) {
        return sendBadRequestResponse(res, "Invalid day parameter (must be between 1 and 31)");
      }

      const filter = {
        isDeleted: false,
      };

      if (rawStatus && ["Active", "Inactive", "Expired"].includes(rawStatus)) {
        filter.status = rawStatus;
      } else if (rawStatus && rawStatus.toLowerCase() === "all") {
      } else {
        filter.status = { $ne: "Inactive" };
      }

      if (rawType && String(rawType).trim()) {
        filter.type = normalizeHolidayType(rawType);
      }

      if (monthNum) {
        const monthStartStr = `${yearNum}-${String(monthNum).padStart(2, "0")}-01`;
        const lastDayOfMonth = new Date(Date.UTC(yearNum, monthNum, 0)).getUTCDate();
        const monthEndStr = `${yearNum}-${String(monthNum).padStart(2, "0")}-${String(lastDayOfMonth).padStart(2, "0")}`;

        if (dayNum) {
          const targetDateStr = `${yearNum}-${String(monthNum).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
          filter.$or = [
            {
              startDateString: { $lte: targetDateStr },
              endDateString: { $gte: targetDateStr },
            },
            { dateString: targetDateStr },
            { year: yearNum, month: monthNum, day: dayNum },
          ];
        } else {
          filter.$or = [
            { year: yearNum, month: monthNum },
            {
              startDateString: { $exists: true, $ne: null, $ne: "", $lte: monthEndStr },
              endDateString: { $exists: true, $ne: null, $ne: "", $gte: monthStartStr },
            },
            { dateString: { $gte: monthStartStr, $lte: monthEndStr } },
          ];
        }
      } else {
        // No specific month selected -> return all holidays for the year
        const yearStartStr = `${yearNum}-01-01`;
        const yearEndStr = `${yearNum}-12-31`;

        if (dayNum) {
          filter.$or = [
            { year: yearNum, day: dayNum },
            {
              startDateString: { $exists: true, $ne: null, $ne: "", $lte: yearEndStr },
              endDateString: { $exists: true, $ne: null, $ne: "", $gte: yearStartStr },
            },
            { dateString: { $gte: yearStartStr, $lte: yearEndStr } },
          ];
        } else {
          filter.$or = [
            { year: yearNum },
            {
              startDateString: { $exists: true, $ne: null, $ne: "", $lte: yearEndStr },
              endDateString: { $exists: true, $ne: null, $ne: "", $gte: yearStartStr },
            },
            { dateString: { $gte: yearStartStr, $lte: yearEndStr } },
          ];
        }
      }

      const rawHolidays = await HolidayModel.find(filter)
        .select("-isDeleted -__v")
        .populate("createdBy", "name firstName lastName email role")
        .sort({ startDateString: 1, date: 1, day: 1 });

      const holidays = rawHolidays.map(formatHolidayItem);

      return sendSuccessResponse(res, "Calendar holidays fetched successfully", {
        year: yearNum,
        month: monthNum || "All",
        monthName: monthNum ? MONTH_NAMES[monthNum - 1] : "All Months",
        ...(dayNum ? { day: dayNum } : {}),
        selectedMonth: monthNum ? MONTH_NAMES[monthNum - 1] : "All Months",
        currentMonth,
        currentMonthName: MONTH_NAMES[currentMonth - 1],
        totalHolidays: holidays.length,
        holidays,
      });
    } catch (error) {
      console.error("Get Calendar Holidays Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch calendar holidays", error);
    }
  }

  static async getHolidayById(req, res) {
    try {
      await syncExpiredHolidays();

      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid holiday ID");
      }

      const holiday = await HolidayModel.findOne({
        _id: id,
        isDeleted: false,
      }).populate("createdBy", "name firstName lastName email role");

      if (!holiday) {
        return sendNotFoundResponse(res, "Holiday not found");
      }

      return sendSuccessResponse(
        res,
        "Holiday details fetched successfully",
        formatHolidayItem(holiday)
      );
    } catch (error) {
      console.error("Get Holiday By ID Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch holiday details", error);
    }
  }

  static async updateHoliday(req, res) {
    try {
      const { id } = req.params;
      const {
        holidayName,
        startDate,
        endDate,
        date,
        type,
        classification,
        description,
        color,
        status,
      } = req.body;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid holiday ID");
      }

      const holiday = await HolidayModel.findOne({
        _id: id,
        isDeleted: false,
      });

      if (!holiday) {
        return sendNotFoundResponse(res, "Holiday not found");
      }

      if (holidayName && holidayName.trim()) {
        holiday.holidayName = holidayName.trim();
      }

      if (startDate !== undefined || endDate !== undefined || date !== undefined) {
        const currentStart = holiday.startDateString || holiday.dateString;
        const currentEnd = holiday.endDateString || currentStart;

        const targetStart = startDate || (date !== undefined ? date : currentStart);
        const targetEnd =
          endDate ||
          (startDate !== undefined && endDate === undefined
            ? (startDate > currentEnd ? startDate : currentEnd)
            : date !== undefined
              ? date
              : currentEnd);

        const rangeDetails = calculateHolidayDateRange(targetStart, targetEnd);
        if (rangeDetails.error) {
          return sendBadRequestResponse(res, rangeDetails.error);
        }

        const todayString = getTodayDateString();
        if (rangeDetails.startDateString < todayString) {
          return sendBadRequestResponse(
            res,
            `Holiday cannot be set to a past date! Start date must be today (${todayString}) or a future date.`
          );
        }

        const overlappingHoliday = await findOverlappingHoliday(
          rangeDetails.startDateString,
          rangeDetails.endDateString,
          holiday._id
        );

        if (overlappingHoliday) {
          const overlapStart = overlappingHoliday.startDateString || overlappingHoliday.dateString;
          const overlapEnd = overlappingHoliday.endDateString || overlapStart;
          const overlapDisplay =
            overlapStart === overlapEnd ? overlapStart : `${overlapStart} to ${overlapEnd}`;

          return res.status(409).json({
            success: false,
            message: `Holiday date overlaps with existing holiday '${overlappingHoliday.holidayName}' (${overlapDisplay}).`,
          });
        }

        holiday.startDate = rangeDetails.startDate;
        holiday.startDateString = rangeDetails.startDateString;
        holiday.endDate = rangeDetails.endDate;
        holiday.endDateString = rangeDetails.endDateString;
        holiday.totalDays = rangeDetails.totalDays;
        holiday.date = rangeDetails.date;
        holiday.dateString = rangeDetails.dateString;
        holiday.formattedDate = rangeDetails.formattedDate;
        holiday.displayDate = rangeDetails.displayDate;
        holiday.year = rangeDetails.year;
        holiday.month = rangeDetails.month;
        holiday.monthShort = rangeDetails.monthShort;
        holiday.day = rangeDetails.day;
        holiday.dayOfWeek = rangeDetails.dayOfWeek;
      }

      const selectedType = classification || type;
      if (selectedType) {
        const normalizedType = normalizeHolidayType(selectedType);
        holiday.type = normalizedType;
        const typeColor =
          color && color.trim()
            ? color.trim()
            : HOLIDAY_TYPE_COLORS[normalizedType] || "#10B981";
        holiday.color = typeColor;
        holiday.classification = {
          type: normalizedType,
          color: typeColor,
          description:
            HOLIDAY_TYPE_DESCRIPTIONS[normalizedType] ||
            "Mandatory company-wide paid day off for all staff",
        };
      } else if (color && color.trim()) {
        holiday.color = color.trim();
        if (holiday.classification) {
          holiday.classification.color = color.trim();
        }
      }

      if (description !== undefined) {
        holiday.description = description ? description.trim() : "";
      }

      if (status && ["Active", "Inactive", "Expired"].includes(status)) {
        holiday.status = status;
      }

      await holiday.save();

      return sendSuccessResponse(
        res,
        "Holiday updated successfully",
        formatHolidayItem(holiday)
      );
    } catch (error) {
      console.error("Update Holiday Error:", error);
      return sendErrorResponse(res, 500, "Failed to update holiday", error);
    }
  }

  static async deleteHoliday(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendBadRequestResponse(res, "Invalid holiday ID");
      }

      const holiday = await HolidayModel.findOne({
        _id: id,
        isDeleted: false,
      });

      if (!holiday) {
        return sendNotFoundResponse(res, "Holiday not found");
      }

      holiday.isDeleted = true;
      await holiday.save();

      return sendSuccessResponse(res, "Holiday deleted successfully");
    } catch (error) {
      console.error("Delete Holiday Error:", error);
      return sendErrorResponse(res, 500, "Failed to delete holiday", error);
    }
  }
}
