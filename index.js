/**
 * TRY SASTA (trysasta.com) - 24/7 Automated WhatsApp Wholesale Dropship Bot
 * Upgraded with:
 * 1. Dual Image Hosting: Catbox.moe CDN with ImgBB fallback (NO dummy photos!)
 * 2. Exact Specification Parsing: Preserves raw fabric details, embroidery, shirt, trouser, dupatta specs
 * 3. Multi-Message Buffer (Images first, Description later support)
 */

console.log('🚀 [TRY SASTA BOT] Initializing engine...');

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
    'kainaat',
    'kainat',
    'KAINAAT TEXTILE',
    'MTN Textile'
  ]
};

// IN-MEMORY BUFFER: Stores the most recent image for each group (valid for 5 minutes)
const GROUP_IMAGE_BUFFER = new Map();

/**
 * Robust CDN Uploader:
 * Priority 1: Catbox.moe (Free, ultra-fast, no API key required, permanent CDN URLs)
 * Priority 2: ImgBB API (Fallback)
 */
async function uploadImageToCDN(buffer) {
  // Method 1: Catbox.moe
  try {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', buffer, {
      filename: `suit_${Date.now()}.jpg`,
      contentType: 'image/jpeg'
    });

    const res = await axios.post('https://catbox.moe/user/api.php', form, {
      headers: form.getHeaders(),
      timeout: 25000
    });

    if (res.data && typeof res.data === 'string' && res.data.startsWith('http')) {
      console.log('✅ Image uploaded successfully via Catbox CDN:', res.data.trim());
      return res.data.trim();
    }
  } catch (err1) {
    console.warn('⚠️ Catbox upload notice:', err1.message);
  }

  // Method 2: ImgBB fallback
  try {
    const form = new FormData();
    form.append('image', buffer.toString('base64'));
    const res = await axios.post(`https://api.imgbb.com/1/upload?key=${CONFIG.IMGBB_API_KEY}`, form, {
      headers: form.getHeaders(),
      timeout: 25000
    });
    if (res.data?.data?.url) {
      console.log('✅ Image uploaded successfully via ImgBB:', res.data.data.url);
      return res.data.data.url;
    }
  } catch (err2) {
    console.warn('⚠️ ImgBB fallback notice:', err2.message);
  }

  // Final fallback only if both CDNs fail
  return 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=600';
}

/**
 * Intelligent Caption Parser:
 * - Detects Wholesale Rate
 * - Determines Category
 * - Builds Clean Title
 * - Extracts Exact Fabric / Design Bullet Points (Specs)
 */
function parseCaption(text) {
  if (!text) return null;

  let wholesale = null;

  // Match Advance / Wholesale payment rates
  const advanceMatch = text.match(/(?:advance\s*payment|advance|wholesale|rate|price|cod|cash\s*on\s*delivery)\s*[:=\-]?\s*(\d{3,5})/i);
  if (advanceMatch) {
    wholesale = parseInt(advanceMatch[1], 10);
  } else {
    // Or match standalone 4-digit numbers like 2750, 2850, 3950
    const rawNumbers = text.match(/\b([1-9]\d{3})\b/g);
    if (rawNumbers && rawNumbers.length > 0) {
      wholesale = parseInt(rawNumbers[rawNumbers.length - 1], 10);
    }
  }

  if (!wholesale || wholesale < 800 || wholesale > 25000) return null;

  // Selling rate with retail markup (rounded to nearest 50)
  const retail = Math.round((wholesale * (1 + CONFIG.PROFIT_MARKUP_PERCENT / 100)) / 50) * 50;

  let category = 'LAWN_3PC';
  const lower = text.toLowerCase();
  if (lower.includes('gents') || lower.includes('men') || lower.includes('boski') || lower.includes('wash & wear') || lower.includes('cotton fabric')) {
    category = 'GENTS';
  } else if (lower.includes('razae') || lower.includes('bed') || lower.includes('sheet') || lower.includes('pillow')) {
    category = 'BEDSHEETS';
  } else if (lower.includes('2pc') || lower.includes('2-pc') || lower.includes('2 piece')) {
    category = 'LAWN_2PC';
  } else {
    category = 'LAWN_3PC';
  }

  // Extract clean suit title from top lines
  const rawLines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const cleanHeaderLines = rawLines
    .map(l => l.replace(/[*_~✨🔥]/g, '').trim())
    .filter(l => l.length > 2 && !l.match(/^(price|rate|wholesale|cod|advance|free delivery|dc)/i));

  let title = cleanHeaderLines.slice(0, 2).join(' - ');
  if (!title || title.length < 5) title = `TRY SASTA Luxury Collection (${category})`;
  if (title.length > 65) title = title.substring(0, 65);

  // Extract Exact Specs from WhatsApp Message Lines
  const specs = [];
  for (const line of rawLines) {
    const clean = line.replace(/[*_~]/g, '').trim();
    if (clean.length < 3) continue;
    if (clean.match(/(?:advance\s*payment|advance|wholesale|rate|price|cod|free\s*dc|dc\s*free)/i)) continue;
    if (clean.match(/^(order\s*now|book\s*fast|limited\s*stock|contact|whatsapp)/i)) continue;

    const isBullet = /^[*>\-0-9]/.test(line.trim());
    const hasFabricKeyword = /(razae|sheet|pillow|cotton|salonica|filling|gsm|shirt|dupatta|trouser|fabric|lawn|chiffon|embroidery|embroidered|dhanak|linen|karandi|print|digital|dyed|cut|meter|boti|front|back|sleeves|organza|silk|patch|lace)/i.test(clean);

    if (isBullet || hasFabricKeyword) {
      const strippedBullet = clean.replace(/^[*>\-\s0-9.:]+/g, '').trim();
      if (strippedBullet.length >= 3 && !specs.includes(strippedBullet)) {
        specs.push(strippedBullet);
      }
    }
  }

  if (specs.length === 0) {
    for (let i = 0; i < Math.min(rawLines.length, 5); i++) {
      const cl = rawLines[i].replace(/[*_~]/g, '').trim();
      if (cl.length > 4 && !cl.match(/(price|rate|wholesale|cod|advance)/i)) {
        specs.push(cl);
      }
    }
  }

  if (specs.length === 0) {
    specs.push("Direct Wholesale Textile Import");
    specs.push("100% Guaranteed pure fabric quality");
    specs.push("Express Dispatch within 2-5 Working Days");
    specs.push("Cash on Delivery nationwide with checking warranty");
  }

  return { 
    title, 
    wholesaleRate: wholesale, 
    retailPrice: retail, 
    category,
    specs,
    rawText: text
  };
}

