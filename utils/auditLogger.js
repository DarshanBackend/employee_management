import AuditLogModel from "../model/auditLog.model.js";

export const formatAuditDate = (date) => {
  if (!date) return "";
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, "0");
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const month = monthNames[d.getMonth()];
  const year = d.getFullYear();

  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12;
  const formattedHours = String(hours).padStart(2, "0");

  return `${day} ${month} ${year}, ${formattedHours}:${minutes} ${ampm}`;
};

export const generateAuditCode = async () => {
  try {
    const lastLog = await AuditLogModel.findOne({ auditCode: /^AUD-\d+$/ })
      .sort({ createdAt: -1 })
      .lean();

    let nextNum = 8801;
    if (lastLog && lastLog.auditCode) {
      const match = lastLog.auditCode.match(/AUD-(\d+)/);
      if (match && match[1]) {
        const parsed = parseInt(match[1], 10);
        if (!isNaN(parsed) && parsed >= 8801) {
          nextNum = parsed + 1;
        }
      }
    }

    while (await AuditLogModel.exists({ auditCode: `AUD-${nextNum}` })) {
      nextNum++;
    }

    return `AUD-${nextNum}`;
  } catch (err) {
    return `AUD-${Date.now().toString().slice(-4)}`;
  }
};

export const getClientIp = (req) => {
  if (!req) return "127.0.0.1";
  const forwarded = req.headers ? (req.headers["x-forwarded-for"] || "") : "";
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || "127.0.0.1";
};

export const recordAuditLog = async (req, {
  action,
  category = "Security",
  description = "",
  targetResource = "",
  diff = { before: "", after: "" },
  badgeColor,
  icon = "clock",
  actorName,
  actorRole,
  eventDate,
}) => {
  try {
    if (!action || !String(action).trim()) return null;

    const auditCode = await generateAuditCode();

    const resolvedName = (
      actorName ||
      req?.user?.name ||
      [req?.user?.firstName, req?.user?.lastName].filter(Boolean).join(" ") ||
      "System Admin"
    ).trim();

    const resolvedRole = (
      actorRole ||
      req?.user?.roleTitle ||
      (req?.user?.role === "admin" ? "Super Admin" : req?.user?.role || "User")
    ).trim();

    const clientIp = getClientIp(req);

    let color = badgeColor;
    if (!color) {
      switch (category) {
        case "Payroll":
          color = "#10B981";
          break;
        case "Leave":
          color = "#3B82F6";
          break;
        case "Employees":
          color = "#0D9488";
          break;
        case "Security":
        default:
          color = "#EF4444";
          break;
      }
    }

    const newLog = await AuditLogModel.create({
      auditCode,
      action: action.trim(),
      actorName: resolvedName,
      actorRole: resolvedRole,
      actor: req?.user?._id || null,
      category: ["Employees", "Payroll", "Leave", "Security"].includes(category) ? category : "Security",
      description: String(description || "").trim(),
      targetResource: String(targetResource || "").trim(),
      ipAddress: clientIp,
      diff: {
        before: String(diff?.before || "").trim(),
        after: String(diff?.after || "").trim(),
      },
      badgeColor: color,
      icon: icon || "clock",
      eventDate: eventDate ? new Date(eventDate) : new Date(),
    });

    return newLog;
  } catch (error) {
    console.error("Dynamic Audit Log Recording Warning:", error.message);
    return null;
  }
};
