import UserModel from "../model/user.model.js";
import { sendOtpEmail } from "../utils/Email.config.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

const validatePasswordStrength = (password) => {
  if (!password || typeof password !== "string") {
    return { isValid: false, message: "Password is required" };
  }
  if (password.length < 8) {
    return { isValid: false, message: "Password must be at least 8 characters long" };
  }
  if (!/[0-9]/.test(password)) {
    return { isValid: false, message: "Password must contain at least one number" };
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return { isValid: false, message: "Password must contain at least one symbol" };
  }
  return { isValid: true };
};

export class AuthController {
  static saltRounds = 10;
  static JWT_SECRET = process.env.JWT_SECRET || "floma_access_token_secret";

  static async sendRegisterOtp(req, res) {
    try {
      const { email } = req.body;

      if (!email || !email.trim()) {
        return res.status(400).json({
          success: false,
          message: "Email is required!",
        });
      }

      const cleanEmail = email.toLowerCase().trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail)) {
        return res.status(400).json({
          success: false,
          message: "Please enter a valid email address!",
        });
      }

      let user = await UserModel.findOne({ email: cleanEmail }).select("+password +otp");
      if (user && user.password && !user.isUserDeleted) {
        return res.status(409).json({
          success: false,
          message: "Email is already registered. Please login.",
        });
      }

