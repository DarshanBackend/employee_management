import mongoose from "mongoose";

const AnalyticsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    completedLessons: [
      {
        lessonId: String,
        lessonTitle: String,
        completedAt: { type: Date, default: Date.now },
      },
    ],
    completedQuestions: [
      {
        questionId: String,
        completedAt: { type: Date, default: Date.now },
      },
    ],
    totalMinutesPracticed: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

const AnalyticsModel = mongoose.model("Analytics", AnalyticsSchema);
export default AnalyticsModel;
