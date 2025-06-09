const express = require("express");
const midtransClient = require("midtrans-client");
const { db } = require("../firebase");

const router = express.Router();

// Init Midtrans Snap Client
const snap = new midtransClient.Snap({
  isProduction: false, // Set to true in production
  serverKey: process.env.MIDTRANS_SERVER_KEY,
});

// Create transaction route
router.post("/create-transaction", async (req, res) => {
  const { userId, cartItems, total } = req.body;

  if (!userId) return res.status(400).json({ error: "User ID is required" });
  if (!Array.isArray(cartItems) || cartItems.length === 0)
    return res.status(400).json({ error: "Cart items cannot be empty" });

  const grossAmount = Number(total);
  if (isNaN(grossAmount) || grossAmount <= 0)
    return res.status(400).json({ error: "Invalid total amount" });

  const orderId = `ORDER-${Date.now()}`;

  const parameter = {
    transaction_details: {
      order_id: orderId,
      gross_amount: grossAmount,
    },
    customer_details: {
      first_name: userId,
    },
    item_details: cartItems.map((item) => ({
      id: item.id,
      price: item.price,
      quantity: item.quantity,
      name: item.name,
    })),
  };

  try {
    const transaction = await snap.createTransaction(parameter);

    // Save to Firestore
    await db.collection("transactions").doc(orderId).set({
      userId,
      cartItems,
      total: grossAmount,
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    res.json({ token: transaction.token, orderId });
  } catch (error) {
    console.error("Midtrans Error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to create transaction" });
  }
});

// Webhook endpoint to receive Midtrans notifications
router.post("/midtrans-notification", async (req, res) => {
  const notification = req.body;
  const orderId = notification.order_id;
  const transactionStatus = notification.transaction_status;

  if (!orderId || !transactionStatus) {
    return res.status(400).send("Invalid notification payload");
  }

  try {
    await db.collection("transactions").doc(orderId).update({
      status: transactionStatus,
      updatedAt: new Date().toISOString(),
    });

    res.status(200).send("OK");
  } catch (err) {
    console.error("Webhook Error:", err);
    res.status(500).send("Failed");
  }
});

module.exports = router;
