/**
 * TRY SASTA - Robust WhatsApp Auto-Listing Bot (Stable Linking Fix)
 * Phone: 923056387607
 */

const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason, 
  downloadMediaMessage,
  Browsers,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const FormData = require('form-data');

const CONFIG = {
  PHONE_NUMBER: '923056387607',
  SITE_WEBHOOK_URL: 'https://trysasta.com/api/webhook_sync.php',
  WEBHOOK_TOKEN: 'trysasta_secret_pass_2026',
  PROFIT_MARKUP_PERCENT: 35,
  IMGBB_API_KEY: process.env.IMGBB_API_KEY || '6d207e02198a847aa5a0a0a3b90143bc'
};

async function uploadImageToCDN(buffer) {
  try {
    const form = new FormData();
    form.append('image', buffer.toString('base64'));
    const res = await axios.post(`https://api.imgbb.com/1/upload?key=${CONFIG.IMGBB_API_KEY}`, form, {
      headers: form.getHeaders(),
      timeout: 25000
    });
    if (res.data?.data?.url) return res.data.data.url;
  } catch (err) {
    console.error('Image CDN error:', err.message);
  }
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

  const rawTitle = text.split('\n')[0].replace(/[*_~]/g, '').trim();
  const title = rawTitle.length > 5 ? rawTitle.slice(0, 60) : `TRY SASTA - New Arrival (${category})`;

  return { title, wholesaleRate: wholesale, retailPrice: retail, category };
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session_data');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    // Fix: Emulates real Chrome on Ubuntu to avoid "something went wrong" handshake drops
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false, // Prevents loading freeze
    generateHighQualityLinkPreview: true
  });

  sock.ev.on('creds.update', saveCreds);

  // REQUEST CODE IF NOT REGISTERED
  if (!sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const pairingCode = await sock.requestPairingCode(CONFIG.PHONE_NUMBER);
        console.log('\n======================================================');
        console.log('🔑 AAPKA NAYA WHATSAPP CODE HAI:');
        console.log(`👉  [  ${pairingCode}  ]  👈`);
        console.log('======================================================\n');
      } catch (err) {
        console.error('Pairing code request error:', err.message);
      }
    }, 6000);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const reconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed, reconnecting...', reconnect);
      if (reconnect) startBot();
    } else if (connection === 'open') {
      console.log('\n🎉 SUCCESS! WhatsApp (+923056387607) Connected Successfully!');
      console.log('24/7 Wholesaler Auto-Sync is now 100% active for trysasta.com!\n');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const imageMessage = msg.message.imageMessage;
    const caption = imageMessage?.caption || msg.message.conversation || msg.message.extendedTextMessage?.text;

    if (!imageMessage || !caption) return;

    const parsed = parseCaption(caption);
    if (!parsed) return;

    console.log(`\n⚡ Wholesaler Suit Received: ${parsed.title} | Retail: Rs. ${parsed.retailPrice}`);

    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      const cdnImageUrl = await uploadImageToCDN(buffer);

      await axios.post(CONFIG.SITE_WEBHOOK_URL, {
        title: parsed.title,
        category: parsed.category,
        wholesaleRate: parsed.wholesaleRate,
        retailPrice: parsed.retailPrice,
        imageUrl: cdnImageUrl,
        tag: 'NEW DROP'
      }, {
        headers: { 'Authorization': `Bearer ${CONFIG.WEBHOOK_TOKEN}` }
      });

      console.log('🎉 Successfully published to trysasta.com storefront!');
    } catch (err) {
      console.error('Webhook sync failed:', err.message);
    }
  });
}

startBot();
