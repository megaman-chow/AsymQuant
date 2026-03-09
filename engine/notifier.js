require('dotenv').config();
const axios = require('axios');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

async function sendAlert(message) {
  if (!TELEGRAM_TOKEN || !CHAT_ID) {
    console.error("Telegram credentials missing in .env");
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: CHAT_ID,
      text: message,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error("Telegram Alert Failed:", error.message);
  }
}

module.exports = { sendAlert };
