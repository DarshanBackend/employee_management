import mongoose from "mongoose";

const OtpSchema = new mongoose.Schema(
  {
    code: { type: String, default: null },
    expiresAt: { type: Date, default: null },
    isVerified: { type: Boolean, default: false },
    type: {
      type: String,
      enum: ["register", "forgot_password"],
      default: null,
    },
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema(
  {

    employeeId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    firstName: {
      type: String,
      trim: true,
      default: "",
    },
    lastName: {
      type: String,
      trim: true,
      default: "",
    },
    name: {
      type: String,
      default: function () {
        if (this.firstName || this.lastName) {
          return `${this.firstName || ""} ${this.lastName || ""}`.trim();
        }
        if (this.email) {
          const prefix = this.email.split("@")[0];
          return prefix
            .split(/[._-]/)
            .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
            .join(" ");
        }
        return "Employee";
      },
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/.+@.+\..+/, "Please enter a valid email address"],
    },
    password: {
      type: String,
      select: false,
    },
    avatarUrl: {
      type: String,
      default: null,
    },
    phone: {
      type: String,
      default: null,
      trim: true,
    },
    role: {
      type: String,
      enum: ["admin", "employee"],
      default: "employee",
    },
    isEmailVerified: {
      type: Boolean,
      default: true,
    },
    otp: {
      type: OtpSchema,
      select: false,
      default: () => ({
        code: null,
        expiresAt: null,
        isVerified: false,
        type: null,
      }),
    },

    dateOfBirth: {
      type: String,
      default: null,
    },
    gender: {
      type: String,
      enum: ["Male", "Female", "Other", ""],
      default: "",
    },
    maritalStatus: {
      type: String,
      enum: ["Single", "Married", "Divorced", "Widowed", ""],
      default: "",
    },
    bloodGroup: {
      type: String,
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", ""],
      default: "",
    },
    nationality: {
      type: String,
      default: "Indian",
      trim: true,
    },

    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
    },
    designation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Designation",
      default: null,
    },
    employmentType: {
      type: String,
      enum: ["Full-time", "Part-time", "Contract", "Internship", "Freelance", ""],
      default: "Full-time",
    },
    employeeStatus: {
      type: String,
      enum: ["Active", "Inactive", "On Leave", "Terminated", "Probation"],
      default: "Active",
    },
    joiningDate: {
      type: String,
      default: null,
    },
    probationPeriod: {
      type: String,
      default: "",
    },
    reportingManager: {
      type: String,
      default: "",
      trim: true,
    },
    workLocation: {
      type: String,
      default: "",
      trim: true,
    },

    contactInfo: {
      personalEmail: { type: String, lowercase: true, trim: true, default: "" },
      mobileNumber: { type: String, trim: true, default: "" },
      alternatePhone: { type: String, trim: true, default: "" },
      address: {
        addressLine1: { type: String, trim: true, default: "" },
        addressLine2: { type: String, trim: true, default: "" },
        city: { type: String, trim: true, default: "" },
        state: { type: String, trim: true, default: "" },
        country: { type: String, trim: true, default: "India" },
        zipCode: { type: String, trim: true, default: "" },
      },
    },

    shiftAndSchedule: {
      shiftTiming: {
        type: String,
        default: "General Shift",
      },
      weeklyOff: {
        type: String,
        default: "Sat - Sun",
      },
    },

    emergencyContact: {
      contactName: { type: String, trim: true, default: "" },
      relationship: { type: String, trim: true, default: "" },
      phoneNumber: { type: String, trim: true, default: "" },
      alternatePhone: { type: String, trim: true, default: "" },
    },

    documents: {
      panCard: { type: String, default: null },
      aadhaarCard: { type: String, default: null },
      addressProof: { type: String, default: null },
      educationCertificate: { type: String, default: null },
      experienceLetter: { type: String, default: null },
      joiningLetter: { type: String, default: null },
      otherDocuments: [
        {
          title: String,
          url: String,
          uploadedAt: { type: Date, default: Date.now },
        },
      ],
    },

    additionalInfo: {
      employmentNotes: {
        type: String,
        maxLength: 500,
        default: "",
      },
    },

    isUserDeleted: {
      type: Boolean,
      default: false,
    },
    fcmToken: {
      type: String,
      default: null,
    },
    tokenVersion: {
      type: Number,
      default: 0,
    },
    lastLogoutAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

UserSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.otp;
    return ret;
  },
});

UserSchema.set("toObject", {
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.otp;
    return ret;
  },
});

const UserModel = mongoose.model("User", UserSchema);
export default UserModel;
