import express from "express";
import { sendRegistrationMail } from "../config/mailer.js";

const router = express.Router();

// ✅ Test Mail Route
router.get("/mail", async (req, res) => {
  try {
    const testEmail = req.query.email || "vrandavankushwaha88@gmail.com";
    await sendRegistrationMail(testEmail, "Test User");
    res.json({ message: `📩 Test mail sent to ${testEmail}` });
  } catch (err) {
    console.error("❌ Error sending test mail:", err.message);
    res.status(500).json({ error: "Mail sending failed" });
  }
});

export default router;
