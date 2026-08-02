const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

const logEmailError = (tag, err) => {
  if (process.env.NODE_ENV === "production") {
    console.error(tag, { name: err && err.name, message: err && err.message });
  } else {
    console.error(tag, err);
  }
};

async function sendEmail({ toEmail, subject, html }) {
  const response = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: process.env.EMAIL_FROM_NAME,
        email: process.env.EMAIL_FROM_ADDRESS,
      },
      to: [{ email: toEmail }],
      subject,
      htmlContent: html,
    }),
  });

  console.log("[email] Sending via Brevo:", { toEmail, subject, from: process.env.EMAIL_FROM_ADDRESS });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Brevo API error: ${response.status} ${errorText}`);
  }

  console.log("[email] Brevo send succeeded:", { toEmail, status: response.status });
}

async function sendPasswordResetEmail(toEmail, resetLink) {
  try {
    await sendEmail({
      toEmail,
      subject: "Reset your DocTalk password",
      html: `
        <p>You requested a password reset for your DocTalk account.</p>
        <p><a href="${resetLink}">Click here to reset your password</a></p>
        <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>
      `,
    });
  } catch (err) {
    logEmailError("[email] Brevo error (password reset):", err);
    throw new Error("Failed to send password reset email");
  }
}

async function sendPasswordChangeConfirmation(toEmail, confirmLink) {
  try {
    await sendEmail({
      toEmail,
      subject: "Confirm your password change for DocTalk",
      html: `
        <p>You requested to change your DocTalk account password.</p>
        <p><a href="${confirmLink}">Click here to confirm your new password</a></p>
        <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>
      `,
    });
  } catch (err) {
    logEmailError("[email] Brevo error (password change):", err);
    throw new Error("Failed to send password change confirmation email");
  }
}

module.exports = { sendPasswordResetEmail, sendPasswordChangeConfirmation };
