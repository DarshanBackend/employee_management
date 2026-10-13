import nodemailer from "nodemailer";
import { config } from "dotenv";
config();

const emailUser = process.env.EMAIL_USER || "darshan1.kalathiyainfotech@gmail.com";
const emailPass = (process.env.EMAIL_PASS || "nxjt awvf cfmw mhjp").replace(/\s+/g, "");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: emailUser,
    pass: emailPass,
  },
});

const getOtpEmailTemplate = ({ otp, type = "register", name = "" }) => {
  const isRegister = type === "register";
  const title = isRegister ? "Verify your email address" : "Reset your password";
  const greeting = name ? `Hello ${name},` : "Hello,";
  const actionText = isRegister
    ? "Thank you for creating an account with us! To complete your registration and verify your email, please use the 5-digit code below:"
    : "We received a request to reset the password for your account. Please use the 5-digit code below to proceed:";

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f3f4f6; padding: 40px 10px;">
      <tr>
        <td align="center">
          <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);">

            <!-- Header Header -->
            <tr>
              <td style="background: linear-gradient(135deg, #1f4e5b 0%, #0d2830 100%); padding: 32px 24px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 0.5px;">Classroom</h1>
                <p style="color: #e2e8f0; margin: 6px 0 0; font-size: 14px;">Online Education & Learning</p>
              </td>
            </tr>

            <!-- Content Body -->
            <tr>
              <td style="padding: 32px 28px;">
                <h2 style="color: #1e293b; margin: 0 0 16px; font-size: 20px; font-weight: 700;">${title}</h2>
                <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 12px;">${greeting}</p>
                <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
                  ${actionText}
                </p>

                <!-- OTP Code Display -->
                <div style="background-color: #f8fafc; border: 2px dashed #9333ea; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
                  <span style="font-size: 13px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 8px;">Your 5-Digit Verification Code</span>
                  <span style="font-family: 'Courier New', Courier, monospace; font-size: 34px; font-weight: 800; color: #7e22ce; letter-spacing: 10px; display: inline-block;">${otp}</span>
                </div>

                <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 16px 0 0;">
                  ⏰ <strong>Note:</strong> This verification code is valid for <strong>10 minutes</strong>. Do not share this code with anyone.
                </p>

                <p style="color: #94a3b8; font-size: 13px; line-height: 1.5; margin: 12px 0 0;">
                  If you didn't request this code, you can safely ignore this email.
                </p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background-color: #f8fafc; padding: 20px 24px; text-align: center; border-top: 1px solid #e2e8f0;">
                <p style="color: #94a3b8; font-size: 12px; margin: 0;">
                  &copy; ${new Date().getFullYear()} Classroom. All rights reserved.
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;
};

export const sendOtpEmail = async ({ to, otp, type = "register", name = "" }) => {
  const isRegister = type === "register";
  const subject = isRegister
    ? `${otp} is your Classroom email verification code`
    : `${otp} is your Classroom password reset code`;

  const html = getOtpEmailTemplate({ otp, type, name });

  const mailOptions = {
    from: `"Classroom" <${emailUser}>`,
    to,
    subject,
    html,
  };

  return transporter.sendMail(mailOptions);
};

export default transporter;
