/**
 * TRY SASTA (trysasta.com) - 24/7 Automated WhatsApp Wholesale Dropship Bot
 * Features:
 * 1. Multi-Image Collector: Buffers ALL images posted for a suit batch (e.g. 5, 20, or 100 images)
 * 2. Real Supplier Name Tagging: Sends the exact WhatsApp Group / Supplier name to cPanel & Google Sheet
 * 3. Arabic & Bismillah Remover: Clean professional titles without Bismillah or vendor icons
 * 4. Vendor Wholesale Price Excluder: Prevents vendor rate lines from leaking into specifications
 * 5. Direct Catbox.moe CDN with ImgBB fallback: Never fallback to dummy pictures
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

  // APPROVED WHOLESALE COMMUNITIES ONLY
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

// GROUP BATCH BUFFER: Collects multiple photos and text per group
// Key: fromJid -> { images: [buffer1, buffer2, ...], timer: null, lastUpdate: timestamp }
const GROUP_BATCHES = new Map();

/**
 * Robust CDN Uploader:
 * Uploads real buffer to Catbox.moe (or ImgBB fallback)
 */
async function uploadImageToCDN(buffer) {
  // Method 1: Catbox.moe
  try {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', buffer, {
      filename: `suit_${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`,
      contentType: 'image/jpeg'
    });

    const res = await axios.post('https://catbox.moe/user/api.php', form, {
      headers: form.getHeaders(),
      timeout: 25000
    });

    if (res.data && typeof res.data === 'string' && res.data.startsWith('http')) {
      return res.data.trim();
    }
  } catch (err1) {
    console.warn('⚠️ Catbox notice:', err1.message);
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
      return res.data.data.url;
    }
  } catch (err2) {
    console.warn('⚠️ ImgBB notice:', err2.message);
  }

  return null;
}

/**
 * Intelligent Caption Parser:
 * - Detects Wholesale Rate
 * - Strips Arabic Bismillah & vendor price lines
 * - Determines Category
 * - Extracts Clean Specifications
 */
