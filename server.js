const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// DATELE TALE DE LA PAYPAL
const CLIENT_ID = 'BAAu8R_BEXsln3dPZpZXcNUPuvDBRIIy2b1pStBKBShVkP7KiJcT9N9Cext9CcxOp1sFUFyempEDsrNWdY';
const SECRET_KEY = 'EM-Kcb56gIAj3ouO27BJR5sRz73HhJRhm2E-p4kmG8weNfhYFQz2-0ZC_OuOf0Pd2FTWePyFKEDK6JBb';
const PAYPAL_BASE = 'https://api-m.sandbox.paypal.com';

// WEBHOOK-UL TĂU UNIC (WEBSITE LOGS)
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1572719929952567437/vtj9SZtYKXKD_elvHnvJilFfO_Rm9NG-XzTiKqup3LfwzEqd2fKNyOQUoQPsp9jO8M7Q';

// Funcție helper pentru numărătoarea comenzilor (de la 1 în sus)
function obtineUrmatorulNumarComanda() {
    const counterPath = path.join(__dirname, 'counter.json');
    let counterData = { currentOrder: 0 };
    
    if (fs.existsSync(counterPath)) {
        try {
            counterData = JSON.parse(fs.readFileSync(counterPath, 'utf8'));
        } catch (e) {
            counterData = { currentOrder: 0 };
        }
    }
    
    counterData.currentOrder += 1;
    fs.writeFileSync(counterPath, JSON.stringify(counterData, null, 2));
    return counterData.currentOrder;
}

// --- PAYPAL TOKEN & ORDERS ---
async function getPayPalAccessToken() {
    const auth = Buffer.from(`${CLIENT_ID}:${SECRET_KEY}`).toString('base64');
    const response = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
        method: 'POST',
        body: 'grant_type=client_credentials',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });
    const data = await response.json();
    return data.access_token;
}

app.post('/api/create-order', async (req, res) => {
    try {
        const accessToken = await getPayPalAccessToken();
        const response = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                intent: 'CAPTURE',
                purchase_units: [{ amount: { currency_code: 'EUR', value: '5.00' } }]
            })
        });
        const order = await response.json();
        res.json(order);
    } catch (error) {
        res.status(500).json({ error: "Eroare la crearea comenzii" });
    }
});

app.post('/api/capture-order', async (req, res) => {
    const { orderID } = req.body;
    try {
        const accessToken = await getPayPalAccessToken();
        const response = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderID}/capture`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        const captureData = await response.json();
        
        if (captureData.status === 'COMPLETED') {
            const orderNumber = obtineUrmatorulNumarComanda();

            const keysFilePath = path.join(__dirname, 'keys.json');
            let keysData = { available: [], used: [] };
            
            if (fs.existsSync(keysFilePath)) {
                keysData = JSON.parse(fs.readFileSync(keysFilePath, 'utf8'));
            }

            if (!keysData.available || keysData.available.length === 0) {
                return res.json({ success: false, message: "Stoc epuizat de chei! Contactați administratorul pe Discord." });
            }

            const assignedKey = keysData.available.shift();
            keysData.used.push({ key: assignedKey, date: new Date().toISOString(), orderID: orderID });
            fs.writeFileSync(keysFilePath, JSON.stringify(keysData, null, 2));

            const loaderLink = "https://titanperformance.xyz/download/loader.exe";

            await fetch(DISCORD_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: "@everyone",
                    allowed_mentions: { parse: ["everyone"] },
                    embeds: [{
                        title: `⚡ Comandă Nouă PayPal #${orderNumber} Confirmată!`,
                        color: 3447003,
                        fields: [
                            { name: "🔢 Număr Comandă", value: `#${orderNumber}`, inline: true },
                            { name: "💳 Metodă", value: "PayPal (Instant API)", inline: true },
                            { name: "🆔 ID Plată PayPal", value: `\`${orderID}\``, inline: false },
                            { name: "🔑 Cheie Atribuită", value: `\`${assignedKey}\``, inline: false },
                            { name: "📦 Stoc Rămas", value: `${keysData.available.length} chei disponibile`, inline: true }
                        ],
                        timestamp: new Date()
                    }]
                })
            });

            res.json({ success: true, licenseKey: assignedKey, loaderUrl: loaderLink });
        } else {
            res.json({ success: false, message: "Plata nu a fost finalizată." });
        }
    } catch (error) {
        console.error("Eroare la capturarea plății:", error);
        res.status(500).json({ error: "Eroare la capturarea plății" });
    }
});

// --- PAYSAFE ORDER & DISCORD WEBHOOK (TRIMITE ÎN ACELAȘI WEBHOOK) ---
app.post('/api/paysafe-order', async (req, res) => {
    const { code, country, email, discordText } = req.body;

    try {
        const orderNumber = obtineUrmatorulNumarComanda();

        await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: "@everyone",
                allowed_mentions: { parse: ["everyone"] },
                embeds: [{
                    title: `🎫 Comandă Nouă - Paysafecard #${orderNumber}`,
                    color: 16776960,
                    fields: [
                        { name: "🔢 Număr Comandă", value: `#${orderNumber}`, inline: true },
                        { name: "💵 Sumă", value: "24.99 RON / 5 EUR", inline: true },
                        { name: "👤 Discord / Nume Client", value: `\`${discordText || 'Nespecificat'}\``, inline: false },
                        { name: "📧 Email Contact", value: `\`${email}\``, inline: false },
                        { name: "🌍 Țară", value: country, inline: true },
                        { name: "🔑 Cod Paysafecard", value: `\`\`\`${code}\`\`\``, inline: false },
                        { name: "⚠️ Mențiune", value: "Clientul a fost informat despre taxele de exchange pentru sume greșite.", inline: false }
                    ],
                    timestamp: new Date()
                }]
            })
        });

        res.json({ success: true });
    } catch (error) {
        console.error("Eroare webhook:", error);
        res.status(500).json({ success: false, message: "Eroare internă." });
    }
});

app.listen(3000, () => {
    console.log('Serverul rulează pe http://localhost:3000');
});