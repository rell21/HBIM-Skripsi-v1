// Menggunakan sintaks 'require' karena ini adalah lingkungan backend Node.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const { AuthClient, DerivativesApi, BucketsApi, ObjectsApi } = require('aps-sdk-node');
const { SvfReader, GltfWriter } = require('autodesk-forge-tools');

// Konfigurasi dari Environment Variables (aman untuk Vercel)
const { APS_CLIENT_ID, APS_CLIENT_SECRET, APS_BUCKET } = process.env;
if (!APS_CLIENT_ID || !APS_CLIENT_SECRET || !APS_BUCKET) {
    console.error('Variabel lingkungan APS_CLIENT_ID, APS_CLIENT_SECRET, atau APS_BUCKET tidak diatur.');
    process.exit(1);
}

const config = {
    client_id: APS_CLIENT_ID,
    client_secret: APS_CLIENT_SECRET,
    bucket: APS_BUCKET.toLowerCase()
};

// Inisialisasi Klien APS
const auth = new AuthClient(config.client_id, config.client_secret);
const derivatives = new DerivativesApi(auth);
const buckets = new BucketsApi(auth);
const objects = new ObjectsApi(auth);

// Setup Express App
const app = express();
app.use(express.json());

// PENTING: Menyajikan file statis dari folder 'www'
// Vercel akan menempatkan folder 'www' di root saat build
// path.join(__dirname, '..', 'www') menavigasi dari /api ke /www
app.use(express.static(path.join(__dirname, '..', 'www')));


// Middleware untuk menangani upload file
const upload = multer({ dest: 'uploads/' });

// Route untuk mendapatkan token otentikasi
app.get('/api/auth/token', async (req, res, next) => {
    try {
        res.json(await auth.getPublicToken(['viewables:read']));
    } catch (err) {
        next(err);
    }
});

// Route untuk mendapatkan daftar model
app.get('/api/models', async (req, res, next) => {
    try {
        await buckets.getBucketDetails(config.bucket); // Pastikan bucket ada
        const { items } = await objects.getObjects(config.bucket, { limit: 100 });
        res.json(items.map(obj => ({
            name: obj.objectKey,
            urn: Buffer.from(obj.objectId).toString('base64')
        })));
    } catch (err) {
        if (err.statusCode === 404) { // Jika bucket tidak ditemukan, buat bucket baru
            await buckets.createBucket({ bucketKey: config.bucket, policyKey: 'persistent' });
            res.json([]);
        } else {
            next(err);
        }
    }
});

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
            {}, // xAdsHeaders
            { 'x-ads-force': true } // force re-translation
        );
        res.json({
            name: file.originalname,
            urn: job.urn
        });
    } catch (err) {
        next(err);
    } finally {
        require('fs').unlinkSync(file.path);
    }
});


// Route untuk memeriksa status translasi model
// INI BAGIAN YANG DIPERBAIKI DARI ERROR SEBELUMNYA
app.get('/api/models/:urn/status', async (req, res, next) => {
    try {
        const manifest = await derivatives.getManifest(req.params.urn);
        if (manifest) {
            let messages = []; // <-- Kesalahan ada di sini, harus diinisialisasi sebagai array kosong
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
    console.error(err);
    res.status(err.statusCode || 500).json({ message: err.message || 'Internal Server Error' });
});

// Ekspor aplikasi Express agar Vercel bisa menggunakannya
module.exports = app;
