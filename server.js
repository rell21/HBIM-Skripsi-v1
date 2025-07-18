const express = require('express');
const { PORT } = require('./config.js');

let app = express();
app.use(express.static('wwwroot'));
app.use(require('./routes/auth.js'));
app.use(require('./routes/models.js'));

// Get port from environment or use config
const port = process.env.PORT || PORT;
app.listen(port, function () { 
    console.log(`Server listening on port ${port}...`); 
});

// Export for Vercel
module.exports = app;