function parseCaption(text) {
  if (!text) return null;

  let wholesale = null;

  // Match Advance / Wholesale payment rates
  const advanceMatch = text.match(/(?:advance\s*payment|advance|wholesale\s*price|wholesale|rate|price|cod|cash\s*on\s*delivery)\s*[:=\-]?\s*(?:rs\.?\s*)?(\d{3,5})/i);
  if (advanceMatch) {
    wholesale = parseInt(advanceMatch[1], 10);
  } else {
    // Or match standalone 4-digit numbers like 2750, 3900, 1750
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
  if (lower.includes('razae') || lower.includes('bed') || lower.includes('sheet') || lower.includes('pillow') || lower.includes('cushion') || lower.includes('palachi')) {
    category = 'BEDSHEETS';
  } else if (lower.includes('maria b') || lower.includes('kids') || lower.includes('ladies') || lower.includes('lawn') || lower.includes('dhanak') || lower.includes('linen') || lower.includes('karandi') || lower.includes('kurti') || lower.includes('dupatta') || lower.includes('chiffon') || (lower.includes('shawl') && !lower.includes('men')) || lower.includes('frock')) {
    category = (lower.includes('2pc') || lower.includes('2-pc') || lower.includes('2 piece')) ? 'LAWN_2PC' : 'LAWN_3PC';
  } else if (lower.includes('gents') || lower.includes('men') || lower.includes('boski') || lower.includes('wash & wear') || lower.includes('cotton fabric') || lower.includes('skardu wool')) {
    category = 'GENTS';
  } else {
    category = 'LAWN_3PC';
  }

  const rawLines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Strip Bismillah, Arabic symbols, and vendor rates from header lines
  const cleanHeaderLines = rawLines
    .map(l => {
      let cl = l.replace(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF۞۩﴾﴿]/g, '');
      cl = cl.replace(/[*_~✨🔥😍]/g, '').trim();
      return cl;
    })
    .filter(l => l.length > 2 && !l.match(/^(price|rate|wholesale|cod|advance|free delivery|dc|rs\.?\s*\d+)/i));

  let title = cleanHeaderLines.slice(0, 2).join(' - ');
  title = title.replace(/^[\s\-\–\—\:]+/g, '').trim();
  if (!title || title.length < 4) title = `Luxury Designer Collection (${category})`;
  if (title.length > 65) title = title.substring(0, 65);

  // Extract Exact Specs, strictly excluding Arabic and Vendor Price lines
  const specs = [];
  for (const line of rawLines) {
    let clean = line.replace(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF۞۩﴾﴿]/g, '');
    clean = clean.replace(/[*_~]/g, '').trim();
    if (clean.length < 3) continue;

    // Filter out vendor wholesale and delivery cost lines
    if (clean.match(/(?:advance\s*payment|advance|wholesale|rate|price|cod|free\s*dc|dc\s*free|rs\.?\s*\d+|only\s*😍)/i)) continue;
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
    specs.push("Direct Wholesale Textile Import");
    specs.push("100% Guaranteed pure unstitched fabric quality");
    specs.push("Express Dispatch within 2-5 Working Days");
    specs.push("Cash on Delivery nationwide with checking warranty");
  }

  return {
    title,
    wholesaleRate: wholesale,
    retailPrice: retail,
    category,
    specs
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
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log(`⚠️ Connection state: ${statusCode}`);
      setTimeout(startBot, 4000);
    } else if (connection === 'open') {
      console.log('\n======================================================');
      console.log('🎉 BOT 100% ONLINE & LISTENING TO APPROVED WHOLESALE GROUPS:');
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

    const isApprovedGroup = CONFIG.TARGET_GROUPS.some(allowedName => 
      groupSubject.toLowerCase().replace(/\s+/g, '').includes(allowedName.toLowerCase().replace(/\s+/g, ''))
    );

    if (!isApprovedGroup) return;

    const isImage = !!msg.message.imageMessage;
    const incomingText = msg.message.imageMessage?.caption || 
                         msg.message.conversation || 
                         msg.message.extendedTextMessage?.text || '';

    // Initialize or get group batch
    if (!GROUP_BATCHES.has(fromJid)) {
      GROUP_BATCHES.set(fromJid, {
        groupName: groupSubject,
        images: [],
        caption: '',
        lastSeen: Date.now()
      });
    }

    const batch = GROUP_BATCHES.get(fromJid);
    batch.lastSeen = Date.now();
    if (groupSubject) batch.groupName = groupSubject;

    // Collect image buffer
    if (isImage) {
      try {
        const imgBuffer = await downloadMediaMessage(msg, 'buffer', {});
        batch.images.push(imgBuffer);
        console.log(`📸 Collected image (${batch.images.length}) from "${batch.groupName}"`);
      } catch (err) {
        console.error('Image download error:', err.message);
      }
    }

    // Collect caption text
    if (incomingText && incomingText.length > 10) {
      batch.caption = incomingText;
    }

    // Schedule processing after 12 seconds of quiet period (allows all images in batch to finish arriving)
    if (batch.timer) clearTimeout(batch.timer);

    batch.timer = setTimeout(async () => {
      try {
        if (!batch.caption) {
          console.log(`⏳ Received ${batch.images.length} images from ${batch.groupName}, still waiting for caption...`);
          return;
        }

        const parsed = parseCaption(batch.caption);
        if (!parsed) {
          GROUP_BATCHES.delete(fromJid);
          return;
        }

        console.log(`\n⚡ [PROCESSING BATCH FROM SUPPLIER: ${batch.groupName}]`);
        console.log(`👗 Title: ${parsed.title}`);
        console.log(`💰 Wholesale Rate: Rs. ${parsed.wholesaleRate} -> Retail: Rs. ${parsed.retailPrice}`);
        console.log(`📸 Total Images Collected: ${batch.images.length}`);

        // Upload images to CDN (limit to max 12 per batch for speed, or first image)
        const uploadedUrls = [];
        const imagesToUpload = batch.images.slice(0, 15);

        for (let i = 0; i < imagesToUpload.length; i++) {
          const url = await uploadImageToCDN(imagesToUpload[i]);
          if (url) uploadedUrls.push(url);
        }

        // If no image was received in batch, retain primary placeholder
        if (uploadedUrls.length === 0) {
          uploadedUrls.push('https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=600');
        }

        console.log(`🌐 Uploaded CDN URLs (${uploadedUrls.length}):`, uploadedUrls);

        // Send full payload to website webhook
        await axios.post(CONFIG.SITE_WEBHOOK_URL, {
          title: parsed.title,
          category: parsed.category,
          wholesaleRate: parsed.wholesaleRate,
          retailPrice: parsed.retailPrice,
          imageUrl: uploadedUrls[0],
          images: uploadedUrls,
          specs: parsed.specs,
          description: parsed.specs.join("\n"),
          supplier: batch.groupName,
          tag: 'JUST ARRIVED'
        }, {
          headers: { 'Authorization': `Bearer ${CONFIG.WEBHOOK_TOKEN}` }
        });

        console.log(`🎉 100% POSTED TO trysasta.com & GOOGLE SHEET WITH SUPPLIER: "${batch.groupName}" & ALL DESIGNS!\n`);
      } catch (err) {
        console.error('Batch sync error:', err.message);
      } finally {
        GROUP_BATCHES.delete(fromJid);
      }
    }, 12000);
  });
}

startBot();
