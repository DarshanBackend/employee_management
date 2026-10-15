import mongoose from "mongoose";

export const HOLIDAY_TYPES = [
  "Public Holiday",
  "Restricted Holiday",
  "Optional Holiday",
];

export const HOLIDAY_TYPE_COLORS = {
  "Public Holiday": "#10B981",
  "Restricted Holiday": "#EF4444",
  "Optional Holiday": "#3B82F6",
};

export const HOLIDAY_TYPE_DESCRIPTIONS = {
  "Public Holiday": "Mandatory company-wide paid day off for all staff",
  "Restricted Holiday": "Special religious or cultural holiday with conditions",
  "Optional Holiday": "Floating holiday available for employee selection",
};

export const HOLIDAY_CLASSIFICATIONS = [
  {
    type: "Public Holiday",
    color: "#10B981",
    description: "Mandatory company-wide paid day off for all staff",
  },
  {
    type: "Restricted Holiday",
    color: "#EF4444",
    description: "Special religious or cultural holiday with conditions",
  },
  {
    type: "Optional Holiday",
    color: "#3B82F6",
    description: "Floating holiday available for employee selection",
  },
];

const HolidaySchema = new mongoose.Schema(
  {
    holidayName: {
      type: String,
      required: [true, "Holiday name is required"],
      trim: true,
    },
    date: {
      type: Date,
      required: [true, "Holiday date is required"],
    },
    dateString: {
      type: String,
      required: true,
      trim: true,
    },
    formattedDate: {
      type: String,
      trim: true,
    },
    displayDate: {
      type: String,
      trim: true,
    },
    year: {
      type: Number,
      required: true,
      index: true,
    },
    month: {
      type: Number,
      required: true,
      index: true,
    },
    monthShort: {
      type: String,
      trim: true,
    },
    day: {
      type: Number,
      required: true,
    },
    dayOfWeek: {
      type: String,
      trim: true,
    },
    type: {
      type: String,
      enum: {
        values: HOLIDAY_TYPES,
        message: "Type must be Public Holiday, Restricted Holiday, or Optional Holiday",
      },
      default: "Public Holiday",
    },
    classification: {
      type: {
        type: String,
        default: "Public Holiday",
      },
      color: {
        type: String,
        default: "#10B981",
      },
      description: {
        type: String,
        default: "Mandatory company-wide paid day off for all staff",
      },
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    color: {
      type: String,
      trim: true,
      default: "#10B981",
    },
    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active",
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    id: false,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.id;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.id;
        return ret;
      },
    },
  }
);

HolidaySchema.index({ dateString: 1, isDeleted: 1 });
HolidaySchema.index({ year: 1, month: 1, isDeleted: 1 });

const HolidayModel = mongoose.model("Holiday", HolidaySchema);
export default HolidayModel;
