require('dotenv').config();
const express = require('express');
const paymentRoutes = require('./routes/payment');

const app = express();
app.use(express.json());

// Mount the payment orchestration layer
app.use('/api/v1', paymentRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Aether Engine online on port ${PORT}`));