      const OTP = Math.floor(10000 + Math.random() * 90000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      if (user) {
        user.otp = {
          code: OTP,
          expiresAt,
          isVerified: false,
          type: "register",
        };
        await user.save();
      } else {
        user = await UserModel.create({
          email: cleanEmail,
          otp: {
            code: OTP,
            expiresAt,
            isVerified: false,
            type: "register",
          },
        });
      }

      try {
        await sendOtpEmail({
          to: cleanEmail,
          otp: OTP,
          type: "register",
          name: user.name,
        });
      } catch (mailError) {
        console.error("Mail Delivery Error:", mailError.message);
      }

      return res.status(200).json({
        success: true,
        message: `We just sent a 5-digit code to ${cleanEmail}. Please check your inbox.`,
        result: {
          email: cleanEmail,
          expiresInMinutes: 10,
        },
      });
    } catch (error) {
      console.error("Send Register OTP Error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Failed to send registration OTP email.",
        error: error.message,
      });
    }
  }

  static async verifyRegisterOtp(req, res) {
    try {
      const { email, otp } = req.body;

      if (!email || !otp) {
        return res.status(400).json({
          success: false,
          message: "Email and 5-digit OTP are required!",
        });
      }

      const cleanEmail = email.toLowerCase().trim();
      const otpStr = otp.toString().trim();

      const user = await UserModel.findOne({ email: cleanEmail }).select("+otp");
      if (!user || !user.otp || !user.otp.code || user.otp.type !== "register") {
        return res.status(400).json({
          success: false,
          message: "No OTP request found for this email. Please request a new code.",
        });
      }

      if (new Date(user.otp.expiresAt) <= new Date()) {
        return res.status(400).json({
          success: false,
          message: "OTP has expired. Please request a new code.",
        });
      }

      if (user.otp.code !== otpStr) {
        return res.status(400).json({
          success: false,
          message: "Invalid 5-digit code. Please enter the correct code.",
        });
      }

      user.otp.code = null;
      user.otp.expiresAt = null;
      user.otp.isVerified = true;
      user.isEmailVerified = true;
      await user.save();

      return res.status(200).json({
        success: true,
        message: "Email verified successfully! You can now create your password.",
        result: {
          email: cleanEmail,
          isVerified: true,
        },
      });
    } catch (error) {
      console.error("Verify Register OTP Error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Failed to verify registration OTP.",
        error: error.message,
      });
    }
  }

  static async createPassword(req, res) {
    try {
      const { email, password, role = "employee", bypassOtp = false } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: "Email and password are required!",
        });
      }

      const cleanEmail = email.toLowerCase().trim();

      const passwordValidation = validatePasswordStrength(password);
      if (!passwordValidation.isValid) {
        return res.status(400).json({
          success: false,
          message: passwordValidation.message,
        });
      }

      let user = await UserModel.findOne({ email: cleanEmail }).select("+password +otp");

      if (user && user.password && !user.isUserDeleted) {
        return res.status(409).json({
          success: false,
          message: "Email is already registered. Please login.",
        });
      }

      if (!bypassOtp) {
        if (!user || (!user.isEmailVerified && !user.otp?.isVerified)) {
          return res.status(400).json({
            success: false,
            message: "Please verify your email with the 5-digit OTP before creating your account.",
          });
        }
      }

      const finalRole = String(role).toLowerCase().trim() === "admin" ? "admin" : "employee";

      const prefix = cleanEmail.split("@")[0];
      const finalName = prefix
        .split(/[._-]/)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(" ");

      const hashedPassword = await bcrypt.hash(password, AuthController.saltRounds);
      const formattedName = encodeURIComponent(finalName);
      const avatarUrl = `https://ui-avatars.com/api/?name=${formattedName}&background=7C3AED&color=fff&size=128`;

      if (user) {
        user.name = finalName;
        user.password = hashedPassword;
        user.avatarUrl = avatarUrl;
        user.role = finalRole;
        user.isEmailVerified = true;
        user.otp = {
          code: null,
          expiresAt: null,
          isVerified: false,
          type: null,
        };
        await user.save();
      } else {
        user = await UserModel.create({
          name: finalName,
          email: cleanEmail,
          password: hashedPassword,
          avatarUrl,
          role: finalRole,
          isEmailVerified: true,
          otp: {
            code: null,
            expiresAt: null,
            isVerified: false,
            type: null,
          },
        });
      }

      const token = jwt.sign(
        {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          tokenVersion: user.tokenVersion || 0,
        },
        AuthController.JWT_SECRET,
        { expiresIn: "7d" }
      );

      return res.status(201).json({
        success: true,
        message: `${finalRole.toUpperCase()} account successfully created!`,
        result: {
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            avatarUrl: user.avatarUrl,
            role: user.role,
            isEmailVerified: user.isEmailVerified,
            phone: user.phone,
          },
          token,
        },
      });
    } catch (error) {
      console.error("Registration Error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Failed to register user",
        error: error.message,
      });
    }
  }

  static async login(req, res) {
    try {
      const { email, username, emailOrUsername, password } = req.body;
      const identifier = emailOrUsername || email || username;

      if (!identifier || !password) {
        return res.status(400).json({
          success: false,
          message: "Email and password are required!",
        });
      }

      const cleanIdentifier = identifier.trim();

      const user = await UserModel.findOne({
        $or: [
          { email: cleanIdentifier.toLowerCase() },
          { name: new RegExp(`^${cleanIdentifier}$`, "i") },
        ],
      }).select("+password");

      if (!user || !user.password) {
        return res.status(401).json({
          success: false,
          code: "INVALID_CREDENTIALS",
          message: "Oops! Email or password incorrect try another one.",
        });
      }

      if (user.isUserDeleted) {
        return res.status(403).json({
          success: false,
          message: "This account has been deleted.",
        });
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          code: "INVALID_CREDENTIALS",
          message: "Oops! Email or password incorrect try another one.",
        });
      }

      const token = jwt.sign(
        {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          tokenVersion: user.tokenVersion || 0,
        },
        AuthController.JWT_SECRET,
        { expiresIn: "7d" }
      );

      return res.status(200).json({
        success: true,
        message: "Login successful",
        result: {
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            avatarUrl: user.avatarUrl,
            role: user.role,
            isEmailVerified: user.isEmailVerified,
            phone: user.phone,
          },
          token,
        },
      });
    } catch (error) {
      console.error("Login Error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Failed to log in",
        error: error.message,
      });
    }
  }

  static async sendForgotMailOtp(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email is required!",
        });
      }

      const cleanEmail = email.toLowerCase().trim();
      const user = await UserModel.findOne({ email: cleanEmail }).select("+otp");
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "No user found with this email.",
        });
      }

      const OTP = Math.floor(10000 + Math.random() * 90000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      user.otp = {
        code: OTP,
        expiresAt,
        isVerified: false,
        type: "forgot_password",
      };
      await user.save({ validateModifiedOnly: true });

      try {
        await sendOtpEmail({
          to: cleanEmail,
          otp: OTP,
          type: "forgot_password",
          name: user.name,
        });
      } catch (mailErr) {
        console.error("Forgot OTP Mail Error:", mailErr.message);
      }

      return res.status(200).json({
        success: true,
        message: `Password reset 5-digit code sent to ${cleanEmail}.`,
        result: { email: cleanEmail },
      });
    } catch (error) {
      console.error("Forgot Password OTP Error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Failed to send reset email OTP.",
        error: error.message,
      });
    }
  }

  static async verifyForgetOtp(req, res) {
    try {
      const { email, otp } = req.body;

      if (!email || !otp) {
        return res.status(400).json({
          success: false,
          message: "Email and OTP are required!",
        });
      }

      const cleanEmail = email.toLowerCase().trim();
      const otpStr = otp.toString().trim();

      const user = await UserModel.findOne({ email: cleanEmail }).select("+otp");
      if (!user || !user.otp || !user.otp.code || user.otp.type !== "forgot_password") {
        return res.status(400).json({
          success: false,
          message: "No OTP request found for this email. Request a new one.",
        });
      }

      if (new Date(user.otp.expiresAt) <= new Date()) {
        return res.status(400).json({
          success: false,
          message: "OTP has expired. Please request a new code.",
        });
      }

      if (user.otp.code !== otpStr) {
        return res.status(400).json({
          success: false,
          message: "Invalid OTP code.",
        });
      }

      user.otp.code = null;
      user.otp.expiresAt = null;
      user.otp.isVerified = true;
      await user.save({ validateModifiedOnly: true });

      return res.status(200).json({
        success: true,
        message: "OTP verified successfully. You can now reset your password.",
        result: { email: cleanEmail, isVerified: true },
      });
    } catch (error) {
      console.error("Verify OTP Error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Failed to verify OTP",
        error: error.message,
      });
    }
  }

  static async resetPassword(req, res) {
    try {
      const { email, newPassword } = req.body;

      if (!email || !newPassword) {
        return res.status(400).json({
          success: false,
          message: "Email and new password are required!",
        });
      }

      const cleanEmail = email.toLowerCase().trim();

      const passwordValidation = validatePasswordStrength(newPassword);
      if (!passwordValidation.isValid) {
        return res.status(400).json({
          success: false,
          message: passwordValidation.message,
        });
      }

      const user = await UserModel.findOne({ email: cleanEmail }).select("+otp");
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found.",
        });
      }

      if (!user.otp?.isVerified || user.otp?.type !== "forgot_password") {
        return res.status(403).json({
          success: false,
          message: "Access Denied. Please verify the OTP first.",
        });
      }

      user.password = await bcrypt.hash(newPassword, AuthController.saltRounds);
      user.otp = {
        code: null,
        expiresAt: null,
        isVerified: false,
        type: null,
      };
      await user.save({ validateModifiedOnly: true });

      return res.status(200).json({
        success: true,
        message: "Password reset successful. Please login with your new password.",
      });
    } catch (error) {
      console.error("Reset Password Error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Failed to reset password",
        error: error.message,
      });
    }
  }

  static async changePassword(req, res) {
    try {
      const { oldPassword, newPassword } = req.body;
      const userId = req.user._id;

      if (!oldPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: "Old password and new password are required!",
        });
      }

      const passwordValidation = validatePasswordStrength(newPassword);
      if (!passwordValidation.isValid) {
        return res.status(400).json({
          success: false,
          message: passwordValidation.message,
        });
      }

      const user = await UserModel.findById(userId).select("+password");
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const isPasswordValid = await bcrypt.compare(oldPassword, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          code: "INVALID_OLD_PASSWORD",
          message: "Invalid old password!",
        });
      }

      user.password = await bcrypt.hash(newPassword, AuthController.saltRounds);
      await user.save();

      return res.status(200).json({
        success: true,
        message: "Password changed successfully.",
      });
    } catch (error) {
      console.error("Change Password Error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Failed to change password",
        error: error.message,
      });
    }
  }

  static async getUser(req, res) {
    try {
      const id = req.user._id;
      const user = await UserModel.findById(id).select("-password -otp");

      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      return res.status(200).json({
        success: true,
        message: "User profile fetched successfully",
        result: user,
      });
    } catch (error) {
      console.error("Get User Error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Error fetching user data",
        error: error.message,
      });
    }
  }

  static async logout(req, res) {
    try {
      const userId = req.user?._id;

      if (userId) {
        await UserModel.findByIdAndUpdate(userId, {
          $inc: { tokenVersion: 1 },
          fcmToken: null,
          lastLogoutAt: new Date(),
        });
      }

      return res.status(200).json({
        success: true,
        message: "Logged out successfully",
      });
    } catch (error) {
      console.error("Logout Error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Error logging out",
        error: error.message,
      });
    }
  }

  static async updateFcmToken(req, res) {
    try {
      const userId = req.user._id;
      const { fcmToken } = req.body;

      if (!fcmToken) {
        return res.status(400).json({
          success: false,
          message: "fcmToken is required!",
        });
      }

      const user = await UserModel.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found!",
        });
      }

      user.fcmToken = fcmToken;
      await user.save();

      return res.status(200).json({
        success: true,
        message: "FCM Token updated successfully",
      });
    } catch (error) {
      console.error("Update FCM Token Error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Error updating FCM Token",
        error: error.message,
      });
    }
  }
}
