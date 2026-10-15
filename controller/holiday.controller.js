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

const parseDateDetails = (dateVal) => {
  if (!dateVal) return null;

  let year, month, day;
  if (typeof dateVal === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateVal.trim())) {
    const parts = dateVal.trim().split("-");
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2], 10);
  } else {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return null;
    year = d.getUTCFullYear();
    month = d.getUTCMonth() + 1;
    day = d.getUTCDate();
  }

  const d = new Date(Date.UTC(year, month - 1, day));
  if (isNaN(d.getTime())) return null;

  const dayOfWeek = DAYS_OF_WEEK[d.getUTCDay()];
  const padMonth = String(month).padStart(2, "0");
  const padDay = String(day).padStart(2, "0");
  const dateString = `${year}-${padMonth}-${padDay}`;
  const monthShort = MONTH_SHORT[month - 1];
  const monthName = MONTH_NAMES[month - 1];
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

  return {
    _id: h._id,
    holidayName: h.holidayName,
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
    status: h.status || "Active",
    createdBy: h.createdBy,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
  };
};

export class HolidayController {
  /**
   * Add a new holiday (Admin only)
   */
  static async addHoliday(req, res) {
    try {
      const {
        holidayName,
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

      if (!date) {
        return sendBadRequestResponse(res, "Holiday date is required!");
      }

      const dateDetails = parseDateDetails(date);
      if (!dateDetails) {
        return sendBadRequestResponse(res, "Invalid holiday date format! Use YYYY-MM-DD");
      }

      const cleanName = holidayName.trim();
      const selectedType = classification || type;
      const normalizedType = normalizeHolidayType(selectedType);

      const existing = await HolidayModel.findOne({
        dateString: dateDetails.dateString,
        holidayName: { $regex: new RegExp(`^${cleanName}$`, "i") },
        isDeleted: false,
      });

      if (existing) {
        return res.status(409).json({
          success: false,
          message: `Holiday '${cleanName}' on date ${dateDetails.dateString} already exists.`,
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
        date: dateDetails.date,
        dateString: dateDetails.dateString,
        formattedDate: dateDetails.formattedDate,
        displayDate: dateDetails.displayDate,
        year: dateDetails.year,
        month: dateDetails.month,
        monthShort: dateDetails.monthShort,
        day: dateDetails.day,
        dayOfWeek: dateDetails.dayOfWeek,
        type: normalizedType,
        classification: finalClassification,
        description: description ? description.trim() : "",
        color: finalColor,
        status: ["Active", "Inactive"].includes(status) ? status : "Active",
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

  /**
   * Get all holidays added by admin
   */
  static async getAllHolidays(req, res) {
    try {
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
        filter.month = parseInt(month, 10);
      }

      if (day) {
        filter.day = parseInt(day, 10);
      }

      if (type && type.trim()) {
        filter.type = normalizeHolidayType(type);
      }

      if (status && ["Active", "Inactive"].includes(status)) {
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

  /**
   * Get calendar holidays matching the UI Preview structure
   */
  static async getCalendarHolidays(req, res) {
    try {
      const now = new Date();
      const currentYear = now.getUTCFullYear();
      const currentMonth = now.getUTCMonth() + 1;

      const yearNum = req.query.year ? parseInt(req.query.year, 10) : currentYear;
      const monthNum = req.query.month ? parseInt(req.query.month, 10) : currentMonth;
      const dayNum = req.query.day ? parseInt(req.query.day, 10) : null;

      if (isNaN(yearNum) || yearNum < 1900 || yearNum > 2100) {
        return sendBadRequestResponse(res, "Invalid year parameter");
      }

      if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        return sendBadRequestResponse(res, "Invalid month parameter (must be 1-12)");
      }

      if (dayNum !== null && (isNaN(dayNum) || dayNum < 1 || dayNum > 31)) {
        return sendBadRequestResponse(res, "Invalid day parameter (must be 1-31)");
      }

      const filter = {
        isDeleted: false,
        status: "Active",
        year: yearNum,
        month: monthNum,
      };

      if (dayNum) {
        filter.day = dayNum;
      }

      const rawHolidays = await HolidayModel.find(filter)
        .select("-isDeleted -__v")
        .populate("createdBy", "name firstName lastName email role")
        .sort({ day: 1 });

      const holidays = rawHolidays.map(formatHolidayItem);

      return sendSuccessResponse(res, "Calendar holidays fetched successfully", {
        year: yearNum,
        month: monthNum,
        monthName: MONTH_NAMES[monthNum - 1] || "",
        ...(dayNum ? { day: dayNum } : {}),
        totalHolidays: holidays.length,
        holidays,
      });
    } catch (error) {
      console.error("Get Calendar Holidays Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch calendar holidays", error);
    }
  }

  /**
   * Get single holiday by ID
   */
  static async getHolidayById(req, res) {
    try {
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

  /**
   * Update holiday (Admin only)
   */
  static async updateHoliday(req, res) {
    try {
      const { id } = req.params;
      const {
        holidayName,
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

      if (date) {
        const dateDetails = parseDateDetails(date);
        if (!dateDetails) {
          return sendBadRequestResponse(res, "Invalid date format! Use YYYY-MM-DD");
        }
        holiday.date = dateDetails.date;
        holiday.dateString = dateDetails.dateString;
        holiday.formattedDate = dateDetails.formattedDate;
        holiday.displayDate = dateDetails.displayDate;
        holiday.year = dateDetails.year;
        holiday.month = dateDetails.month;
        holiday.monthShort = dateDetails.monthShort;
        holiday.day = dateDetails.day;
        holiday.dayOfWeek = dateDetails.dayOfWeek;
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
        holiday.description = description.trim();
      }

      if (status && ["Active", "Inactive"].includes(status)) {
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

  /**
   * Delete holiday (Admin only)
   */
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
