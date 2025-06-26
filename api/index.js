// Import library yang dibutuhkan
const express = require('express');
const multer = require('multer');
const path = require('path');
const { AuthClient, DerivativesApi, BucketsApi, ObjectsApi } = require('aps-sdk-node');

// =================================================================
// LANGKAH DIAGNOSIS: Mencetak environment variables ke log
// =================================================================
console.log('Server function started.');
console.log('Attempting to read environment variables...');
console.log('APS_CLIENT_ID is set:', !!process.env.APS_CLIENT_ID);
// Untuk keamanan, kita hanya akan log beberapa karakter pertama untuk verifikasi
console.log('APS_CLIENT_ID starts with:', process.env.APS_CLIENT_ID ? process.env.APS_CLIENT_ID.substring(0, 4) : 'NOT FOUND');
console.log('APS_BUCKET is set:', !!process.env.APS_BUCKET);
console.log('APS_BUCKET value:', process.env.APS_BUCKET);
// =================================================================

// Konfigurasi dari Environment Variables
const { APS_CLIENT_ID, APS_CLIENT_SECRET, APS_BUCKET } = process.env;

// Periksa apakah variabel penting ada
if (!APS_CLIENT_ID || !APS_CLIENT_SECRET || !APS_BUCKET) {
    console.error('FATAL ERROR: Missing required environment variables (APS_CLIENT_ID, APS_CLIENT_SECRET, or APS_BUCKET).');
    // Jika dijalankan di Vercel, ini akan menyebabkan function crash dan kita akan lihat log di atas
}

const config = {
    client_id: APS_CLIENT_ID,
    client_secret: APS_CLIENT_SECRET,
    bucket: APS_BUCKET ? APS_BUCKET.toLowerCase() : undefined
};

// Inisialisasi Klien APS
const auth = new AuthClient(config.client_id, config.client_secret);
const derivatives = new DerivativesApi(auth);
const buckets = new BucketsApi(auth);
const objects = new ObjectsApi(auth);

// Setup Express App
const app = express();
app.use(express.json());

// Menyajikan file statis dari folder 'www'
app.use(express.static(path.join(__dirname, '..', 'www')));

// Middleware untuk menangani upload file
const upload = multer({ dest: 'uploads/' });

// Route untuk mendapatkan token otentikasi
app.get('/api/auth/token', async (req, res, next) => {
    console.log('Request received for /api/auth/token');
    try {
        const token = await auth.getPublicToken(['viewables:read']);
        console.log('Successfully generated public token.');
        res.json(token);
    } catch (err) {
        console.error('Error in /api/auth/token:', err);
        next(err);
    }
});

// Route untuk mendapatkan daftar model
app.get('/api/models', async (req, res, next) => {
    try {
        await buckets.getBucketDetails(config.bucket);
        const { items } = await objects.getObjects(config.bucket, { limit: 100 });
        res.json(items.map(obj => ({
            name: obj.objectKey,
            urn: Buffer.from(obj.objectId).toString('base64')
        })));
    } catch (err) {
        if (err.statusCode === 404) {
            await buckets.createBucket({ bucketKey: config.bucket, policyKey: 'persistent' });
            res.json([]);
        } else {
            next(err);
        }
    }
});

// ... (sisa kode lainnya tetap sama) ...

// Route untuk mengupload model baru
app.post('/api/models', upload.single('model-file'), async (req, res, next) => {
    const { file } = req;
    if (!file) {
        return res.status(400).send('File tidak ditemukan.');
    }
    try {
        const { objectKey } = await objects.uploadObject(
            config.bucket,
            file.originalname,
            file.size,
            file.path,
            {}
        );
        const job = await derivatives.translate(
            {
                urn: Buffer.from(`urn:adsk.objects:os.object:${config.bucket}/${objectKey}`).toString('base64'),
                type: 'svf',
                views: ['2d', '3d']
            },
            {},
            { 'x-ads-force': true }
        );
        res.json({
            name: file.originalname,
            urn: job.urn
        });
    } catch (err) {
        next(err);
    } finally {
        const fs = require('fs');
        if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
        }
    }
});

// Route untuk memeriksa status translasi model
app.get('/api/models/:urn/status', async (req, res, next) => {
    try {
        const manifest = await derivatives.getManifest(req.params.urn);
        if (manifest) {
            let messages = [];
            if (manifest.derivatives) {
                for (const derivative of manifest.derivatives) {
                    if (derivative.messages) {
                        messages = messages.concat(derivative.messages.filter(msg => msg.message));
                    }
                    if (derivative.children) {
                        for (const child of derivative.children) {
                            if (child.messages) {
                                messages = messages.concat(child.messages.filter(msg => msg.message));
                            }
                        }
                    }
                }
            }
            res.json({ status: manifest.status, progress: manifest.progress, messages });
        } else {
            res.json({ status: 'n/a' });
        }
    } catch (err) {
        next(err);
    }
});

// Middleware untuk menangani error
app.use((err, req, res, next) => {
    console.error("Global Error Handler:", err);
    res.status(err.statusCode || 500).json({ message: err.message || 'Internal Server Error' });
});

// Ekspor aplikasi Express agar Vercel bisa menggunakannya
module.exports = app;
