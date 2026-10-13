import UserModel from "../model/user.model.js";
import UserSettingsModel from "../model/settings.model.js";
import AnalyticsModel from "../model/analytics.model.js";
import { uploadFile, deleteFileFromS3 } from "../middleware/imageupload.js";
import { checkUserSubscriptionAccess } from "../middleware/auth.middleware.js";

const formatDate = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getMidnightTimestamp = (date) => {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

const getDaysDifference = (date1, date2) => {
  const msPerDay = 1000 * 60 * 60 * 24;
  const t1 = getMidnightTimestamp(date1);
  const t2 = getMidnightTimestamp(date2);
  return Math.round((t1 - t2) / msPerDay);
};

export const syncUserStreak = async (userOrId) => {
  try {
    let user = typeof userOrId === "object" && userOrId !== null && userOrId._id
      ? userOrId
      : await UserModel.findById(userOrId);

    if (!user || !user.lastPracticedDate) return 0;

    const now = new Date();
    const diffDays = getDaysDifference(now, user.lastPracticedDate);

    if (diffDays > 1 && user.streakDays > 0) {
      user.streakDays = 0;
      await user.save();
    }

    return user.streakDays || 0;
  } catch (err) {
    return 0;
  }
};

export const recordUserPractice = async (userOrId) => {
  try {
    let user = typeof userOrId === "object" && userOrId !== null && userOrId._id
      ? userOrId
      : await UserModel.findById(userOrId);

    if (!user) return 0;

    const now = new Date();
    const todayStr = formatDate(now);

    if (!user.practiceHistory) {
      user.practiceHistory = [];
    }

    if (!user.practiceHistory.includes(todayStr)) {
      user.practiceHistory.push(todayStr);
    }

    if (!user.lastPracticedDate) {

      user.streakDays = 1;
    } else {
      const diffDays = getDaysDifference(now, user.lastPracticedDate);

      if (diffDays === 0) {

        user.streakDays = Math.max(1, user.streakDays || 1);
      } else if (diffDays === 1) {

        user.streakDays = (user.streakDays || 0) + 1;
      } else {

        user.streakDays = 1;
      }
    }

    user.lastPracticedDate = now;
    await user.save();
    return user.streakDays;
  } catch (err) {
    console.error("Error recording user practice:", err.message);
    return 0;
  }
};

export const getProfile = async (req, res) => {
  try {
    const user = await UserModel.findById(req.user._id).select("-password -otp");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    await syncUserStreak(user);
    const accessInfo = await checkUserSubscriptionAccess(user);

    let settings = await UserSettingsModel.findOne({ userId: req.user._id });
    if (!settings) {
      settings = await UserSettingsModel.create({ userId: req.user._id });
    }

    return res.status(200).json({
      success: true,
      message: "Profile retrieved successfully",
      result: {
        ...user.toObject(),
        settings,
        subscriptionStatus: accessInfo,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const { name, phone, onboarding } = req.body;

    const user = await UserModel.findById(userId).select("-password -otp");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (name) user.name = name.trim();
    if (phone) user.phone = phone.trim();

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

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      result: user,
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

export const getAnalytics = async (req, res) => {
  try {
    const userId = req.user._id;
    let analytics = await AnalyticsModel.findOne({ userId });

    if (!analytics) {
      analytics = await AnalyticsModel.create({ userId });
    }

    return res.status(200).json({
      success: true,
      message: "Analytics retrieved successfully",
      result: analytics,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

export const getInsights = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    let analytics = await AnalyticsModel.findOne({ userId });
    if (!analytics) {
      analytics = await AnalyticsModel.create({ userId });
    }

    const chatSessions = await ChatSessionModel.find({ userId });

    const allPracticedDatesSet = new Set(user.practiceHistory || []);

    (analytics.completedLessons || []).forEach((cl) => {
      if (cl.completedAt) {
        allPracticedDatesSet.add(formatDate(cl.completedAt));
      }
    });

    (analytics.completedQuestions || []).forEach((cq) => {
      if (cq.completedAt) {
        allPracticedDatesSet.add(formatDate(cq.completedAt));
      }
    });

    chatSessions.forEach((cs) => {
      (cs.messages || []).forEach((m) => {
        if (m.createdAt) {
          allPracticedDatesSet.add(formatDate(m.createdAt));
        }
      });
    });

    const now = new Date();
    const todayStr = formatDate(now);

    const currentDayOfWeek = now.getDay();
    const distanceToMonday = (currentDayOfWeek + 6) % 7;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - distanceToMonday);

    const dayNames = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
    const weekDays = [];
    let daysPracticedThisWeek = 0;

    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      const dateStr = formatDate(dayDate);
      const isPracticed = allPracticedDatesSet.has(dateStr);
      if (isPracticed) daysPracticedThisWeek++;
      const isToday = dateStr === todayStr;

      weekDays.push({
        dayName: dayNames[i],
        date: dateStr,
        dayNumber: dayDate.getDate(),
        isPracticed,
        isToday,
      });
    }

    const targetYear = req.query.year ? parseInt(req.query.year, 10) : now.getFullYear();
    const targetMonth = req.query.month ? parseInt(req.query.month, 10) : now.getMonth() + 1;

    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    const monthTitle = `${monthNames[targetMonth - 1]}, ${targetYear}`;

    const totalDaysInMonth = new Date(targetYear, targetMonth, 0).getDate();
    const monthlyDays = [];
    let daysPracticedInMonth = 0;

    for (let d = 1; d <= totalDaysInMonth; d++) {
      const dayDate = new Date(targetYear, targetMonth - 1, d);
      const dateStr = formatDate(dayDate);
      const dayOfWeekIndex = (dayDate.getDay() + 6) % 7;
      const isPracticed = allPracticedDatesSet.has(dateStr);
      if (isPracticed) daysPracticedInMonth++;
      const isToday = dateStr === todayStr;

      monthlyDays.push({
        dayNumber: d,
        date: dateStr,
        dayName: dayNames[dayOfWeekIndex],
        isPracticed,
        isToday,
        isCurrentMonth: true,
      });
    }

    const streakCount = await syncUserStreak(user);
    const weeklyGoal = 7;
    const daysToWeeklyGoal = Math.max(0, weeklyGoal - daysPracticedThisWeek);

    const speakingScore = analytics.speakingTrendScore || 0;
    const listeningScore = analytics.listeningTrendScore || 0;
    const vocabularyScore = analytics.vocabularyTrendScore || 0;

    const isTrendsEmpty =
      speakingScore === 0 &&
      listeningScore === 0 &&
      vocabularyScore === 0 &&
      (analytics.completedLessons?.length || 0) === 0;

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const completedQuestionsList = analytics.completedQuestions || [];

    const thisWeekQuestions = completedQuestionsList.filter(
      (q) => q.completedAt && new Date(q.completedAt) >= sevenDaysAgo
    );
    const lastWeekQuestions = completedQuestionsList.filter((q) => {
      if (!q.completedAt) return false;
      const d = new Date(q.completedAt);
      return d >= fourteenDaysAgo && d < sevenDaysAgo;
    });

    const calculateSkillTrend = (score, defaultFactor = 0.12) => {
      if (!score || score === 0) {
        return {
          score: 0,
          trendPercent: 0,
          trendDirection: "up",
          trendLabel: "0%",
        };
      }

      let thisWeekAccuracy =
        thisWeekQuestions.length > 0
          ? Math.round(
            (thisWeekQuestions.filter((i) => i.isCorrect || (i.score || 0) >= 70).length /
              thisWeekQuestions.length) *
            100
          )
          : score;

      let lastWeekAccuracy =
        lastWeekQuestions.length > 0
          ? Math.round(
            (lastWeekQuestions.filter((i) => i.isCorrect || (i.score || 0) >= 70).length /
              lastWeekQuestions.length) *
            100
          )
          : null;

      let trendPercent = 0;
      let trendDirection = "up";

      if (lastWeekAccuracy !== null && thisWeekQuestions.length > 0) {
        const diff = thisWeekAccuracy - lastWeekAccuracy;
        trendDirection = diff >= 0 ? "up" : "down";
        trendPercent = Math.abs(diff);
      } else {
        trendPercent = Math.max(1, Math.min(25, Math.round(score * defaultFactor)));
        trendDirection = "up";
      }

      return {
        score,
        trendPercent,
        trendDirection,
        trendLabel: `${trendDirection === "up" ? "↑" : "↓"} ${trendPercent}%`,
      };
    };

    const skillTrends = {
      speaking: calculateSkillTrend(speakingScore, 0.12),
      listening: calculateSkillTrend(listeningScore, 0.08),
      vocabulary: calculateSkillTrend(vocabularyScore, 0.15),
      isEmpty: isTrendsEmpty,
      emptyMessage: "Your speaking, listening, and grammar progress will appear here after you complete a few lessons.",
    };

    const totalQuestionsDone = (analytics.completedQuestions || []).filter((q) => q.isCorrect).length;
    const totalLessonsDone = (analytics.completedLessons || []).filter((cl) => cl.status === "completed").length;
    const wordsCount = Math.max(totalQuestionsDone * 2, totalLessonsDone * 5);
    const listeningCount = (analytics.completedQuestions || []).length;
    const acedCount = (analytics.completedLessons || []).filter((cl) => (cl.score || 0) >= 80).length;
    const speakingCount = (analytics.completedQuestions || []).filter((cq) => cq.isCorrect).length;

    const achievements = [
      {
        id: "word_collector",
        title: "Word Collector",
        description: "You've learned 50 new words.",
        icon: "https://ki-language-learning.s3.us-east-1.amazonaws.com/uploads/achievements_1790920405817_word_collector.jpg",
        target: 50,
        currentProgress: wordsCount,
        isUnlocked: wordsCount >= 50,
        progressPercent: Math.min(100, Math.round((wordsCount / 50) * 100)),
      },
      {
        id: "listening_champ",
        title: "Listening Champ",
        description: "You completed 10 listening practices.",
        icon: "https://ki-language-learning.s3.us-east-1.amazonaws.com/uploads/achievements_1790920407868_listening_champ.jpg",
        target: 10,
        currentProgress: listeningCount,
        isUnlocked: listeningCount >= 10,
        progressPercent: Math.min(100, Math.round((listeningCount / 10) * 100)),
      },
      {
        id: "quiz_master",
        title: "Quiz Master",
        description: "You aced 5 quizzes in a row.",
        icon: "https://ki-language-learning.s3.us-east-1.amazonaws.com/uploads/achievements_1790920408358_quiz_master.jpg",
        target: 5,
        currentProgress: acedCount,
        isUnlocked: acedCount >= 5,
        progressPercent: Math.min(100, Math.round((acedCount / 5) * 100)),
      },
      {
        id: "fluent_five",
        title: "Fluent Five",
        description: "You passed 5 speaking tests.",
        icon: "https://ki-language-learning.s3.us-east-1.amazonaws.com/uploads/achievements_1790920408867_fluent_five.jpg",
        target: 5,
        currentProgress: speakingCount,
        isUnlocked: speakingCount >= 5,
        progressPercent: Math.min(100, Math.round((speakingCount / 5) * 100)),
      },
    ];

    const isAchievementsEmpty = achievements.every((a) => !a.isUnlocked);

    const completedLessonsData = [];
    const completedLessonsList = (analytics.completedLessons || [])
      .filter((cl) => cl.status === "completed")
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

    for (const cl of completedLessonsList) {
      const targetLessonId = cl.journeyLessonId || cl.lessonId;
      if (!targetLessonId) continue;

      const lesson = await JourneyLessonModel.findById(targetLessonId).populate("journeyTopicId");
      if (lesson) {
        const topic = lesson.journeyTopicId;
        const termsCount = await JourneyQuestionModel.countDocuments({ journeyLessonId: lesson._id, isDeleted: false });

        const completedTime = cl.completedAt ? new Date(cl.completedAt) : new Date();
        const diffHours = Math.floor((now - completedTime) / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHours / 24);
        let completedAgo = "Today";
        if (diffDays === 1) completedAgo = "1 day ago";
        else if (diffDays > 1) completedAgo = `${diffDays} days ago`;
        else if (diffHours > 0) completedAgo = `${diffHours} hours ago`;

        completedLessonsData.push({
          _id: lesson._id,
          title: lesson.title,
          topicTitle: topic ? topic.title : "Topic",
          difficulty: topic ? (topic.category || "Easy") : "Easy",
          termsCount: termsCount || 12,
          subtitle: `${topic?.category || "Easy"} • ${termsCount || 12} terms`,
          image: lesson.image || (topic ? topic.image : "") || "https://ki-language-learning.s3.us-east-1.amazonaws.com/uploads/1787292046787_headphones.png",
          score: cl.score !== undefined ? cl.score : 80,
          scoreText: `${cl.score !== undefined ? cl.score : 80} /100`,
          completedAt: cl.completedAt,
          completedAgo,
          status: "completed",
        });
      }
    }

    const isCompletedLessonsEmpty = completedLessonsData.length === 0;

    const streakTitle =
      streakCount > 0
        ? `Practiced ${streakCount} days in a row!`
        : "Keep the streak alive";

    const streakSubtitle =
      streakCount > 0
        ? `Just ${daysToWeeklyGoal} more days to hit your weekly goal.`
        : "Practice daily to build consistency and confidence";

    return res.status(200).json({
      success: true,
      message: "Insights retrieved successfully",
      result: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl,
          plan: user.plan || "free",
          streakDays: streakCount,
          lastPracticedDate: user.lastPracticedDate,
        },
        streakCard: {
          streakDays: streakCount,
          title: streakTitle,
          subtitle: streakSubtitle,
          weeklyGoal,
          daysPracticedThisWeek,
          daysToWeeklyGoal,
          weekDays,
        },
        monthlyCalendar: {
          monthTitle,
          monthName: monthNames[targetMonth - 1],
          monthNumber: targetMonth,
          year: targetYear,
          totalDaysInMonth,
          daysPracticedInMonth,
          subtitle: streakSubtitle,
          days: monthlyDays,
        },
        skillTrends,
        achievements: {
          list: achievements,
          isEmpty: isAchievementsEmpty,
          emptyMessage: "Complete lessons, practice daily, and hit milestones to earn badges.",
        },
        completedLessons: {
          list: completedLessonsData,
          totalCount: completedLessonsData.length,
          isEmpty: isCompletedLessonsEmpty,
          emptyMessage: "Pick a topic to start your first lesson and track your progress.",
        },
      },
    });
  } catch (error) {
    console.error("Get Insights Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch insights",
      error: error.message,
    });
  }
};

export const recordCompletedLesson = async (req, res) => {
  try {
    const userId = req.user._id;
    const { journeyLessonId, lessonId, status = "completed", score } = req.body;

    const targetLessonId = journeyLessonId || lessonId;

    if (!targetLessonId) {
      return res.status(400).json({ success: false, message: "Journey Lesson ID is required" });
    }

    let analytics = await AnalyticsModel.findOne({ userId });
    if (!analytics) {
      analytics = new AnalyticsModel({ userId });
    }

    if (!analytics.completedLessons) {
      analytics.completedLessons = [];
    }

    let calculatedScore = typeof score === "number" ? score : undefined;

    if (calculatedScore === undefined) {
      const allLessonQuestions = await JourneyQuestionModel.find({
        journeyLessonId: targetLessonId,
        isDeleted: false,
      });

      if (allLessonQuestions.length > 0) {
        let totalScoreSum = 0;
        allLessonQuestions.forEach((q) => {
          const cq = (analytics.completedQuestions || []).find(
            (item) => item.questionId?.toString() === q._id.toString()
          );
          if (cq) {
            totalScoreSum += cq.score || 0;
          }
        });
        calculatedScore = Math.round(totalScoreSum / allLessonQuestions.length);
      } else {
        calculatedScore = 100;
      }
    }

    const existingLesson = analytics.completedLessons.find(
      (cl) => (cl.journeyLessonId || cl.lessonId)?.toString() === targetLessonId.toString()
    );

    if (!existingLesson) {
      analytics.completedLessons.push({
        journeyLessonId: targetLessonId,
        status,
        score: calculatedScore,
        completedAt: new Date(),
      });
    } else {
      existingLesson.status = status;
      existingLesson.score = calculatedScore;
      existingLesson.completedAt = new Date();
    }

    if (status === "completed") {
      await JourneyController.syncTopicCompletion(analytics, targetLessonId);
    }

    analytics.listeningTrendScore = Math.min(
      100,
      Math.round(analytics.listeningTrendScore * 0.9 + calculatedScore * 0.1)
    );
    analytics.vocabularyTrendScore = Math.min(
      100,
      Math.round(analytics.vocabularyTrendScore * 0.92 + 8)
    );

    await analytics.save();
    await recordUserPractice(userId);

    return res.status(200).json({
      success: true,
      message: "Lesson result recorded successfully",
      result: analytics,
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
    await UserSettingsModel.findOneAndDelete({ userId });
    await AnalyticsModel.findOneAndDelete({ userId });
    await ChatSessionModel.deleteMany({ userId });
    await TopicChatModel.deleteMany({ userId });

    return res.status(200).json({
      success: true,
      message: "User account and all related learning history deleted successfully.",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};
