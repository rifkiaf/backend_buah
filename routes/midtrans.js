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
  const { userId, cartItems, total, displayName } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "User ID is required" });
  }
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    return res.status(400).json({ error: "Cart items cannot be empty" });
  }
  const grossAmount = Number(total);
  if (isNaN(grossAmount) || grossAmount <= 0) {
    return res.status(400).json({ error: "Invalid total amount" });
  }
  if (!displayName) {
    return res.status(400).json({ error: "Display name is required" });
  }

  const orderId = `ORDER-${Date.now()}`;

  const parameter = {
    transaction_details: {
      order_id: orderId,
      gross_amount: grossAmount,
    },
    customer_details: {
      first_name: displayName, // Use displayName instead of userId
    },
    item_details: cartItems.map((item) => ({
      id: item.id,
      price: item.price,
      quantity: item.quantity,
      name: item.name,
    })),
  };

  console.log("Midtrans parameter:", JSON.stringify(parameter, null, 2));

  try {
    const transaction = await snap.createTransaction(parameter);

    await db.collection("transactions").doc(orderId).set({
      userId,
      cartItems,
      total: grossAmount,
      status: "pending",
      createdAt: new Date().toISOString(),
      displayName, // Store displayName in Firestore
    });

    res.json({ token: transaction.token, orderId });
  } catch (error) {
    // Jika error dari Midtrans biasanya ada property response.data
    if (error.response && error.response.data) {
      console.error("Midtrans Error Response:", error.response.data);
    } else {
      console.error("Midtrans Error:", error);
    }
    res.status(500).json({ error: "Failed to create transaction" });
  }
});

// Update status transaksi secara manual (opsional)
router.post("/update-transaction-status", async (req, res) => {
  const { orderId, status } = req.body;

  if (!orderId || !status) {
    return res.status(400).json({ error: "orderId dan status wajib diisi" });
  }

  try {
    await db.collection("transactions").doc(orderId).update({
      status,
      updatedAt: new Date().toISOString(),
    });

    // Kurangi stok produk jika status "paid"
    if (status === "paid") {
      const transactionSnap = await db.collection("transactions").doc(orderId).get();
      const { cartItems } = transactionSnap.data();

      const batch = db.batch();
      for (const item of cartItems) {
        const productRef = db.collection("products").doc(item.id);
        const productSnap = await productRef.get();
        if (productSnap.exists) {
          const currentStock = productSnap.data().stock || 0;
          const newStock = Math.max(currentStock - item.quantity, 0);
          batch.update(productRef, { stock: newStock });
        }
      }
      await batch.commit();
    }

    res.status(200).json({ message: "Status dan stok berhasil diperbarui" });
  } catch (err) {
    console.error("Error update transaction:", err);
    res.status(500).json({ error: "Gagal update transaksi" });
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

    if (transactionStatus === "settlement") {
      const transactionSnap = await db.collection("transactions").doc(orderId).get();
      const { cartItems } = transactionSnap.data();

      const batch = db.batch();
      for (const item of cartItems) {
        const productRef = db.collection("products").doc(item.id);
        const productSnap = await productRef.get();
        if (productSnap.exists) {
          const currentStock = productSnap.data().stock || 0;
          const newStock = Math.max(currentStock - item.quantity, 0);
          batch.update(productRef, { stock: newStock });
        }
      }
      await batch.commit();
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("Webhook Error:", err);
    res.status(500).send("Failed");
  }
});

module.exports = router;