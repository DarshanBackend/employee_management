import UserModel from "../model/user.model.js";
import ProfileUpdateRequestModel from "../model/profileUpdateRequest.model.js";
import { uploadFile, deleteFileFromS3 } from "../middleware/imageupload.js";

export const getProfile = async (req, res) => {
  try {
    const user = await UserModel.findById(req.user._id)
      .select("-password -otp")
      .populate("department", "departmentName icon color")
      .populate("designation", "designationName designationTitle level icon")
      .populate("shift", "shiftName startTime endTime durationHours workHoursDisplay breakTime teaBreaks color")
      .populate("shiftAndSchedule.shift", "shiftName startTime endTime durationHours workHoursDisplay breakTime teaBreaks color")
      .populate("customRole", "roleTitle category badgeColor permissions");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const userObj = user.toObject();

    if (userObj.role === "admin") {
      delete userObj.shift;
      delete userObj.shiftAndSchedule;
    }

    userObj.departmentName = user.department?.departmentName || "";
    userObj.designationName =
      user.designation?.designationName ||
      user.designation?.designationTitle ||
      "";

    const changeRequests = await ProfileUpdateRequestModel.find({
      employee: req.user._id,
    }).sort({ createdAt: -1 });

    const formattedRequests = changeRequests.map((r) => {
      const d = new Date(r.createdAt);
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      return {
        _id: r._id,
        fieldToUpdate: r.fieldToUpdate,
        currentValue: r.currentValue,
        proposedValue: r.proposedValue,
        reason: r.reason,
        status: r.status,
        adminRemarks: r.adminRemarks || "",
        createdAt: r.createdAt,
        formattedDate: `${day}-${month}-${year}`,
        statusBadgeColor:
          r.status === "Approved"
            ? "#10B981"
            : r.status === "Rejected"
              ? "#EF4444"
              : "#F59E0B",
      };
    });

    userObj.submittedProfileChangeRequests = formattedRequests;

    userObj.officialOrganizationDetails = {
      employeeId: userObj.employeeId || String(userObj._id),
      workEmail: userObj.email || "",
      department: user.department?.departmentName || "Engineering",
      departmentName: user.department?.departmentName || "Engineering",
      designation: user.designation?.designationName || "Software Engineer",
      designationName: user.designation?.designationName || "Software Engineer",
      employmentType: userObj.employmentType || "Full-Time Permanent",
      status: userObj.employeeStatus || "Active",
    };

    userObj.contactAndPersonalInformation = {
      personalMobilePhone:
        userObj.contactInfo?.mobileNumber || userObj.phone || "",
      emergencyContactPerson: userObj.emergencyContact?.contactName || "",
      emergencyContactNumber: userObj.emergencyContact?.phoneNumber || "",
      emergencyContactPersonAndNumber:
        userObj.emergencyContact?.contactName && userObj.emergencyContact?.phoneNumber
          ? `${userObj.emergencyContact.contactName} - ${userObj.emergencyContact.phoneNumber}`
          : userObj.emergencyContact?.contactName ||
          userObj.emergencyContact?.phoneNumber ||
          "",
      currentResidentialAddress:
        userObj.contactInfo?.address?.addressLine1 || "",
      addressLine2: userObj.contactInfo?.address?.addressLine2 || "",
      city: userObj.contactInfo?.address?.city || "",
      state: userObj.contactInfo?.address?.state || "",
      zipCode: userObj.contactInfo?.address?.zipCode || "",
    };

    return res.status(200).json({
      success: true,
      message: "Profile retrieved successfully",
      result: userObj,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      name,
      firstName,
      lastName,
      phone,
      gender,
      dateOfBirth,
      maritalStatus,
      bloodGroup,
      nationality,
      onboarding,
    } = req.body;

    const user = await UserModel.findById(userId).select("-password -otp");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (name) user.name = name.trim();
    if (firstName) user.firstName = firstName.trim();
    if (lastName) user.lastName = lastName.trim();
    if (phone) user.phone = phone.trim();
    if (gender !== undefined) user.gender = gender;
    if (dateOfBirth !== undefined) user.dateOfBirth = dateOfBirth;
    if (maritalStatus !== undefined) user.maritalStatus = maritalStatus;
    if (bloodGroup !== undefined) user.bloodGroup = bloodGroup;
    if (nationality) user.nationality = nationality.trim();

    if (req.file) {
      if (user.avatarUrl) {
        await deleteFileFromS3(user.avatarUrl);
      }
      const uploadResult = await uploadFile(req.file);
      user.avatarUrl = uploadResult.url;
    }

    if (onboarding) {
      let parsedOnboarding = onboarding;
      if (typeof onboarding === "string") {
        try {
          parsedOnboarding = JSON.parse(onboarding);
        } catch (e) {
          console.error("Error parsing onboarding JSON string:", e.message);
        }
      }

      if (parsedOnboarding && typeof parsedOnboarding === "object") {
        user.onboarding = {
          ...user.onboarding?.toObject(),
          ...parsedOnboarding,
        };
      }
    }

    await user.save();

    const updatedUser = await UserModel.findById(userId)
      .select("-password -otp")
      .populate("department", "departmentName icon color")
      .populate("designation", "designationName designationTitle level icon")
      .populate("shift", "shiftName startTime endTime durationHours workHoursDisplay breakTime teaBreaks color")
      .populate("shiftAndSchedule.shift", "shiftName startTime endTime durationHours workHoursDisplay breakTime teaBreaks color")
      .populate("customRole", "roleTitle category badgeColor permissions");

    const userObj = updatedUser.toObject();
    if (userObj.role === "admin") {
      delete userObj.shift;
      delete userObj.shiftAndSchedule;
    }
    userObj.departmentName = updatedUser.department?.departmentName || "";
    userObj.designationName =
      updatedUser.designation?.designationName ||
      updatedUser.designation?.designationTitle ||
      "";

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      result: userObj,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

export const getSettings = async (req, res) => {
  try {
    const userId = req.user._id;
    let settings = await UserSettingsModel.findOne({ userId });

    if (!settings) {
      settings = await UserSettingsModel.create({ userId });
    }

    return res.status(200).json({
      success: true,
      message: "UserSettings retrieved successfully",
      result: settings,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

export const updateSettings = async (req, res) => {
  try {
    const userId = req.user._id;
    const { notifications, preferences } = req.body;

    let settings = await UserSettingsModel.findOne({ userId });
    if (!settings) {
      settings = new UserSettingsModel({ userId });
    }

    if (notifications) {
      if (notifications.status !== undefined) {
        settings.notifications.status = notifications.status;
      }
      if (notifications.dailyPracticeReminder !== undefined) {
        settings.notifications.dailyPracticeReminder = notifications.dailyPracticeReminder;
      }
      if (notifications.dailyReminderTime !== undefined) {
        settings.notifications.dailyReminderTime = notifications.dailyReminderTime;
      }
      if (notifications.streakReminder !== undefined) {
        settings.notifications.streakReminder = notifications.streakReminder;
      }
      if (notifications.streakFreezeAlert !== undefined) {
        settings.notifications.streakFreezeAlert = notifications.streakFreezeAlert;
      }
      if (notifications.weeklyProgressSummary !== undefined) {
        settings.notifications.weeklyProgressSummary = notifications.weeklyProgressSummary;
      }
      if (notifications.challenge !== undefined) {
        settings.notifications.challenge = notifications.challenge;
      }
      if (notifications.reviewReminder !== undefined) {
        settings.notifications.reviewReminder = notifications.reviewReminder;
      }
      if (notifications.newFeatureUpdates !== undefined) {
        settings.notifications.newFeatureUpdates = notifications.newFeatureUpdates;
      }
    }

    if (preferences) {
      if (preferences.soundEffects !== undefined) {
        settings.preferences.soundEffects = preferences.soundEffects;
      }
      if (preferences.hapticFeedback !== undefined) {
        settings.preferences.hapticFeedback = preferences.hapticFeedback;
      }
      if (preferences.listeningExercises !== undefined) {
        settings.preferences.listeningExercises = preferences.listeningExercises;
      }
      if (preferences.friendStreaks !== undefined) {
        settings.preferences.friendStreaks = preferences.friendStreaks;
      }
    }

    await settings.save();

    return res.status(200).json({
      success: true,
      message: "UserSettings updated successfully",
      result: settings,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

export const deleteAccount = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await UserModel.findById(userId);
    if (user?.avatarUrl) {
      await deleteFileFromS3(user.avatarUrl);
    }

    await UserModel.findByIdAndDelete(userId);

    return res.status(200).json({
      success: true,
      message: "User account deleted successfully.",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};