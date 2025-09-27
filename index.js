import express from "express";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import xss from "xss-clean";
import mongoSanitize from "express-mongo-sanitize";
import bodyParser from "body-parser";
import connectDB from "./config/db.js";

import registerRouter from "./routes/register.js";
import testRouter from "./routes/test.js";

// Load environment variables
dotenv.config();

// Connect to DB
connectDB();

const app = express();

// ================== Middlewares ==================
app.use(helmet()); // Security headers
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(xss()); // Prevent XSS
app.use(mongoSanitize()); // Prevent NoSQL Injection

// ✅ Fix CORS issue
const allowedOrigins = [
  "http://localhost:5173", // Vite React
  "http://localhost:3000", // React CRA (backup)
  "http://127.0.0.1:5173",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);

// Rate limiting
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 mins
    max: 200,
    message: "⚠️ Too many requests, try again later.",
  })
);

// ================== Routes ==================
app.use("/api/register", registerRouter);
app.use("/api/test", testRouter);

app.get("/", (req, res) => res.send("🚀 API is running"));

// ================== Error Handler ==================
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.message);
  res.status(500).json({ error: "Server error" });
});

// ================== Start Server ==================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`✅ Server started on http://localhost:${PORT}`)
);
