import express from "express";
import dotenv from "dotenv";
import { body, validationResult } from "express-validator";
import crypto from "crypto";
import multer from "multer";
import { GridFSBucket } from "mongodb";
import mongoose from "mongoose";
import Registration from "../models/Registration.js";
import { sendRegistrationMail } from "../config/mailer.js";

dotenv.config();
const router = express.Router();

// ================= GridFS Setup =================
let gfsBucket;
mongoose.connection.once("open", () => {
  gfsBucket = new GridFSBucket(mongoose.connection.db, { bucketName: "uploads" });
  console.log("✅ GridFS bucket initialized");
});

// ================= Multer Setup =================
const storage = multer.memoryStorage();
const MAX_FILE_BYTES = parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024;

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    const allowedExt = /pdf|doc|docx|png|jpg|jpeg/;
    const ext = file.originalname.split(".").pop().toLowerCase();
    if (!allowedExt.test(ext) || !file.mimetype) {
      return cb(new Error("❌ Only PDF/DOC/Image files allowed"));
    }
    cb(null, true);
  },
});

// ================= Helpers =================
const uploadFileToGridFS = (file) =>
  new Promise((resolve, reject) => {
    if (!gfsBucket) return reject(new Error("GridFS not initialized"));

    const filename = crypto.randomBytes(16).toString("hex") + "-" + file.originalname;
    const uploadStream = gfsBucket.openUploadStream(filename, {
      metadata: {
        uploadedBy: "registration-form",
        originalName: file.originalname,
        mimeType: file.mimetype,
      },
    });

    uploadStream.end(file.buffer);

    uploadStream.on("error", reject);
    uploadStream.on("finish", () =>
      resolve({ id: uploadStream.id, filename: uploadStream.filename })
    );
  });

const deleteFileFromGridFS = async (fileId) => {
  if (!gfsBucket || !fileId) return;
  try {
    await gfsBucket.delete(fileId);
    console.log(`✅ File ${fileId} deleted`);
  } catch (err) {
    console.error(`❌ Error deleting file ${fileId}:`, err.message);
  }
};

// ================= Validation =================
const validate = [
  body("fullName").isLength({ min: 3 }).withMessage("Full Name is required"),
  body("gender").notEmpty().withMessage("Gender is required"),
  body("dob").notEmpty().withMessage("Date of birth is required"),
  body("nationality").notEmpty().withMessage("Nationality is required"),
  body("mobile").matches(/^[0-9]{10}$/).withMessage("Mobile must be 10 digits"),
  body("email").isEmail().normalizeEmail().withMessage("Valid email is required"),
  body("address").notEmpty().withMessage("Address is required"),
  body("institution").notEmpty().withMessage("Institution is required"),
  body("designation").notEmpty().withMessage("Designation is required"),
  body("department").notEmpty().withMessage("Department is required"),
  body("category").notEmpty().withMessage("Category is required"),
  body("fee").isNumeric().withMessage("Fee must be a number"),
  body("paymentRef").notEmpty().withMessage("Payment reference is required"),
  body("participation").notEmpty().withMessage("Participation type is required"),
  body("submissionTitle").notEmpty().withMessage("Submission title is required"),
  body("authors").notEmpty().withMessage("Authors are required"),
  body("abstractText").notEmpty().withMessage("Abstract text is required"),
];

// ================= Routes =================

// POST Registration
router.post(
  "/",
  upload.fields([{ name: "receipt", maxCount: 1 }, { name: "abstractFile", maxCount: 1 }]),
  validate,
  async (req, res) => {
    try {
      // Validation
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      // Duplicate email
      if (await Registration.findOne({ email: req.body.email })) {
        return res.status(400).json({ success: false, message: "Email already exists!" });
      }

      // Files
      const receiptFile = req.files?.receipt?.[0];
      const abstractFile = req.files?.abstractFile?.[0];
      if (!receiptFile || !abstractFile) {
        return res.status(400).json({ success: false, message: "Both files required" });
      }

      // Upload files
      const [receiptUpload, abstractUpload] = await Promise.all([
        uploadFileToGridFS(receiptFile),
        uploadFileToGridFS(abstractFile),
      ]);

      const declarationValue = ["true", "on", true, 1, "1"].includes(req.body.declaration);

      const reg = await Registration.create({
        ...req.body,
        declaration: declarationValue,
        receiptFileId: receiptUpload.id,
        receiptFileName: receiptUpload.filename,
        abstractFileId: abstractUpload.id,
        abstractFileName: abstractUpload.filename,
      });

      // Send email (non-blocking)
      if (reg.email) {
        sendRegistrationMail(reg.email, reg.fullName).catch((err) =>
          console.error("❌ Email failed:", err.message)
        );
      }

      res.status(201).json({ success: true, id: reg._id, message: "Registration saved" });
    } catch (err) {
      console.error("❌ Error in registration:", err.message);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// GET All Registrations (Paginated)
router.get("/", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const [registrations, total] = await Promise.all([
      Registration.find().select("fullName email institution category createdAt")
        .sort({ createdAt: -1 }).skip(skip).limit(limit),
      Registration.countDocuments(),
    ]);

    res.json({
      success: true,
      data: registrations,
      pagination: { total, page, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("❌ Fetch error:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET Single Registration
router.get("/:id", async (req, res) => {
  try {
    const reg = await Registration.findById(req.params.id);
    if (!reg) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: reg });
  } catch (err) {
    console.error("❌ Fetch single error:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET File Download
router.get("/file/:id", async (req, res) => {
  try {
    if (!gfsBucket) return res.status(500).json({ success: false, message: "GridFS not ready" });

    const fileId = new mongoose.Types.ObjectId(req.params.id);
    const files = await gfsBucket.find({ _id: fileId }).toArray();
    if (!files.length) return res.status(404).json({ success: false, message: "File not found" });

    const file = files[0];
    res.set("Content-Type", file.metadata.mimeType);
    res.set("Content-Disposition", `attachment; filename="${file.metadata.originalName}"`);

    gfsBucket.openDownloadStream(fileId).pipe(res);
  } catch (err) {
    console.error("❌ File download error:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// DELETE Registration + Files
router.delete("/:id", async (req, res) => {
  try {
    const reg = await Registration.findById(req.params.id);
    if (!reg) return res.status(404).json({ success: false, message: "Not found" });

    await Promise.all([
      deleteFileFromGridFS(reg.receiptFileId),
      deleteFileFromGridFS(reg.abstractFileId),
    ]);

    await Registration.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Registration deleted" });
  } catch (err) {
    console.error("❌ Delete error:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
