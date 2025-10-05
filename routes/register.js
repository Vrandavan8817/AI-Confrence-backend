import express from "express";
import dotenv from "dotenv";
import { body, validationResult } from "express-validator";
import crypto from "crypto";
import { GridFSBucket, ObjectId } from "mongodb";
import mongoose from "mongoose";
import { GridFsStorage } from "multer-gridfs-storage";
import multer from "multer";
import Registration from "../models/Registration.js";
import { sendRegistrationMail } from "../config/mailer.js";

dotenv.config();
const router = express.Router();

// ================= GridFS Setup =================
let gfsBuckets = {};
mongoose.connection.once("open", () => {
  gfsBuckets.receipts = new GridFSBucket(mongoose.connection.db, { bucketName: "receipts" });
  gfsBuckets.abstracts = new GridFSBucket(mongoose.connection.db, { bucketName: "abstracts" });
  console.log("✅ GridFS buckets initialized: receipts, abstracts");
});

// ================= Multer GridFS Storage =================
const ALLOWED_EXTENSIONS = ["pdf", "doc", "docx", "png", "jpg", "jpeg"];

// Ensure storages are created after mongoose connects and reuse the same DB connection
let receiptStorage;
let abstractStorage;

const createStorageUsingDb = (bucketName, db) =>
  new GridFsStorage({
    // DO NOT pass url here — reuse existing mongoose db to avoid new connections per upload
    db,
    file: async (req, file) => {
      try {
        console.log(`🔔 GridFsStorage.file called for bucket=${bucketName} originalname=${file.originalname}`);
        const ext = file.originalname.split(".").pop().toLowerCase();
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
          console.log("⚠️ Rejected extension:", ext);
          return null;
        }
        const filename = `${crypto.randomBytes(16).toString("hex")}-${file.originalname}`;
        return { filename, bucketName, metadata: { originalName: file.originalname, mimeType: file.mimetype } };
      } catch (err) {
        console.error("❌ GridFsStorage.file error:", err);
        throw err;
      }
    },
  });

// create storages when mongoose connection opens (reuse db)
mongoose.connection.once("open", () => {
  console.log("mongoose open - creating GridFS storages");
  receiptStorage = createStorageUsingDb("receipts", mongoose.connection.db);
  abstractStorage = createStorageUsingDb("abstracts", mongoose.connection.db);

  // If you used GridFSBucket earlier:
  gfsBuckets.receipts = new GridFSBucket(mongoose.connection.db, { bucketName: "receipts" });
  gfsBuckets.abstracts = new GridFSBucket(mongoose.connection.db, { bucketName: "abstracts" });
  console.log("✅ GridFS buckets and storages initialized");
});

// Multer instances for each file field
const receiptUpload = multer({
  storage: receiptStorage,
  limits: { fileSize: 1 * 1024 * 1024 }, // 1MB
  fileFilter: (req, file, cb) => {
    const ext = file.originalname.split(".").pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) return cb(new Error("Invalid file type"), false);
    cb(null, true);
  },
}).single("receipt");

const abstractUpload = multer({
  storage: abstractStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const ext = file.originalname.split(".").pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) return cb(new Error("Invalid file type"), false);
    cb(null, true);
  },
}).single("abstractFile");

// ================= Async uploadBoth Middleware =================
const MAX_UPLOAD_TIME = 30000; // 30 seconds per file
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

// Reliable file upload with timeout
async function uploadWithTimeout(uploadFn, req, res, fieldName) {
  return new Promise((resolve, reject) => {
    let uploadFinished = false;
    
    // Set upload timeout
    const timer = setTimeout(() => {
      if (!uploadFinished) {
        uploadFinished = true;
        reject(new Error(`Upload timeout for ${fieldName}`));
      }
    }, MAX_UPLOAD_TIME);

    try {
      uploadFn(req, res, (err) => {
        if (uploadFinished) return; // Already timed out
        uploadFinished = true;
        clearTimeout(timer);

        if (err) {
          console.error(`❌ ${fieldName} upload error:`, err);
          reject(err);
        } else {
          console.log(`✅ ${fieldName} uploaded:`, req.file?.filename);
          resolve(req.file);
        }
      });
    } catch (err) {
      if (!uploadFinished) {
        uploadFinished = true;
        clearTimeout(timer);
        reject(err);
      }
    }
  });
}

