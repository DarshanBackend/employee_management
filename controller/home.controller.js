import mongoose from "mongoose";
import UserModel from "../model/user.model.js";
import AttendanceModel from "../model/attendance.model.js";
import LeaveModel from "../model/leave.model.js";
import AttendanceRegularizationModel from "../model/attendanceRegularization.model.js";
import PayrollRunModel from "../model/payrollRun.model.js";
import DocumentModel from "../model/document.model.js";
import DepartmentModel from "../model/department.model.js";
import {
  sendSuccessResponse,
  sendErrorResponse,
} from "../utils/Response.utils.js";

const getNormalizedDateString = (inputDate) => {
  const d = inputDate ? new Date(inputDate) : new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getWeekDays = (period = "last_week") => {
  const now = new Date();
  const currentDay = now.getDay();
  const diffToMonday = (currentDay === 0 ? -6 : 1) - currentDay;

  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() + diffToMonday);
  thisMonday.setHours(0, 0, 0, 0);

  let startMonday;
  if (period === "this_week") {
    startMonday = new Date(thisMonday);
  } else {
    startMonday = new Date(thisMonday);
    startMonday.setDate(thisMonday.getDate() - 7);
  }

  const days = [];
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];

  for (let i = 0; i < 7; i++) {
    const d = new Date(startMonday);
    d.setDate(startMonday.getDate() + i);

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const dateNum = String(d.getDate()).padStart(2, "0");
    const dateStr = `${year}-${month}-${dateNum}`;
    const formatted = `${dateNum} ${monthNames[d.getMonth()]}`;

    days.push({
      day: dayNames[i],
      date: dateStr,
      formattedDate: formatted,
    });
  }

  return days;
};

