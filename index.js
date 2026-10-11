/**
 * TRY SASTA - WhatsApp Phone Number Pairing (NO QR NEEDED)
 */
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');

// APNA WHATSAPP NUMBER YAHAN LIKHEIN (Without + sign, e.g. 923056387607)
const MY_PHONE_NUMBER = process.env.PHONE_NUMBER || "923056387607"; 

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  if (!sock.authState.creds.registered) {
    setTimeout(async () => {
      const code = await sock.requestPairingCode(MY_PHONE_NUMBER);
      console.log("\n=================================================");
      console.log(`🔑 AAPKA 8-DIGIT PAIRING CODE:  >>>  ${code}  <<<`);
      console.log("Mobile me WhatsApp kholain -> Linked Devices -> Link with phone number instead -> Yeh code enter karein!");
      console.log("=================================================\n");
    }, 4000);
  }

  sock.ev.on('connection.update', (update) => {
    if (update.connection === 'open') {
      console.log("🎉 BINGO! WhatsApp Connected Successfully without QR Code!");
    }
  });
}
startBot();