// Combined upload middleware
async function uploadBoth(req, res, next) {
  console.log("⏳ Starting file uploads...");
  
  try {
    // Upload receipt
    const receiptFile = await uploadWithTimeout(receiptUpload, req, res, "receipt");
    console.log("✅ Receipt uploaded");

    // Clear multer state before next upload
    req.file = undefined;
    
    // Upload abstract
    const abstractFile = await uploadWithTimeout(abstractUpload, req, res, "abstractFile");
    console.log("✅ Abstract uploaded");

    // Normalize files object
    req.files = {
      receipt: receiptFile ? [receiptFile] : [],
      abstractFile: abstractFile ? [abstractFile] : []
    };

    console.log("✅ All files uploaded successfully");
    next();
  } catch (err) {
    console.error("❌ Upload failed:", err.message);
    next(err);
  }
}

// ================= Validation =================
const validate = [
  body("fullName").isLength({ min: 3 }).withMessage("Full Name required"),
  body("gender").notEmpty().withMessage("Gender required"),
  body("dob").notEmpty().withMessage("DOB required"),
  body("nationality").notEmpty().withMessage("Nationality required"),
  body("mobile").matches(/^[0-9]{10}$/).withMessage("Mobile must be 10 digits"),
  body("email").isEmail().normalizeEmail().withMessage("Valid email required"),
  body("address").notEmpty().withMessage("Address required"),
  body("institution").notEmpty().withMessage("Institution required"),
  body("designation").notEmpty().withMessage("Designation required"),
  body("department").notEmpty().withMessage("Department required"),
  body("category").notEmpty().withMessage("Category required"),
  body("fee").isNumeric().withMessage("Fee must be number"),
  body("paymentRef").notEmpty().withMessage("Payment reference required"),
  body("participation").notEmpty().withMessage("Participation required"),
  body("submissionTitle").notEmpty().withMessage("Submission title required"),
  body("authors").notEmpty().withMessage("Authors required"),
  body("abstractText").notEmpty().withMessage("Abstract required"),
];

// ================= Routes =================

// POST Registration
router.post(
  "/",
  (req, res, next) => {
    console.log("==== POST /api/register START ====");
    console.log("Headers:", req.headers);
    next();
  },
  uploadBoth, // Use the new async upload middleware
  validate,
  async (req, res) => {
    try {
      console.log("==== Validation passed, processing files ====");
      console.log("Files received:", {
        receipt: req.files?.receipt?.[0]?.filename,
        abstractFile: req.files?.abstractFile?.[0]?.filename
      });

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      // Check for duplicate email
      const existing = await Registration.findOne({ email: req.body.email });
      if (existing) {
        return res.status(400).json({ success: false, message: "Email already exists!" });
      }

      const receiptFile = req.files.receipt[0];
      const abstractFile = req.files.abstractFile[0];
      const declarationValue = ["true", "on", true, 1, "1"].includes(req.body.declaration);

      // Save registration in DB
      const reg = await Registration.create({
        ...req.body,
        declaration: declarationValue,
        receiptFileId: receiptFile.id,
        receiptFileName: receiptFile.filename,
        abstractFileId: abstractFile.id,
        abstractFileName: abstractFile.filename,
      });

      res.status(201).json({ success: true, id: reg._id, message: "Registration successful" });

      // Send email asynchronously
      if (reg.email) {
        sendRegistrationMail(reg.email, reg.fullName)
          .then(() => console.log(`✅ Email sent to ${reg.email}`))
          .catch((err) => console.error("❌ Email failed:", err.message));
      }
    } catch (err) {
      console.error("❌ Registration failed:", err);
      res.status(500).json({ 
        success: false, 
        message: err.message || "Server error",
        code: err.code
      });
    }
  }
);

// POST Test Route
router.post("/test", express.json(), (req, res) => {
  console.log("POST /api/register/test hit");
  res.json({ success: true, message: "Test route working" });
});

