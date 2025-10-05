import express from "express";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import xss from "xss-clean";
import mongoSanitize from "express-mongo-sanitize";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

// Routes
import registerRouter from "./routes/register.js";
import testRouter from "./routes/test.js";

// ================== Setup ==================
dotenv.config();
const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ================== Middleware ==================
app.use(helmet());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(xss());
app.use(mongoSanitize());

// ✅ CORS (Frontend: Localhost + Vercel)
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://ai-conference.vercel.app", // ✅ correct spelling
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true,
  })
);

// ✅ Rate Limiting
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: "⚠️ Too many requests, try again later.",
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ================== Database ==================
mongoose
  .connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  });

mongoose.connection.on("error", (err) => {
  console.error("MongoDB error:", err.message);
});

// ================== Routes ==================
app.use("/api/register", registerRouter);
app.use("/api/test", testRouter);

// Root Route
app.get("/", (req, res) => {
  res.send("🚀 Backend is running...");
});

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

// ================== 404 Handler ==================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// ================== Error Handler ==================
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.message);

  // Validation error
  if (err.name === "ValidationError") {
    const messages = Object.values(err.errors).map((val) => val.message);
    return res.status(400).json({
      success: false,
      message: "Validation Error",
      errors: messages,
    });
  }

  // Duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(400).json({
      success: false,
      message: `${field} already exists`,
    });
  }

  // JWT errors
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
  if (err.name === "TokenExpiredError") {
    return res.status(401).json({ success: false, message: "Token expired" });
  }

  // Multer errors
  if (err.name === "MulterError") {
    let message = "File upload error";
    if (err.code === "LIMIT_FILE_SIZE") message = "File too large";
    if (err.code === "LIMIT_UNEXPECTED_FILE") message = "Unexpected file field";
    if (err.code === "LIMIT_FILE_COUNT") message = "Too many files";
    return res.status(400).json({ success: false, message });
  }

  // Default error
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Server error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

// ================== Server ==================
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
});

// Graceful shutdown
process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err.message);
  server.close(() => process.exit(1));
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err.message);
  server.close(() => process.exit(1));
});
