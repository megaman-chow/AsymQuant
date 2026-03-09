require('dotenv').config();
const fs = require('fs');
const path = require('path');
// const { generatePNLCard } = require('./pnlCard.js');
const TelegramBot = require('node-telegram-bot-api');
const puppeteer = require('puppeteer');
const fetch = require('node-fetch');
//const bs58 = require('bs58');

const telegramToken = process.env.TELEGRAM_TOKEN;

const bot = new TelegramBot(telegramToken, { polling: true });

bot.onText(/\/id/, async (msg) => {
    console.log(msg);
  const chatId = msg.chat.id.toString();
  bot.sendMessage(chatId, chatId);
}); 

console.log("Telegram bot is running...");
