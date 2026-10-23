require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const apiRoutes = require('./src/routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'hotel-demo-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { sameSite: 'lax', maxAge: 1000 * 60 * 60 * 4 },
  }),
);

app.use('/api', apiRoutes);
app.use('/hotel-rooms', express.static(path.join(__dirname, 'hotel-rooms')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.listen(PORT, () => {
  console.log(`Hotel booking demo running at http://localhost:${PORT}`);
});
