const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs'); // Kita butuh 'fs' untuk membuat direktori
const { AuthClient, DerivativesApi, BucketsApi, ObjectsApi } = require('aps-sdk-node');

try {
    console.log('Server function started. Attempting to initialize...');

    // --- Konfigurasi dari Environment Variables ---
    const config = {
        client_id: process.env.APS_CLIENT_ID,
        client_secret: process.env.APS_CLIENT_SECRET,
        bucket: process.env.APS_BUCKET ? process.env.APS_BUCKET.toLowerCase() : undefined
    };

    if (!config.client_id || !config.client_secret || !config.bucket) {
        throw new Error('FATAL ERROR: Environment variables are missing.');
    }

    // --- Inisialisasi Klien APS ---
    const auth = new AuthClient(config.client_id, config.client_secret);
    const derivatives = new DerivativesApi(auth);
    const buckets = new BucketsApi(auth);
    const objects = new ObjectsApi(auth);

    // --- Setup Express App ---
    const app = express();
    app.use(express.json());
    app.use(express.static(path.join(__dirname, '..', 'www')));

    // =================================================================
    // INI ADALAH PERBAIKAN KRUSIAL UNTUK VERCEL
    // =================================================================
    const UPLOAD_DIR = '/tmp/uploads';
    if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
    const upload = multer({ dest: UPLOAD_DIR });
    // =================================================================

    // --- Routes ---
    app.get('/api/auth/token', async (req, res, next) => {
        try {
            res.json(await auth.getPublicToken(['viewables:read']));
        } catch (err) { next(err); }
    });

    app.get('/api/models', async (req, res, next) => {
        try {
            await buckets.getBucketDetails(config.bucket);
            const { items } = await objects.getObjects(config.bucket, { limit: 100 });
            res.json(items.map(obj => ({ name: obj.objectKey, urn: Buffer.from(obj.objectId).toString('base64') })));
        } catch (err) {
            if (err.statusCode === 404) {
                await buckets.createBucket({ bucketKey: config.bucket, policyKey: 'persistent' });
                res.json([]);
            } else { next(err); }
        }
    });

    app.post('/api/models', upload.single('model-file'), async (req, res, next) => {
        const { file } = req;
        if (!file) return res.status(400).send('File tidak ditemukan.');
        try {
            const { objectKey } = await objects.uploadObject(config.bucket, file.originalname, file.size, file.path, {});
            const job = await derivatives.translate({ urn: Buffer.from(`urn:adsk.objects:os.object:${config.bucket}/${objectKey}`).toString('base64'), type: 'svf', views: ['2d', '3d'] }, {}, { 'x-ads-force': true });
            res.json({ name: file.originalname, urn: job.urn });
        } catch (err) {
            next(err);
        } finally {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        }
    });
    
    app.get('/api/models/:urn/status', async (req, res, next) => {
        try {
            const manifest = await derivatives.getManifest(req.params.urn);
            if (!manifest) return res.json({ status: 'n/a' });
            let messages = [];
            if (manifest.derivatives) {
                for (const derivative of manifest.derivatives) {
                    if (derivative.messages) messages = messages.concat(derivative.messages.filter(msg => msg.message));
                    if (derivative.children) {
                        for (const child of derivative.children) {
                            if (child.messages) messages = messages.concat(child.messages.filter(msg => msg.message));
                        }
                    }
                }
            }
            res.json({ status: manifest.status, progress: manifest.progress, messages });
        } catch (err) { next(err); }
    });
    
    // --- Error Handler ---
    app.use((err, req, res, next) => {
        console.error("Global Error Handler Caught:", err);
        res.status(err.statusCode || 500).json({ message: err.message || 'Internal Server Error' });
    });

    module.exports = app;

} catch (err) {
    console.error('!!! CRITICAL INITIALIZATION ERROR !!!', err);
    const dummyApp = express();
    dummyApp.get('*', (req, res) => res.status(500).send(`Server failed to initialize: ${err.message}`));
    module.exports = dummyApp;
}
