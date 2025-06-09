const express = require("express");
const midtransClient = require("midtrans-client");
const { db } = require("../firebase");

const router = express.Router();

const snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY,
});

// Route untuk membuat token Snap
router.post("/create-transaction", async (req, res) => {
  const { userId, cartItems, total } = req.body;

  const orderId = `ORDER-${Date.now()}`;

  const parameter = {
    transaction_details: {
      order_id: orderId,
      gross_amount: total,
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

    // Simpan data ke Firestore
    await db.collection("transactions").doc(orderId).set({
      userId,
      cartItems,
      total,
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    res.json({ token: transaction.token });
  } catch (error) {
    console.error("Midtrans Error:", error);
    res.status(500).json({ error: "Failed to create transaction" });
  }
});

// Webhook endpoint
router.post("/midtrans-notification", async (req, res) => {
  const notification = req.body;
  const orderId = notification.order_id;
  const transactionStatus = notification.transaction_status;

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
