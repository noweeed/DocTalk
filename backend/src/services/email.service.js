const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  family: 4, // force IPv4 — Render (and similar PaaS) don't support outbound IPv6, causing ESOCKET on the default IPv6-preferring DNS resolution
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

const FROM = '"DocTalk" <doctalk.service@gmail.com>';

const logEmailError = (tag, err) => {
  if (process.env.NODE_ENV === "production") {
    console.error(tag, { name: err && err.name, code: err && err.code });
  } else {
    console.error(tag, err);
  }
};

async function sendPasswordResetEmail(toEmail, resetLink) {
  try {
    await transporter.sendMail({
      from: FROM,
      to: toEmail,
      subject: "Reset your DocTalk password",
      html: `
        <p>You requested a password reset for your DocTalk account.</p>
        <p><a href="${resetLink}">Click here to reset your password</a></p>
        <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>
      `,
    });
  } catch (err) {
    logEmailError("[email] Nodemailer error (password reset):", err);
    throw new Error("Failed to send password reset email");
  }
}

async function sendPasswordChangeConfirmation(toEmail, confirmLink) {
  try {
    await transporter.sendMail({
      from: FROM,
      to: toEmail,
      subject: "Confirm your password change for DocTalk",
      html: `
        <p>You requested to change your DocTalk account password.</p>
        <p><a href="${confirmLink}">Click here to confirm your new password</a></p>
        <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>
      `,
    });
  } catch (err) {
    logEmailError("[email] Nodemailer error (password change):", err);
    throw new Error("Failed to send password change confirmation email");
  }
}

module.exports = { sendPasswordResetEmail, sendPasswordChangeConfirmation };
