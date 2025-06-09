const serverless = require("serverless-http");
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

const midtransRoutes = require("../routes/midtrans");

const app = express();

const corsOptions = {
  origin: "http://localhost:5173",
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.send("Backend Buah API is running");
});

app.use("/api", midtransRoutes);

module.exports = app;
module.exports.handler = serverless(app);
