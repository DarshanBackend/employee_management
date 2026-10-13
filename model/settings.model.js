import mongoose from "mongoose";

const UserSettingsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    notifications: {
      status: { type: Boolean, default: true },
      dailyPracticeReminder: { type: Boolean, default: true },
      dailyReminderTime: { type: String, default: "20:00" },
      streakReminder: { type: Boolean, default: true },
      streakFreezeAlert: { type: Boolean, default: true },
      weeklyProgressSummary: { type: Boolean, default: true },
      challenge: { type: Boolean, default: true },
      reviewReminder: { type: Boolean, default: true },
      newFeatureUpdates: { type: Boolean, default: false },
    },
    preferences: {
      soundEffects: { type: Boolean, default: true },
      hapticFeedback: { type: Boolean, default: true },
      listeningExercises: { type: Boolean, default: true },
      friendStreaks: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

const UserSettingsModel = mongoose.model("UserSettings", UserSettingsSchema);
export default UserSettingsModel;
