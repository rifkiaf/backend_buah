// Load environment variables
require("dotenv").config();

const express = require("express");
const serverless = require("serverless-http");
const cors = require("cors");
const bodyParser = require("body-parser");

const midtransRoutes = require("../routes/midtrans");

const app = express();

// CORS Configuration
const corsOptions = {
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(bodyParser.json());

// Health check
app.get("/", (req, res) => {
  res.status(200).send("🍉 Backend Buah API is running");
});

// Routes
app.use("/api", midtransRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

module.exports = app;
module.exports.handler = serverless(app);
