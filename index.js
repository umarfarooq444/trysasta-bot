/**
 * TRY SASTA (trysasta.com) - 24/7 Automated WhatsApp Wholesale Dropship Bot
 * Features:
 * 1. Multi-Image Collector: Buffers ALL images posted for a suit batch with parallel uploads
 * 2. Ultra-Robust Caption & Price Parser: Detects prices in ALL Pakistani wholesale formats (commas, slashes, Urdu, markdown, bold)
 * 3. Real Supplier Name Tagging: Group name caching to avoid WhatsApp rate-limiting
 * 4. Multi-CDN Fast Image Uploader: ImgBB + Direct Hosting + Catbox fallback (Parallel upload in 2-3s)
 * 5. Arabic & Bismillah Remover: Clean professional titles without Bismillah or vendor icons
 * 6. Wholesale Price Excluder: Prevents vendor rate lines from leaking into specifications
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

// CACHES & BUFFERS
const GROUP_BATCHES = new Map();
const GROUP_NAME_CACHE = new Map();

/**
 * Fast & Reliable Multi-CDN Uploader:
 * Priority 1: ImgBB (Super fast, dedicated CDN, never blocks Railway)
 * Priority 2: Direct Upload to trysasta.com hosting
 * Priority 3: Catbox.moe / Litterbox fallback
 */
async function uploadImageToCDN(buffer) {
  // Method 1: ImgBB CDN (Fastest & most dependable for Cloud/Railway)
  if (CONFIG.IMGBB_API_KEY) {
    try {
      const form = new FormData();
      form.append('image', buffer.toString('base64'));
      const res = await axios.post(`https://api.imgbb.com/1/upload?key=${CONFIG.IMGBB_API_KEY}`, form, {
        headers: form.getHeaders(),
        timeout: 15000
      });
      if (res.data && res.data.data && res.data.data.url) {
        return res.data.data.url;
      }
    } catch (errImgBB) {
      // Fall through to next method
    }
  }

  // Method 2: Direct Upload to trysasta.com hosting
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
      timeout: 15000
    });

    if (res.data && res.data.status === 'success' && res.data.url) {
      return res.data.url;
    }
  } catch (errHost) {
    // Fall through to next method
  }

  // Method 3: Catbox.moe CDN
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
      timeout: 15000
    });

    if (res.data && typeof res.data === 'string' && res.data.startsWith('http')) {
      return res.data.trim();
    }
  } catch (errCatbox) {}

  return null;
}

/**
 * Intelligent Pakistani Wholesale Caption Parser:
 * Detects rates in all supplier formats:
 * - *Price:* 2,150/-
 * - Rate: 2200/=
 * - Wholesale Rate 1950
 * - Single 2400 / Loose 2300
 * - Rs. 2100 / PKR 2200
 * - 2300 fix / 2300 net / 2300+dc
 * - ریٹ 2200 / قیمت 2200
 */