export class HomeController {
  static async getHomeDashboard(req, res) {
    try {
      const { statsPeriod = "this_month", attendancePeriod = "last_week" } = req.query;

      const todayStr = getNormalizedDateString();
      const now = new Date();

      const hour = now.getHours();
      let greeting = "Good Morning, ☀️";
      if (hour >= 12 && hour < 17) {
        greeting = "Good Afternoon, 👋";
      } else if (hour >= 17) {
        greeting = "Good Evening, 🌙";
      }

      const userName =
        req.user?.name ||
        `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() ||
        "Admin";

      const heroBanner = {
        greeting,
        userName,
        role: req.user?.role || "Admin",
        subtitle: "Manage process payroll and more — all in one place.",
        buttonText: "View Reports",
        buttonAction: "/reports-analytics",
      };

      const totalEmployeesCount = await UserModel.countDocuments({
        role: "employee",
        isUserDeleted: { $ne: true },
        employeeStatus: { $ne: "Terminated" },
      });

      const [todayPresentCount, todayOnLeaveCount] = await Promise.all([
        AttendanceModel.countDocuments({
          date: todayStr,
          status: { $in: ["Present", "Late", "Regularized", "Half Day"] },
        }),
        LeaveModel.countDocuments({
          status: "Approved",
          fromDate: { $lte: todayStr },
          toDate: { $gte: todayStr },
        }),
      ]);

      const todayAbsentCount = Math.max(
        0,
        totalEmployeesCount - todayPresentCount - todayOnLeaveCount
      );

      const activeEmployees = await UserModel.find({
        role: "employee",
        isUserDeleted: { $ne: true },
        employeeStatus: { $ne: "Terminated" },
      }).select("salary salaryDetails");

      const monthlyPayrollSum = activeEmployees.reduce((sum, emp) => {
        const sal = Number(emp.salary || emp.salaryDetails?.basicSalary || 0);
        return sum + (sal > 0 ? sal : 45000);
      }, 0);

      const [latestRun, pendingRun] = await Promise.all([
        PayrollRunModel.findOne({ status: "Completed" }).sort({ createdAt: -1 }),
        PayrollRunModel.findOne({ status: { $in: ["Draft", "Ready"] } }).sort({ createdAt: -1 }),
      ]);

      const totalPayrollAmount = latestRun ? latestRun.netDisbursement : monthlyPayrollSum;
      const pendingSalaryAmount = pendingRun ? pendingRun.netDisbursement : 0;

      const quickStats = [
        {
          key: "total_employees",
          label: "Total Employees",
          value: totalEmployeesCount,
          formattedValue: String(totalEmployeesCount),
          badge: "↑ 0",
          trend: "up",
          icon: "users",
          bgColor: "#ECFDF5",
          color: "#10B981",
        },
        {
          key: "present_today",
          label: "Present Today",
          value: todayPresentCount,
          formattedValue: String(todayPresentCount),
          badge: "↑ 0",
          trend: "up",
          icon: "user-check",
          bgColor: "#EFF6FF",
          color: "#3B82F6",
        },
        {
          key: "absent_today",
          label: "Absent Today",
          value: todayAbsentCount,
          formattedValue: String(todayAbsentCount),
          badge: "↓ 0",
          trend: "down",
          icon: "clock",
          bgColor: "#FFFBEB",
          color: "#F59E0B",
        },
        {
          key: "on_leave",
          label: "On Leave",
          value: todayOnLeaveCount,
          formattedValue: String(todayOnLeaveCount),
          badge: "↑ 0",
          trend: "up",
          icon: "calendar",
          bgColor: "#F5F3FF",
          color: "#8B5CF6",
        },
        {
          key: "total_payroll",
          label: "Total Payroll",
          value: totalPayrollAmount,
          formattedValue: `₹${Number(totalPayrollAmount).toLocaleString("en-IN")}`,
          badge: "↑ 0",
          trend: "up",
          icon: "credit-card",
          bgColor: "#F0FDFA",
          color: "#0D9488",
        },
        {
          key: "pending_salary",
          label: "Pending Salary",
          value: pendingSalaryAmount,
          formattedValue: `₹${Number(pendingSalaryAmount).toLocaleString("en-IN")}`,
          badge: "↑ 0",
          trend: "up",
          icon: "alert-circle",
          bgColor: "#FDF2F8",
          color: "#EC4899",
        },
      ];

      const weekDays = getWeekDays(attendancePeriod);
      const dateList = weekDays.map((w) => w.date);

      const attendanceRecords = await AttendanceModel.find({
        date: { $in: dateList },
      });

      const approvedLeaves = await LeaveModel.find({
        status: "Approved",
        $or: [
          { fromDate: { $in: dateList } },
          { toDate: { $in: dateList } },
          { fromDate: { $lte: dateList[dateList.length - 1] }, toDate: { $gte: dateList[0] } },
        ],
      });

      const attendanceChartData = weekDays.map((w) => {
        const recordsForDay = attendanceRecords.filter((r) => r.date === w.date);
        const presentCount = recordsForDay.filter((r) =>
          ["Present", "Late", "Regularized", "Half Day"].includes(r.status)
        ).length;

        const leaveCount = approvedLeaves.filter(
          (l) => l.fromDate <= w.date && l.toDate >= w.date
        ).length;

        const absentCount = Math.max(0, totalEmployeesCount - presentCount - leaveCount);

        return {
          day: w.day,
          date: w.date,
          formattedDate: w.formattedDate,
          present: presentCount,
          absent: absentCount,
          leave: leaveCount,
        };
      });

      const attendanceOverview = {
        title: "Attendance Overview",
        selectedPeriod: attendancePeriod === "this_week" ? "This Week" : "Last Week",
        periodOptions: ["This Week", "Last Week"],
        legends: [
          { label: "Present", color: "#1F4E5B", key: "present" },
          { label: "Absent", color: "#0284C7", key: "absent" },
          { label: "Leave", color: "#CBD5E1", key: "leave" },
        ],
        chartData: attendanceChartData,
      };

      const [
        pendingLeavesCount,
        pendingAttendanceCount,
        pendingPayrollCount,
        newEmployeesCount,
      ] = await Promise.all([
        LeaveModel.countDocuments({ status: "Pending" }),
        AttendanceRegularizationModel.countDocuments({ status: "Pending" }),
        PayrollRunModel.countDocuments({ status: { $in: ["Draft", "Ready"] } }),
        UserModel.countDocuments({
          role: "employee",
          employeeStatus: { $in: ["Probation", "Inactive"] },
          isUserDeleted: { $ne: true },
        }),
      ]);

      const pendingActions = {
        title: "Pending Actions",
        viewAllText: "View All",
        viewAllUrl: "/pendingActions",
        totalPending:
          pendingLeavesCount +
          pendingAttendanceCount +
          pendingPayrollCount +
          newEmployeesCount,
        items: [
          {
            key: "leave_requests",
            title: "Leave Requests",
            subtitle: "Needs your approval",
            count: pendingLeavesCount,
            icon: "plus",
            color: "#EF4444",
            bgColor: "#FEE2E2",
            targetUrl: "/api/pendingActions?category=leaves",
          },
          {
            key: "attendance_approval",
            title: "Attendance Approval",
            subtitle: "Awaiting review",
            count: pendingAttendanceCount,
            icon: "clock",
            color: "#3B82F6",
            bgColor: "#DBEAFE",
            targetUrl: "/api/pendingActions?category=attendance",
          },
          {
            key: "payroll_approval",
            title: "Payroll Approval",
            subtitle: "Awaiting confirmation",
            count: pendingPayrollCount,
            icon: "file-text",
            color: "#F59E0B",
            bgColor: "#FEF3C7",
            targetUrl: "/api/pendingActions?category=payroll",
          },
          {
            key: "new_employees",
            title: "New Employees",
            subtitle: "Review and activate",
            count: newEmployeesCount,
            icon: "user",
            color: "#8B5CF6",
            bgColor: "#EDE9FE",
            targetUrl: "/api/pendingActions?category=employees",
          },
        ],
      };

      return sendSuccessResponse(res, "Home dashboard data fetched successfully", {
        heroBanner,
        quickStatsPeriod: statsPeriod,
        quickStats,
        attendanceOverview,
        pendingActions,
      });
    } catch (error) {
      console.error("Get Home Dashboard Error:", error);
      return sendErrorResponse(res, 500, "Failed to fetch home dashboard data", error);
    }
  }
}
