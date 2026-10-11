/**
 * TRY SASTA (trysasta.com) - 24/7 Automated WhatsApp Wholesale Dropship Bot
 * Upgraded with Multi-Message Buffer (Images first, Description later support)
 */

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage,
  Browsers,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const FormData = require('form-data');

// CONFIGURATION
const CONFIG = {
  PHONE_NUMBER: '923056387607',
  SITE_WEBHOOK_URL: 'https://trysasta.com/api/webhook_sync.php',
  WEBHOOK_TOKEN: 'trysasta_secret_pass_2026',
  PROFIT_MARKUP_PERCENT: 35,
  IMGBB_API_KEY: process.env.IMGBB_API_KEY || '6d207e02198a847aa5a0a0a3b90143bc',

  // LOCKED APPROVED WHOLESALE COMMUNITIES ONLY
  TARGET_GROUPS: [
    'AH Textile Collection',
    'AL-KABIR TEXTILE',
    "Today's Fashion",
    'kainaat textile New',
    'MTN Textile'
  ]
};

// IN-MEMORY BUFFER: Stores the most recent image for each group (valid for 5 minutes)
// This handles: Seller sends 5 pictures first, then description text message 30 seconds later!
const GROUP_IMAGE_BUFFER = new Map();

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

  // Flexible price match:
  // e.g. "Rate: 2400", "Price 2600", "Cash on Delivery 2900", "Advance payment 2750", "2850 2750"
  let wholesale = null;

  // Match Advance / Wholesale payment rates
  const advanceMatch = text.match(/(?:advance\s*payment|advance|wholesale|rate|price|cod|cash\s*on\s*delivery)\s*[:=\-]?\s*(\d{3,5})/i);
  if (advanceMatch) {
    wholesale = parseInt(advanceMatch[1], 10);
  } else {
    // Or match standalone 4-digit numbers like 2750, 2850
    const rawNumbers = text.match(/\b([1-9]\d{3})\b/g);
    if (rawNumbers && rawNumbers.length > 0) {
      // Pick the wholesale price
      wholesale = parseInt(rawNumbers[rawNumbers.length - 1], 10);
    }
  }

  if (!wholesale || wholesale < 800 || wholesale > 25000) return null;

  // Selling rate with retail markup
  const retail = Math.round((wholesale * (1 + CONFIG.PROFIT_MARKUP_PERCENT / 100)) / 50) * 50;

  let category = 'LAWN_3PC';
  const lower = text.toLowerCase();
  if (lower.includes('gents') || lower.includes('men') || lower.includes('boski') || lower.includes('wash & wear') || lower.includes('cotton fabric')) {
    category = 'GENTS';
  } else if (lower.includes('2pc') || lower.includes('2-pc') || lower.includes('2 piece')) {
    category = 'LAWN_2PC';
  } else if (lower.includes('bed') || lower.includes('sheet')) {
    category = 'BEDSHEETS';
  } else {
    category = 'LAWN_3PC';
  }

  // Extract clean suit title from first two lines
  const lines = text.split('\n').map(l => l.replace(/[*_~•✨🔥]/g, '').trim()).filter(l => l.length > 2);
  let title = lines.slice(0, 2).join(' - ');
  if (!title || title.length < 5) title = `TRY SASTA Luxury Collection (${category})`;
  if (title.length > 65) title = title.substring(0, 65);

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
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const reconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (reconnect) startBot();
    } else if (connection === 'open') {
      console.log('\n======================================================');
      console.log('🎉 BOT LOCKED & ACTIVE FOR 5 TARGET WHOLESALE COMMUNITIES:');
      CONFIG.TARGET_GROUPS.forEach((g, i) => console.log(`   ${i + 1}. ${g}`));
      console.log('======================================================\n');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const fromJid = msg.key.remoteJid;
    if (!fromJid.endsWith('@g.us')) return;

    let groupSubject = '';
    try {
      const groupMeta = await sock.groupMetadata(fromJid);
      groupSubject = groupMeta.subject || '';
    } catch (e) {
      // fallback
    }

    // STRICT CHECK: Is this message from one of our 5 approved wholesale groups?
    const isApprovedGroup = CONFIG.TARGET_GROUPS.some(allowedName => 
      groupSubject.toLowerCase().includes(allowedName.toLowerCase())
    );

    if (!isApprovedGroup) return;

    const isImage = !!msg.message.imageMessage;
    const incomingText = msg.message.imageMessage?.caption || 
                         msg.message.conversation || 
                         msg.message.extendedTextMessage?.text || '';

    // CASE 1: Seller sends IMAGE first (save buffer for this group)
    if (isImage) {
      try {
        const imgBuffer = await downloadMediaMessage(msg, 'buffer', {});
        GROUP_IMAGE_BUFFER.set(fromJid, {
          buffer: imgBuffer,
          timestamp: Date.now()
        });
        console.log(`📸 Cached new suit photo from group: "${groupSubject}" (Waiting for description...)`);
      } catch (err) {
        console.error('Image download error:', err.message);
      }
    }

    // CASE 2: Text description received (either in image caption OR standalone text message)
    if (incomingText && incomingText.length > 10) {
      const parsed = parseCaption(incomingText);
      if (!parsed) return; // No price detected

      // Check if we have an image for this group in buffer (received within last 5 minutes)
      const cached = GROUP_IMAGE_BUFFER.get(fromJid);
      let cdnImageUrl = 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=600';

      if (cached && (Date.now() - cached.timestamp < 300000)) {
        cdnImageUrl = await uploadImageToCDN(cached.buffer);
      }

      console.log(`\n⚡ [MATCHED SUIT FROM: ${groupSubject}]`);
      console.log(`👗 Title: ${parsed.title}`);
      console.log(`💰 Wholesale Rate: Rs. ${parsed.wholesaleRate} -> Retail: Rs. ${parsed.retailPrice}`);

      try {
        await axios.post(CONFIG.SITE_WEBHOOK_URL, {
          title: parsed.title,
          category: parsed.category,
          wholesaleRate: parsed.wholesaleRate,
          retailPrice: parsed.retailPrice,
          imageUrl: cdnImageUrl,
          tag: 'JUST ARRIVED'
        }, {
          headers: { 'Authorization': `Bearer ${CONFIG.WEBHOOK_TOKEN}` }
        });

        console.log(`🎉 LIVE POSTED TO trysasta.com & GOOGLE SHEET!\n`);
        // Clear buffer once posted
        GROUP_IMAGE_BUFFER.delete(fromJid);
      } catch (err) {
        console.error('Webhook sync error:', err.message);
      }
    }
  });
}

startBot();
