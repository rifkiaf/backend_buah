const express = require("express");
const midtransClient = require("midtrans-client");
const { db } = require("../firebase");
const crypto = require("crypto");

const router = express.Router();

const snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY,
});

// Route to create transaction
router.post("/create-transaction", async (req, res) => {
  const {
    userId,
    cartItems,
    total,
    displayName,
    email,
    address,
    phone,
    shipping,
  } = req.body;

  // Validate request body
  if (!userId) {
    console.error("Validation Error: User ID is required", {
      requestBody: req.body,
    });
    return res.status(400).json({ error: "User ID is required" });
  }
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    console.error("Validation Error: Cart items cannot be empty", {
      requestBody: req.body,
    });
    return res.status(400).json({ error: "Cart items cannot be empty" });
  }
  const subtotal = Number(total);
  if (isNaN(subtotal) || subtotal < 0) {
    console.error("Validation Error: Invalid total amount", { total: total });
    return res.status(400).json({ error: "Invalid total amount" });
  }
  if (!displayName) {
    console.error("Validation Error: Display name is required", {
      requestBody: req.body,
    });
    return res.status(400).json({ error: "Display name is required" });
  }
  if (!email) {
    console.error("Validation Error: Email is required", {
      requestBody: req.body,
    });
    return res.status(400).json({ error: "Email is required" });
  }
  if (!address) {
    console.error("Validation Error: Address is required", {
      requestBody: req.body,
    });
    return res.status(400).json({ error: "Address is required" });
  }
  if (!phone) {
    console.error("Validation Error: Phone number is required", {
      requestBody: req.body,
    });
    return res.status(400).json({ error: "Phone number is required" });
  }
  if (!shipping || typeof shipping.cost === "undefined" || !shipping.option) {
    console.error("Validation Error: Shipping information is required", {
      requestBody: req.body,
    });
    return res.status(400).json({ error: "Shipping information is required" });
  }

  // Validate that total (subtotal) matches sum of item prices
  const calculatedTotal = cartItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  if (calculatedTotal !== subtotal) {
    console.error("Validation Error: Total amount does not match cart items", {
      providedTotal: subtotal,
      calculatedTotal,
      cartItems,
    });
    return res
      .status(400)
      .json({ error: "Total amount does not match cart items" });
  }

  const shippingCost = Number(shipping.cost);
  const grossAmount = subtotal + shippingCost;
  const orderId = `ORDER-${Date.now()}`;

  const item_details = cartItems.map((item) => ({
    id: item.id,
    price: item.price,
    quantity: item.quantity,
    name: item.name,
  }));

  if (shippingCost > 0) {
    item_details.push({
      id: "SHIPPING",
      price: shippingCost,
      quantity: 1,
      name: shipping.option,
    });
  }

  const parameter = {
    transaction_details: {
      order_id: orderId,
      gross_amount: grossAmount,
    },
    customer_details: {
      first_name: displayName,
      email: email,
    },
    item_details: item_details,
  };

  console.log(
    "Midtrans transaction parameters:",
    JSON.stringify(parameter, null, 2)
  );

  try {
    const transaction = await snap.createTransaction(parameter);
    console.log("Midtrans transaction created successfully:", {
      orderId,
      transaction,
    });

    await db
      .collection("transactions")
      .doc(orderId)
      .set({
        userId,
        email,
        address,
        phone,
        cartItems,
        subtotal: subtotal,
        shipping: shipping,
        total: grossAmount,
        status: "pending",
        createdAt: new Date().toISOString(),
        displayName,
        midtransTransactionId: transaction.transaction_id || null,
      });

    console.log("Transaction saved to Firestore:", { orderId });

    return res.json({ token: transaction.token, orderId });
  } catch (error) {
    const errorDetails =
      error.response && error.response.data
        ? error.response.data
        : { message: error.message, stack: error.stack };
    console.error("Midtrans transaction creation failed:", {
      orderId,
      error: errorDetails,
      parameters: parameter,
    });

    return res.status(500).json({
      error: "Failed to create transaction with Midtrans",
      details: errorDetails.message || "Unknown error",
    });
  }
});

// Update transaction status manually (optional)
router.post("/update-transaction-status", async (req, res) => {
  const { orderId, status } = req.body;

  if (!orderId || !status) {
    console.error("Validation Error: orderId and status are required", {
      requestBody: req.body,
    });
    return res.status(400).json({ error: "orderId dan status wajib diisi" });
  }

  try {
    await db.collection("transactions").doc(orderId).update({
      status,
      updatedAt: new Date().toISOString(),
    });

    if (status === "paid") {
      const transactionSnap = await db
        .collection("transactions")
        .doc(orderId)
        .get();
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

    console.log("Transaction status updated successfully:", {
      orderId,
      status,
    });
    return res
      .status(200)
      .json({ message: "Status dan stok berhasil diperbarui" });
  } catch (err) {
    console.error("Error updating transaction status:", {
      orderId,
      error: err.message,
    });
    return res.status(500).json({ error: "Gagal update transaksi" });
  }
});

// Webhook endpoint
router.post("/midtrans-notification", async (req, res) => {
  const notification = req.body;

  try {
    const {
      order_id,
      status_code,
      gross_amount,
      signature_key,
      transaction_status,
    } = notification;
    if (!order_id || !status_code || !gross_amount || !signature_key) {
      console.error("Missing required fields in notification:", notification);
      return res.status(400).send("Bad Request: Missing required fields");
    }

    const serverKey = process.env.MIDTRANS_SERVER_KEY;
    const stringToHash = `${order_id}${status_code}${gross_amount}${serverKey}`;
    const calculatedSignature = crypto
      .createHash("sha512")
      .update(stringToHash)
      .digest("hex");

    if (calculatedSignature !== signature_key) {
      console.error("Invalid signature key:", {
        received: signature_key,
        calculated: calculatedSignature,
      });
      return res.status(403).send("Forbidden: Invalid signature key");
    }

    const transactionRef = db.collection("transactions").doc(order_id);
    const transactionSnap = await transactionRef.get();

    if (!transactionSnap.exists) {
      console.error("Transaction not found:", order_id);
      return res.status(404).send("Not Found: Transaction does not exist");
    }

    await transactionRef.update({
      status: transaction_status,
      updatedAt: new Date().toISOString(),
      midtransTransactionId: notification.transaction_id || null,
    });

    if (transaction_status === "settlement") {
      const { cartItems } = transactionSnap.data();
      if (!cartItems || !Array.isArray(cartItems)) {
        console.error("Invalid cartItems for order:", order_id);
        return res.status(400).send("Bad Request: Invalid cart items");
      }

      const batch = db.batch();
      for (const item of cartItems) {
        const productRef = db.collection("products").doc(item.id);
        const productSnap = await productRef.get();
        if (productSnap.exists) {
          const currentStock = productSnap.data().stock || 0;
          const newStock = Math.max(currentStock - item.quantity, 0);
          batch.update(productRef, { stock: newStock });
        } else {
          console.warn("Product not found:", item.id);
        }
      }
      await batch.commit();
    }

    console.log("Notification processed successfully:", order_id);
    return res.status(200).send("OK");
  } catch (err) {
    console.error("Webhook Error:", {
      message: err.message,
      stack: err.stack,
      notification: notification,
    });
    return res.status(500).send("Internal Server Error");
  }
});

module.exports = router;