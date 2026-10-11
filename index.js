/**
 * TRY SASTA - 24/7 Cloud Auto-Listing Bot
 * 
 * Works on Render / Railway / Replit (100% Free 24/7 Cloud Hosting)
 * 1. Connects to your WhatsApp via QR code once
 * 2. Listens to Wholesaler Community Groups
 * 3. Downloads real clothing images & uploads to ImgBB/Cloudinary (free image CDN)
 * 4. Extracts Rate, applies 35% margin
 * 5. POSTs directly to your live website: https://trysasta.com/api/webhook_sync.php
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const FormData = require('form-data');
const qrcode = require('qrcode-terminal');

// CONFIGURATION
const CONFIG = {
  // Your live cPanel site webhook URL
  SITE_WEBHOOK_URL: 'https://trysasta.com/api/webhook_sync.php',
  WEBHOOK_TOKEN: 'trysasta_secret_pass_2026',
  PROFIT_MARKUP_PERCENT: 35, // 35% profit on top of wholesale rate
  // Free ImgBB API key to convert raw WhatsApp pictures into public CDN image links
  // Get free instant key at https://api.imgbb.com/ (Takes 30 seconds)
  IMGBB_API_KEY: process.env.IMGBB_API_KEY || '6d207e02198a847aa5a0a0a3b90143bc'
};

async function uploadImageToCDN(buffer) {
  try {
    const form = new FormData();
    form.append('image', buffer.toString('base64'));
    const res = await axios.post(`https://api.imgbb.com/1/upload?key=${CONFIG.IMGBB_API_KEY}`, form, {
      headers: form.getHeaders(),
      timeout: 20000
    });
    if (res.data && res.data.data && res.data.data.url) {
      return res.data.data.url;
    }
  } catch (err) {
    console.error('Image CDN upload error:', err.message);
  }
  // Fallback placeholder image if CDN fails
  return 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=600';
}

function parseCaption(text) {
  if (!text) return null;
  const priceRegex = /(?:rate|price|rs\.?|wholesale|final)\s*[:=\-]?\s*(\d{3,5})/i;
  const match = text.match(priceRegex);
  if (!match) return null;

  const wholesale = parseInt(match[1], 10);
  const retail = Math.round((wholesale * (1 + CONFIG.PROFIT_MARKUP_PERCENT / 100)) / 50) * 50;

  let category = 'MISCELLANEOUS';
  const lower = text.toLowerCase();
  if (lower.includes('gents') || lower.includes('men') || lower.includes('boski') || lower.includes('wash & wear')) {
    category = 'GENTS';
  } else if (lower.includes('lawn') || lower.includes('ladies') || lower.includes('suit') || lower.includes('dupatta')) {
    category = 'LAWN';
  }

  // Clean title from first line of message
  const rawTitle = text.split('\n')[0].replace(/[*_~]/g, '').trim();
  const title = rawTitle.length > 5 ? rawTitle.slice(0, 60) : `TRY SASTA - New Arrival (${category})`;

  return {
    title,
    wholesaleRate: wholesale,
    retailPrice: retail,
    category
  };
}

async function startAutoListingBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_cloud_session');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('\n======================================================');
      console.log('📱 SCAN THIS QR CODE IN WHATSAPP TO START AUTO-LISTING:');
      console.log('WhatsApp -> Linked Devices -> Link a Device');
      console.log('======================================================\n');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'close') {
      const reconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (reconnect) startAutoListingBot();
    } else if (connection === 'open') {
      console.log('🎉 BOT CONNECTED 24/7! Listening for Wholesale Community Updates...');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    // Check if message has an image (real clothing picture)
    const imageMessage = msg.message.imageMessage;
    const caption = imageMessage?.caption || msg.message.conversation || msg.message.extendedTextMessage?.text;

    if (!imageMessage || !caption) return;

    const parsed = parseCaption(caption);
    if (!parsed) return; // Ignore chat/chit-chat messages without rate

    console.log(`\n⚡ New Wholesaler Suit Detected: ${parsed.title}`);
    console.log(`💰 Wholesale: Rs. ${parsed.wholesaleRate} -> Live Selling Price: Rs. ${parsed.retailPrice}`);

    try {
      // 1. Download real image from WhatsApp
      console.log('📥 Downloading original photo from WhatsApp...');
      const buffer = await downloadMediaMessage(msg, 'buffer', {});

      // 2. Upload to public web image link
      console.log('☁️ Converting to live web photo link...');
      const cdnImageUrl = await uploadImageToCDN(buffer);
      console.log('✅ Photo live at:', cdnImageUrl);

      // 3. Post directly to your live cPanel website database
      console.log('🚀 Sending to trysasta.com...');
      await axios.post(CONFIG.SITE_WEBHOOK_URL, {
        title: parsed.title,
        category: parsed.category,
        wholesaleRate: parsed.wholesaleRate,
        retailPrice: parsed.retailPrice,
        imageUrl: cdnImageUrl,
        tag: 'NEW DROP'
      }, {
        headers: {
          'Authorization': `Bearer ${CONFIG.WEBHOOK_TOKEN}`
        }
      });

      console.log('🎉 BINGO! Suit is now 100% LIVE on trysasta.com storefront!\n');
    } catch (err) {
      console.error('Failed to post suit to website:', err.message);
    }
  });
}

if (require.main === module) {
  startAutoListingBot();
}

module.exports = { startAutoListingBot };
