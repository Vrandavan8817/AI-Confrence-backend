import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

const transporter = nodemailer.createTransport({
  service: "gmail", // Gmail shortcut
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // App password
  },
});

transporter.verify((error, success) => {
  if (error) {
    console.error("❌ Email server not ready:", error);
  } else {
    console.log("📧 Email server is ready to send messages");
  }
});

export const sendRegistrationMail = async (email, fullName) => {
  try {
    const mailOptions = {
      from: `"AI Conference" <${process.env.EMAIL_USER}>`,
      to: email,
      replyTo: process.env.EMAIL_USER,
      subject: "Registration Confirmation - AI Conference",
      html: `
        <h2 style="color:#2d6cdf;">Registration Confirmation</h2>
        <p>Dear <strong>${fullName}</strong>,</p>
        <p>Thank you for registering for the <b>AI Conference</b>. 
        Your registration has been successfully submitted.</p>
        <p>We will review your submission and contact you soon with further details.</p>
        <br>
        <p>Best regards,<br>
        <b>AI Conference Team</b></p>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Registration email sent to ${email}`);
  } catch (error) {
    console.error("❌ Error sending email:", error.message);
    throw error;
  }
};
