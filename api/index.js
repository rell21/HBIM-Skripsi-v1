const path = require('path');
const express = require('express');
const { AuthenticationClient } = require('autodesk-forge-tools');

const app = express();
const { APS_CLIENT_ID, APS_CLIENT_SECRET } = process.env;
const auth = new AuthenticationClient(APS_CLIENT_ID, APS_CLIENT_SECRET);

// Perubahan Kritis 3: Menggunakan path.join untuk path yang robust
// __dirname di dalam Vercel menunjuk ke /var/task/api, jadi kita perlu naik dua level
// untuk mencapai root proyek di mana folder 'www' berada.
app.use(express.static(path.join(__dirname, '../../www')));

app.get('/api/auth/token', async (req, res) => {
    try {
        const credentials = await auth.getPublicToken();
        res.json(credentials);
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

// Perubahan Kritis 1: Hapus app.listen()
// app.listen(PORT, function () {
//     console.log(`Server listening on port ${PORT}...`);
// });

// Perubahan Kritis 2: Ekspor aplikasi Express
module.exports = app;