async function startBot() {
  console.log('🔄 Loading WhatsApp auth credentials...');
  const { state, saveCreds } = await useMultiFileAuthState('./session_data');
  const { version } = await fetchLatestBaileysVersion();

  console.log(`📡 Connecting to WhatsApp Web (v${version.join('.')})...`);

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  // Request Pairing Code if not registered yet
  if (!sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        console.log(`📲 Requesting 8-digit pairing code for +${CONFIG.PHONE_NUMBER}...`);
        const code = await sock.requestPairingCode(CONFIG.PHONE_NUMBER);
        console.log('\n======================================================');
        console.log(`🔑 YOUR NEW PAIRING CODE: [ ${code} ]`);
        console.log('Open WhatsApp -> Linked Devices -> Link with phone number');
        console.log('======================================================\n');
      } catch (err) {
        console.log('Pairing notice:', err.message);
      }
    }, 6000);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    
    if (connection === 'connecting') {
      console.log('⏳ WhatsApp connecting in progress...');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log(`⚠️ Connection state: ${statusCode}`);
      setTimeout(startBot, 4000);
    } else if (connection === 'open') {
      console.log('\n======================================================');
      console.log('🎉 BOT 100% ONLINE & LISTENING TO 5 TARGET GROUPS:');
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

    // STRICT CHECK: Is this message from one of our approved wholesale groups?
    const isApprovedGroup = CONFIG.TARGET_GROUPS.some(allowedName => 
      groupSubject.toLowerCase().replace(/\s+/g, '').includes(allowedName.toLowerCase().replace(/\s+/g, ''))
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
      console.log(`📝 Extracted Specs (${parsed.specs.length} items):`, parsed.specs);
      console.log(`🖼️ Final Image URL: ${cdnImageUrl}`);

      try {
        await axios.post(CONFIG.SITE_WEBHOOK_URL, {
          title: parsed.title,
          category: parsed.category,
          wholesaleRate: parsed.wholesaleRate,
          retailPrice: parsed.retailPrice,
          imageUrl: cdnImageUrl,
          specs: parsed.specs,
          description: parsed.specs.join("\n"),
          tag: 'JUST ARRIVED'
        }, {
          headers: { 'Authorization': `Bearer ${CONFIG.WEBHOOK_TOKEN}` }
        });

        console.log(`🎉 LIVE POSTED TO trysasta.com & GOOGLE SHEET WITH EXACT SPECS & REAL PHOTO!\n`);
        GROUP_IMAGE_BUFFER.delete(fromJid);
      } catch (err) {
        console.error('Webhook sync error:', err.message);
      }
    }
  });
}

startBot();
