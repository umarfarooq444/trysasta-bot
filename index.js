/**
 * TRY SASTA (trysasta.com) - 24/7 Automated WhatsApp Wholesale Dropship Bot
 * Features:
 * 1. Multi-Image Collector: Buffers ALL images posted for a suit batch (e.g. 5, 20, or 100 images)
 * 2. Real Supplier Name Tagging: Sends the exact WhatsApp Group / Supplier name to cPanel & Google Sheet
 * 3. Arabic & Bismillah Remover: Clean professional titles without Bismillah or vendor icons
 * 4. Vendor Wholesale Price Excluder: Prevents vendor rate lines from leaking into specifications
 * 5. Direct cPanel Hosting Upload with Catbox/Litterbox fallback: Never fallbacks to dummy pictures
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

  // APPROVED WHOLESALE COMMUNITIES:
  // Empty [] means automatically accept posts from ALL WhatsApp wholesale groups!
  TARGET_GROUPS: []
};

// GROUP BATCH BUFFER: Collects multiple photos and text per group
// Key: fromJid -> { images: [buffer1, buffer2, ...], timer: null, lastUpdate: timestamp }
const GROUP_BATCHES = new Map();

/**
 * Robust CDN Uploader:
 * Uploads real buffer to trysasta.com cPanel (or Catbox/Litterbox fallback)
 */
async function uploadImageToCDN(buffer) {
  // Method 1: Direct Upload to trysasta.com hosting (Most reliable, never rate-limited)
  try {
    const form = new FormData();
    form.append('image', buffer, {
      filename: `suit_${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`,
      contentType: 'image/jpeg'
    });

    const res = await axios.post('https://trysasta.com/api/upload_image.php', form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${CONFIG.WEBHOOK_TOKEN}`
      },
      timeout: 25000
    });

    if (res.data && res.data.status === 'success' && res.data.url) {
      return res.data.url;
    }
  } catch (errHost) {
    console.warn('⚠️ Direct hosting upload notice:', errHost.message);
  }

  // Method 2: Catbox.moe CDN fallback
  try {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', buffer, {
      filename: `suit_${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`,
      contentType: 'image/jpeg'
    });

    const res = await axios.post('https://catbox.moe/user/api.php', form, {
      headers: {
        ...form.getHeaders(),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 25000
    });

    if (res.data && typeof res.data === 'string' && res.data.startsWith('http')) {
      return res.data.trim();
    }
  } catch (errCatbox) {
    console.warn('⚠️ Catbox notice:', errCatbox.message);
  }

  // Method 3: Litterbox CDN fallback
  try {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('time', '72h');
    form.append('fileToUpload', buffer, {
      filename: `suit_${Date.now()}.jpg`,
      contentType: 'image/jpeg'
    });
    const res = await axios.post('https://litterbox.catbox.moe/resources/internals/api.php', form, {
      headers: form.getHeaders(),
      timeout: 25000
    });
    if (res.data && typeof res.data === 'string' && res.data.startsWith('http')) {
      return res.data.trim();
    }
  } catch (errLit) {}

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

  // 1. First priority: Specifically match Wholesale Price, Discounted Price, Reseller Price, or Final Price
  const wholesaleMatch = text.match(/(?:wholesale\s*price|wholesale|discounted\s*price|discount\s*price|reseller\s*price|final\s*price|dealer\s*price|net\s*rate|cash\s*on\s*delivery|cod|advance\s*payment|advance)\s*[:=\-]?\s*(?:rs\.?\s*)?(\d{3,5})/i);
  if (wholesaleMatch) {
    wholesale = parseInt(wholesaleMatch[1], 10);
  } else {
    // 2. Remove TAG Price and Retail Price lines so they are NEVER picked up by fallback
    const filteredText = text
      .split('\n')
      .filter(line => !line.match(/(?:tag\s*price|retail\s*price|mrp\b|shop\s*price)/i))
      .join('\n');

    const priceMatch = filteredText.match(/(?:rate|price)\s*[:=\-]?\s*(?:rs\.?\s*)?(\d{3,5})/i);
    if (priceMatch) {
      wholesale = parseInt(priceMatch[1], 10);
    } else {
      // 3. Fallback: match 4-digit numbers in text that does NOT contain TAG Price
      const rawNumbers = filteredText.match(/\b([1-9]\d{3})\b/g);
      if (rawNumbers && rawNumbers.length > 0) {
        wholesale = parseInt(rawNumbers[rawNumbers.length - 1], 10);
      }
    }
  }

  if (!wholesale || wholesale < 800 || wholesale > 25000) return null;

  // Selling rate with retail markup (rounded to nearest 50)
  const retail = Math.round((wholesale * (1 + CONFIG.PROFIT_MARKUP_PERCENT / 100)) / 50) * 50;

  let category = 'LAWN_3PC';
  const lower = text.toLowerCase();
  if (/\b(bed|sheet|sheets|bedsheet|razae|pillow|cushion|palachi|comforter|quilt)\b/i.test(lower)) {
    category = 'BEDSHEETS';
  } else if (/\b(2pc|2-pc|2\s*piece|two\s*piece)\b/i.test(lower)) {
    category = 'LAWN_2PC';
  } else if (/\b(gents|men|mens|man|boski|wash\s*[\'&]\s*wear|cotton\s*fabric|skardu\s*wool)\b/i.test(lower) && !/\b(maria\s*b|ladies|women|kids|frock|kurti|dupatta)\b/i.test(lower)) {
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

    // Whitelist check: If TARGET_GROUPS has items, check them; otherwise allow all WhatsApp groups!
    const isApprovedGroup = (CONFIG.TARGET_GROUPS.length === 0) || CONFIG.TARGET_GROUPS.some(allowedName => 
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

        // If no images were received with this post, skip to avoid listing without photos
        if (!batch.images || batch.images.length === 0) {
          console.log(`⚠️ No photos received for "${parsed.title}" from "${batch.groupName}". Skipping dummy listing.`);
          return;
        }

        // Upload images to CDN / Host
        const uploadedUrls = [];
        const imagesToUpload = batch.images.slice(0, 15);

        for (let i = 0; i < imagesToUpload.length; i++) {
          const url = await uploadImageToCDN(imagesToUpload[i]);
          if (url) uploadedUrls.push(url);
        }

        // Abort if all image uploads failed
        if (uploadedUrls.length === 0) {
          console.error(`❌ Image upload failed for "${parsed.title}". Aborting to prevent listing without photos.`);
          return;
        }

        console.log(`🌐 Successfully Uploaded ${uploadedUrls.length} Real Suit Image(s):`, uploadedUrls);

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
