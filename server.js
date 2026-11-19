const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const Stripe = require('stripe');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// DATELE TALE DE LA PAYPAL
const CLIENT_ID = 'BAAu8R_BEXsln3dPZpZXcNUPuvDBRIIy2b1pStBKBShVkP7KiJcT9N9Cext9CcxOp1sFUFyempEDsrNWdY';
const SECRET_KEY = 'EM-Kcb56gIAj3ouO27BJR5sRz73HhJRhm2E-p4kmG8weNfhYFQz2-0ZC_OuOf0Pd2FTWePyFKEDK6JBb';
const PAYPAL_BASE = 'https://api-m.sandbox.paypal.com';

// STRIPE SECRET KEY (din Environment Variables pe Render)
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

const LOADER_URL = 'https://store-eu-par-2.gofile.io/download/web/d0913c66-6614-4efd-90ae-24644d8ed334/Titan-Performance-Setup.exe';

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

// Funcție helper pentru atribuirea unei chei din keys.json
function atribuieCheieDinStoc(orderRef) {
    const keysFilePath = path.join(__dirname, 'keys.json');
    let keysData = { available: [], used: [] };

    if (fs.existsSync(keysFilePath)) {
        try {
            keysData = JSON.parse(fs.readFileSync(keysFilePath, 'utf8'));
        } catch (e) {
            keysData = { available: [], used: [] };
        }
    }

    if (!keysData.available || keysData.available.length === 0) {
        return { error: 'Stoc epuizat de chei! Contactați administratorul pe Discord.' };
    }

    const assignedKey = keysData.available.shift();
    keysData.used.push({
        key: assignedKey,
        date: new Date().toISOString(),
        orderRef: orderRef
    });
    fs.writeFileSync(keysFilePath, JSON.stringify(keysData, null, 2));

    return {
        assignedKey,
        remainingStock: keysData.available.length
    };
}

// --- RUTE PAGINI ---
app.get('/buy', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'buy.html'));
});

app.get('/buy/:slug', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'buy.html'));
});

// Ruta pentru numărul de comandă nou (folosită la Paysafecard)
app.get('/api/get-order-number', (req, res) => {
    const orderNumber = obtineUrmatorulNumarComanda();
    res.json({ orderNumber });
});

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
        res.status(500).json({ error: 'Eroare la crearea comenzii' });
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
            const keyResult = atribuieCheieDinStoc(orderID);
            if (keyResult.error) {
                return res.json({ success: false, message: keyResult.error });
            }

            const orderNumber = obtineUrmatorulNumarComanda();

            res.json({
                success: true,
                licenseKey: keyResult.assignedKey,
                loaderUrl: LOADER_URL,
                orderNumber,
                remainingStock: keyResult.remainingStock
            });
        } else {
            res.json({ success: false, message: 'Plata nu a fost finalizată.' });
        }
    } catch (error) {
        console.error('Eroare la capturarea plății PayPal:', error);
        res.status(500).json({ error: 'Eroare la capturarea plății' });
    }
});

// --- STRIPE CHECKOUT SESSION & VERIFICATION ---
app.post('/api/create-stripe-session', async (req, res) => {
    if (!stripe) {
        return res.status(500).json({
            success: false,
            message: 'Stripe nu este configurat pe server (lipsește STRIPE_SECRET_KEY).'
        });
    }

    try {
        const origin = req.headers.origin || 'https://titanperformance.xyz';

const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    managed_payments: {
        enabled: false
    },
    line_items: [
        {
            price_data: {
                currency: 'eur',
                product_data: {
                    name: 'Titan Performance — Lifetime License',
                    description: 'Licență Lifetime pentru optimizare PC, Kernel Tweaks, Input Delay & FPS Boost.'
                },
                unit_amount: 500 // 5.00 EUR în cenți
            },
            quantity: 1
        }
    ],
    success_url: `${origin}/?stripe_session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?stripe_canceled=true`
});

        res.json({ success: true, url: session.url, id: session.id });
    } catch (error) {
        console.error('Eroare la crearea sesiunii Stripe:', error);
        res.status(500).json({ success: false, message: 'Nu s-a putut inițializa plata cu cardul prin Stripe.' });
    }
});

app.post('/api/verify-stripe-session', async (req, res) => {
    const { sessionId } = req.body;

    if (!stripe) {
        return res.status(500).json({ success: false, message: 'Stripe nu este configurat pe server.' });
    }

    if (!sessionId) {
        return res.status(400).json({ success: false, message: 'Lipsește ID-ul sesiunii Stripe.' });
    }

    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== 'paid') {
            return res.json({ success: false, message: 'Plata Stripe nu este marcată ca achitată.' });
        }

        // Evităm dubla atribuire de cheie dacă utilizatorul dă refresh pe pagina de succes
        const keysFilePath = path.join(__dirname, 'keys.json');
        let keysData = { available: [], used: [] };
        if (fs.existsSync(keysFilePath)) {
            keysData = JSON.parse(fs.readFileSync(keysFilePath, 'utf8'));
        }

        const alreadyDelivered = (keysData.used || []).find(item => item.orderRef === session.id);
        if (alreadyDelivered) {
            return res.json({
                success: true,
                alreadyDelivered: true,
                licenseKey: alreadyDelivered.key,
                loaderUrl: LOADER_URL,
                customerEmail: session.customer_details?.email || 'Nespecificat',
                sessionId: session.id,
                remainingStock: (keysData.available || []).length
            });
        }

        const keyResult = atribuieCheieDinStoc(session.id);
        if (keyResult.error) {
            return res.json({ success: false, message: keyResult.error });
        }

        const orderNumber = obtineUrmatorulNumarComanda();

        res.json({
            success: true,
            alreadyDelivered: false,
            licenseKey: keyResult.assignedKey,
            loaderUrl: LOADER_URL,
            orderNumber,
            customerEmail: session.customer_details?.email || 'Nespecificat',
            sessionId: session.id,
            remainingStock: keyResult.remainingStock
        });
    } catch (error) {
        console.error('Eroare la verificarea sesiunii Stripe:', error);
        res.status(500).json({ success: false, message: 'Eroare la verificarea plății Stripe.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serverul rulează pe portul ${PORT}`);
});