function parseCaption(text) {
  if (!text || typeof text !== 'string') return null;

  // 1. Normalize text: remove markdown formatting and standardize numbers
  let normalized = text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')            // invisible zero-width chars
    .replace(/[*_~`]/g, ' ')                          // strip WhatsApp markdown (*bold*, _italic_)
    .replace(/(\d),(\d{3})/g, '$1$2')                 // 2,150 -> 2150
    .replace(/(\d)\s*[\/=\-]{1,2}(?:\s*only|\s*net|\s*fix)?/gi, '$1 ') // 2150/- or 2150/= -> 2150
    .replace(/(?:ریٹ|قیمت)/g, ' price ')              // Urdu keywords
    .replace(/ہول\s*سیل/g, ' wholesale ');

  let wholesale = null;

  // Priority 1: Wholesale / Reseller / Dealer / Final Rate
  const p1Match = normalized.match(/(?:wholesale\s*rate|wholesale\s*price|wholesale|reseller\s*price|reseller|dealer\s*rate|dealer|final\s*price|final\s*rate|net\s*rate|cash\s*price|discounted\s*price|discount\s*price)\s*[:=\-]?\s*(?:rs\.?|pkr\.?)?\s*(\d{3,5})\b/i);
  if (p1Match) {
    wholesale = parseInt(p1Match[1], 10);
  }

  // Priority 2: Single / Loose rate (if wholesaler mentions both set and loose rate)
  if (!wholesale) {
    const looseMatch = normalized.match(/(?:single\s*suit|single|loose|each|per\s*suit)\s*[:=\-]?\s*(?:rs\.?|pkr\.?)?\s*(\d{3,5})\b/i);
    if (looseMatch) {
      wholesale = parseInt(looseMatch[1], 10);
    }
  }

  // Priority 3: Rate / Price keywords (excluding lines with tag price or retail price)
  if (!wholesale) {
    const noRetailLines = normalized
      .split('\n')
      .filter(line => !line.match(/(?:retail\s*price|tag\s*price|mrp\b|shop\s*rate)/i))
      .join('\n');

    const p3Match = noRetailLines.match(/(?:rate|price|cost|amount)\s*[:=\-]?\s*(?:rs\.?|pkr\.?)?\s*(\d{3,5})\b/i);
    if (p3Match) {
      wholesale = parseInt(p3Match[1], 10);
    }
  }

  // Priority 4: Explicit Currency mention (Rs. 2200, PKR 2400)
  if (!wholesale) {
    const curMatch = normalized.match(/(?:rs\.?|pkr\.?)\s*[:=\-]?\s*(\d{3,5})\b/i);
    if (curMatch) {
      const val = parseInt(curMatch[1], 10);
      if (val >= 750) {
        wholesale = val;
      }
    }
  }

  // Priority 5: Number followed by price suffixes (2150 only, 2200 net, 2300 fix, 2400+dc)
  if (!wholesale) {
    const suffixMatch = normalized.match(/\b([1-9]\d{2,4})\s*(?:only|net|fix|fixed|\+dc|plus\s*dc|advance)\b/i);
    if (suffixMatch) {
      const val = parseInt(suffixMatch[1], 10);
      if (val >= 750 && val <= 25000) {
        wholesale = val;
      }
    }
  }

  // Priority 6: Bottom-Up line scanner for suit prices (850 to 25,000), ignoring phone numbers and years
  if (!wholesale) {
    const lines = normalized.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      // Skip contact lines
      if (/^(?:contact|whatsapp|call|phone|booking|jazzcash|easypaisa|\+?92|03\d{2})/i.test(line)) continue;

      const numbers = line.match(/\b([1-9]\d{2,4})\b/g);
      if (numbers) {
        for (const numStr of numbers) {
          const n = parseInt(numStr, 10);
          if (n >= 850 && n <= 25000 && n !== 2024 && n !== 2025 && n !== 2026 && n !== 2027) {
            wholesale = n;
            break;
          }
        }
      }
      if (wholesale) break;
    }
  }

  if (!wholesale || wholesale < 750 || wholesale > 25000) return null;

  // Selling rate with retail markup (rounded to nearest 50)
  const retail = Math.round((wholesale * (1 + CONFIG.PROFIT_MARKUP_PERCENT / 100)) / 50) * 50;

  let category = 'LAWN_3PC';
  const lower = text.toLowerCase();
  if (/\b(bed|sheet|sheets|bedsheet|razae|pillow|cushion|palachi|comforter|quilt)\b/i.test(lower)) {
    category = 'BEDSHEETS';
  } else if (/\b(gents|men|mens|man|mardana|boski|kamalia|wash\s*[\'&]\s*wear|wash\s*n\s*wear|washnwear|w&w|pasha|grace|dynasty|latha|hard\s*cotton|soft\s*cotton|egyptian\s*cotton|cotton\s*fabric|gents\s*khaddar|men\s*khaddar|gents\s*suit|men\s*suit|unstitched\s*gents|shawls\s*men)\b/i.test(lower) && !/\b(maria\s*b|ladies|women|kids|frock|kurti|dupatta|lawn\s*3pc|lawn\s*2pc)\b/i.test(lower)) {
    category = 'GENTS';
  } else if (/\b(2pc|2-pc|2\s*piece|two\s*piece)\b/i.test(lower)) {
    category = 'LAWN_2PC';
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

async function getGroupName(sock, fromJid) {
  if (GROUP_NAME_CACHE.has(fromJid)) {
    return GROUP_NAME_CACHE.get(fromJid);
  }
  try {
    const meta = await sock.groupMetadata(fromJid);
    if (meta && meta.subject) {
      GROUP_NAME_CACHE.set(fromJid, meta.subject);
      return meta.subject;
    }
  } catch (e) {}
  return "Verified Wholesaler";
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
      console.log('🎉 BOT 100% ONLINE & LISTENING TO ALL WHOLESALE GROUPS!');
      console.log('======================================================\n');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const fromJid = msg.key.remoteJid;
    if (!fromJid.endsWith('@g.us')) return;

    const groupSubject = await getGroupName(sock, fromJid);

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
    if (groupSubject && groupSubject !== "Verified Wholesaler") {
      batch.groupName = groupSubject;
    }

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

    // Schedule processing after 18 seconds of quiet period (allows all images in batch to finish arriving)
    if (batch.timer) clearTimeout(batch.timer);

    batch.timer = setTimeout(async () => {
      try {
        if (!batch.caption) {
          console.log(`⏳ Received ${batch.images.length} images from "${batch.groupName}", still waiting for caption...`);
          return;
        }

        const parsed = parseCaption(batch.caption);
        if (!parsed) {
          console.log(`⚠️ Could not detect wholesale price in message from "${batch.groupName}". Skipping.`);
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

        // Fast Parallel Image Uploading to CDN (up to 12 images simultaneously)
        const imagesToUpload = batch.images.slice(0, 12);
        console.log(`🚀 Uploading ${imagesToUpload.length} images simultaneously...`);

        const uploadPromises = imagesToUpload.map(buf => uploadImageToCDN(buf));
        const results = await Promise.allSettled(uploadPromises);
        const uploadedUrls = results
          .filter(r => r.status === 'fulfilled' && r.value)
          .map(r => r.value);

        // Abort if all image uploads failed
        if (uploadedUrls.length === 0) {
          console.error(`❌ Image upload failed for "${parsed.title}". Aborting to prevent listing without photos.`);
          return;
        }

        console.log(`🌐 Successfully Uploaded ${uploadedUrls.length} Real Suit Image(s):`, uploadedUrls[0]);

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
          headers: { 'Authorization': `Bearer ${CONFIG.WEBHOOK_TOKEN}` },
          timeout: 25000
        });

        console.log(`🎉 100% POSTED TO trysasta.com & GOOGLE SHEET WITH SUPPLIER: "${batch.groupName}" & ALL DESIGNS!\n`);
      } catch (err) {
        console.error('Batch sync error:', err.message);
      } finally {
        GROUP_BATCHES.delete(fromJid);
      }
    }, 18000);
  });
}

startBot();
