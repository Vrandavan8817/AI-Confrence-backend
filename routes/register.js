import express from "express";
import dotenv from "dotenv";
import { body, validationResult } from "express-validator";
import crypto from "crypto";
import multer from "multer";
import { GridFsStorage } from "multer-gridfs-storage";
import Registration from "../models/Registration.js";
import { sendRegistrationMail } from "../config/mailer.js";

dotenv.config();
const router = express.Router();

// ========== GridFS Storage Setup ==========
let upload;
function initMulter() {
  if (upload) return upload;

  const mongoURI = process.env.MONGO_URI || "";
  if (!mongoURI) {
    console.warn("⚠️ MONGO_URI not found in .env");
    return multer(); // fallback memory storage
  }

  const storage = new GridFsStorage({
    url: mongoURI,
    file: (req, file) =>
      new Promise((resolve, reject) => {
        const allowed = /pdf|doc|docx|png|jpg|jpeg/;
        const ext = file.originalname.split(".").pop().toLowerCase();
        if (!allowed.test(ext)) {
          return reject(new Error("❌ File type not allowed"));
        }

        crypto.randomBytes(16, (err, buf) => {
          if (err) return reject(err);
          const filename = buf.toString("hex") + "-" + file.originalname;
          resolve({
            filename,
            bucketName: "uploads",
            metadata: { uploadedBy: "registration-form" },
          });
        });
      }),
  });

  const MAX_FILE_BYTES = parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024;
  upload = multer({ storage, limits: { fileSize: MAX_FILE_BYTES } });
  return upload;
}

// ========== Validation ==========
const validate = [
  body("fullName").isLength({ min: 3 }).withMessage("Full Name is required"),
  body("gender").notEmpty().withMessage("Gender required"),
  body("dob").notEmpty().withMessage("Date of Birth required"),
  body("nationality").notEmpty(),
  body("mobile").matches(/^[0-9]{10}$/).withMessage("Enter 10 digit mobile"),
  body("email").isEmail().normalizeEmail(),
  body("address").notEmpty(),
  body("institution").notEmpty(),
  body("designation").notEmpty(),
  body("department").notEmpty(),
  body("category").notEmpty(),
  body("fee").isNumeric(),
  body("paymentRef").notEmpty(),
  body("participation").notEmpty(),
  body("submissionTitle").notEmpty(),
  body("authors").notEmpty(),
  body("abstractText").notEmpty(),
  body("declaration").optional(),
];

// ========== POST Route (Registration + File Upload) ==========
router.post(
  "/",
  (req, res, next) => {
    try {
      initMulter().fields([
        { name: "receipt", maxCount: 1 },
        { name: "abstractFile", maxCount: 1 },
      ])(req, res, next);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  },
  validate,
  async (req, res) => {
    try {
      // ✅ Email check
      const existing = await Registration.findOne({ email: req.body.email });
      if (existing) {
        return res.status(400).json({ error: "Email already exists!" });
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const files = req.files || {};
      const receiptFile = files.receipt ? files.receipt[0] : null;
      const abstractFile = files.abstractFile ? files.abstractFile[0] : null;

      // ✅ Safe boolean conversion for declaration
      let declarationValue = false;
      if (
        req.body.declaration === true ||
        req.body.declaration === "true" ||
        req.body.declaration === "on"
      ) {
        declarationValue = true;
      }

      const reg = new Registration({
        ...req.body,
        declaration: declarationValue,
        receiptFileId: receiptFile ? receiptFile.id : undefined,
        abstractFileId: abstractFile ? abstractFile.id : undefined,
      });

      await reg.save();

      // ✅ Send confirmation email
      if (reg.email) {
        await sendRegistrationMail(reg.email, reg.fullName);
      }

      return res.status(201).json({
        message: "✅ Registration saved successfully",
        id: reg._id,
      });
    } catch (err) {
      console.error("❌ Error in registration route:", err);
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "File too large" });
      }
      return res.status(500).json({ error: "Server error" });
    }
  }
);

// ========== GET Route (Fetch All Registrations) ==========
router.get("/", async (req, res) => {
  try {
    const registrations = await Registration.find();
    res.json(registrations);
  } catch (error) {
    console.error("❌ Error fetching registrations:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
