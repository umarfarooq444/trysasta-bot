/**
 * TRY SASTA (trysasta.com) - 24/7 Wholesaler Auto-Bot
 * TARGET COMMUNITIES FILTER LOCKED:
 * 1. AH Textile Collection
 * 2. AL-KABIR TEXTILE 1 (SUPER WHOLESALE GROUP)
 * 3. Today's Fashion
 * 4. kainaat textile New
 * 5. MTN Textile
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
      console.log('------------------------------------------------------');
      console.log('All other personal/family groups will be 100% IGNORED.');
      console.log('======================================================\n');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const fromJid = msg.key.remoteJid;
    // Sirf Groups ko process karein
    if (!fromJid.endsWith('@g.us')) return;

    // Fetch Group Subject
    let groupSubject = '';
    try {
      const groupMeta = await sock.groupMetadata(fromJid);
      groupSubject = groupMeta.subject || '';
    } catch (e) {
      // fallback
    }

    // STRICT CHECK: Is this message from one of our approved wholesale groups?
    const isApprovedGroup = CONFIG.TARGET_GROUPS.some(allowedName => 
      groupSubject.toLowerCase().includes(allowedName.toLowerCase())
    );

    if (!isApprovedGroup) {
      // Agar in 5 groups me se nahi hai toh foran discard kar do!
      return;
    }

    const imageMessage = msg.message.imageMessage;
    const caption = imageMessage?.caption || msg.message.conversation || msg.message.extendedTextMessage?.text;

    if (!imageMessage || !caption) return;

    const parsed = parseCaption(caption);
    if (!parsed) return; // ignore posts without wholesale rate

    console.log(`\n⚡ [FROM: ${groupSubject}] New Suit Detected: ${parsed.title}`);
    console.log(`💰 Wholesale Rate: Rs. ${parsed.wholesaleRate} -> TRY SASTA Selling Rate: Rs. ${parsed.retailPrice}`);

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

      console.log(`🎉 Live Posted to trysasta.com from "${groupSubject}"!\n`);
    } catch (err) {
      console.error('Webhook sync error:', err.message);
    }
  });
}

startBot();
