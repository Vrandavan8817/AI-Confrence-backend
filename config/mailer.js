import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const transporter = nodemailer.createTransport({
  service: "gmail", // 👈 Direct Gmail service use karo
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const sendRegistrationMail = async (to, name) => {
  try {
    await transporter.sendMail({
      from: `"Conference Team" <${process.env.EMAIL_USER}>`,
      to,
      subject: "Registration Successful ✅",
      text: `Hello ${name},\n\nYour registration has been successfully completed!\nWe will contact you soon.\n\nThank you!`,
    });
    console.log("📩 Mail sent successfully");
  } catch (err) {
    console.error("❌ Error sending mail:", err.message);
    throw err;
  }
};