// GET All Registrations (paginated)
router.get("/", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const [registrations, total] = await Promise.all([
      Registration.find()
        .select("fullName email institution category createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Registration.countDocuments(),
    ]);

    res.json({
      success: true,
      data: registrations,
      pagination: { total, page, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("❌ Fetch registrations error:", err);
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
    console.error("❌ Fetch registration error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET File Download
router.get("/file/:id", async (req, res) => {
  try {
    const fileId = new ObjectId(req.params.id);

    let fileBucket;
    const fileMeta = await gfsBuckets.receipts.find({ _id: fileId }).toArray();
    fileBucket = fileMeta.length ? gfsBuckets.receipts : gfsBuckets.abstracts;

    const files = await fileBucket.find({ _id: fileId }).toArray();
    if (!files.length) return res.status(404).json({ success: false, message: "File not found" });

    const file = files[0];
    res.set("Content-Type", file.metadata.mimeType);
    res.set("Content-Disposition", `attachment; filename="${file.metadata.originalName}"`);
    fileBucket.openDownloadStream(fileId).pipe(res);
  } catch (err) {
    console.error("❌ File download error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// DELETE Registration + Files
router.delete("/:id", async (req, res) => {
  try {
    const reg = await Registration.findById(req.params.id);
    if (!reg) return res.status(404).json({ success: false, message: "Not found" });

    if (reg.receiptFileId) await gfsBuckets.receipts.delete(new ObjectId(reg.receiptFileId));
    if (reg.abstractFileId) await gfsBuckets.abstracts.delete(new ObjectId(reg.abstractFileId));

    await Registration.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Registration deleted" });
  } catch (err) {
    console.error("❌ Delete registration error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Multer error handler (add after all routes)
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // Multer-specific errors
    return res.status(400).json({ success: false, message: err.message });
  } else if (err) {
    // Other errors
    return res.status(500).json({ success: false, message: err.message });
  }
  next();
});

// Add this debug middleware before your route
const debugLog = (req, res, next) => {
  console.log(`\n==== ${new Date().toISOString()} ====`);
  console.log("🔍 Headers:", JSON.stringify(req.headers, null, 2));
  console.log("📦 Content Length:", req.headers['content-length']);
  next();
};

// Update your route
router.post("/", debugLog, async (req, res, next) => {
  console.log("📥 Request received");
  
  try {
    // First handle file uploads
    await new Promise((resolve, reject) => {
      uploadBoth(req, res, (err) => {
        if (err) {
          console.error("❌ Upload error:", err);
          reject(err);
        } else {
          console.log("✅ Files uploaded successfully");
          resolve();
        }
      });
    });

    console.log("📄 Files received:", {
      receipt: req.files?.receipt?.[0]?.filename,
      abstractFile: req.files?.abstractFile?.[0]?.filename
    });

    // Continue with validation
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log("❌ Validation errors:", errors.array());
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    // Check for duplicate email
    const existing = await Registration.findOne({ email: req.body.email });
    if (existing) {
      return res.status(400).json({ success: false, message: "Email already exists!" });
    }

    const receiptFile = req.files.receipt[0];
    const abstractFile = req.files.abstractFile[0];
    const declarationValue = ["true", "on", true, 1, "1"].includes(req.body.declaration);

    // Save registration in DB
    const reg = await Registration.create({
      ...req.body,
      declaration: declarationValue,
      receiptFileId: receiptFile.id,
      receiptFileName: receiptFile.filename,
      abstractFileId: abstractFile.id,
      abstractFileName: abstractFile.filename,
    });

    res.status(201).json({ success: true, id: reg._id, message: "Registration successful" });

    // Send email asynchronously
    if (reg.email) {
      sendRegistrationMail(reg.email, reg.fullName)
        .then(() => console.log(`✅ Email sent to ${reg.email}`))
        .catch((err) => console.error("❌ Email failed:", err.message));
    }
  } catch (err) {
    console.error("❌ Processing error:", {
      name: err.name,
      message: err.message,
      stack: err.stack
    });
    next(err);
  }
});

// memory-upload test route (no GridFS)
const memUpload = multer({ storage: multer.memoryStorage() }).single("receipt");
router.post("/test-no-gridfs", (req, res) => {
  memUpload(req, res, async (err) => {
    console.log("🔍 /test-no-gridfs called, file present:", !!req.file, "body keys:", Object.keys(req.body));
    if (err) return res.status(400).json({ success: false, message: err.message });
    try {
      const reg = await Registration.create({ ...req.body, note: "test-no-gridfs" });
      console.log("✅ DB save OK, id:", reg._id);
      res.json({ success: true, id: reg._id });
    } catch (dbErr) {
      console.error("❌ DB save error:", dbErr);
      res.status(500).json({ success: false, message: dbErr.message });
    }
  });
});

// Error handler (add after routes)
router.use((err, req, res, next) => {
  console.error("❌ Route error:", err);
  
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({
      success: false,
      message: `File too large. Max size: ${MAX_FILE_SIZE/1024/1024}MB`
    });
  }
  
  if (err.code === "UPLOAD_TIMEOUT") {
    return res.status(408).json({
      success: false,
      message: "Upload timed out. Please try again."
    });
  }

  res.status(500).json({
    success: false,
    message: err.message || "Server error",
    code: err.code
  });
});

export default router;
