import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import express from 'express';

const app = express();
app.use(express.json());

let sock = null;
let latestQrCode = null;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        // Removed the deprecated printQRInTerminal property
        browser: ['BUYSELL Engine', 'Chrome', '114.0.0.0'],
        connectTimeoutMs: 60000, // Extend timeout threshold to handle slow proxy layers
        keepAliveIntervalMs: 30000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // Cache the raw text QR string when sent by WhatsApp
        if (qr) {
            latestQrCode = qr;
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`[BRIDGE] Connection dropped (${statusCode}). Attempting recovery...`);
            
            // Wait 5 seconds before bouncing back to avoid immediate spam flagging
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            latestQrCode = null; // Clear QR cache when securely authorized
            console.log('🚀 BUYSELL WhatsApp Bridge is officially online and linked!');
        }
    });
}

// 🌐 NEW USER-FACING ENDPOINT: View QR Code in your phone's browser
app.get('/qr', (req, res) => {
    if (!latestQrCode) {
        if (sock?.user) return res.send('<h3>✅ Already connected and active!</h3>');
        return res.send('<h3>🔄 Generating WhatsApp key matrix... Refresh in 5 seconds.</h3>');
    }
    
    // Inject a Google API rendering link to display the QR visually as an image element
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x320&data=${encodeURIComponent(latestQrCode)}`;
    res.send(`
        <div style="text-align:center; margin-top:10%;">
            <h2>Scan to Link BUYSELL Nigeria Profile</h2>
            <img src="${qrImageUrl}" alt="WhatsApp QR Code" style="border: 4px solid #000; border-radius: 12px; padding: 10px;" />
            <p>Open WhatsApp -> Linked Devices -> Scan Code</p>
            <script>setTimeout(() => window.location.reload(), 15000);</script>
        </div>
    `);
});

// Outbound Message Dispatch Processing Loop
app.post('/send-alert', async (req, res) => {
    const { to, name, message, chatPartnerId } = req.body;
    if (!sock || latestQrCode) return res.status(503).json({ error: 'WhatsApp engine not authorized yet. Visit /qr to sign in.' });

    try {
        const formattedJid = `${to}@s.whatsapp.net`;
        const textTemplate = `✉️ *New Message on BUYSELL Nigeria!*\n\nYou received a new message from *${name}* regarding your listing.\n\n*Message:* "${message}"\n\n👉 *Reply instantly here:* https://buysell-markerplace.com?chat=${chatPartnerId}`;
        
        await sock.sendMessage(formattedJid, { text: textTemplate });
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 9999;
app.listen(PORT, () => {
    console.log(`Server monitoring endpoint pipelines on port ${PORT}`);
    connectToWhatsApp();
});
