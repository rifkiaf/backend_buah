const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
require("dotenv").config();

const midtransRoutes = require("../routes/midtrans");

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.use("/api", midtransRoutes);

// Export handler untuk Vercel
module.exports = app;
