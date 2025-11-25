// ==========================================
//  🌐 NUNTIUS SERVER - SERVER.JS FINAL
// ==========================================

require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs').promises;

// ---------------- AUTH -------------------
const session = require('express-session');
const cookieParser = require('cookie-parser');
const passport = require('passport');
require('./config/passport');
const { isAuthenticated, isAdmin } = require('./middleware/auth');

// Scheduler
let checkRecordatorios;
try { checkRecordatorios = require('./scheduler'); } 
catch (e) { checkRecordatorios = () => {}; }

const app = express();
app.set('trust proxy', 1);
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_URL = process.env.EVOLUTION_API_URL;
const API_KEY = process.env.EVOLUTION_API_KEY;

// ==========================================
// MIDDLEWARES DE AUTENTICACIÓN
// ==========================================
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// ==========================================
// RUTAS DE AUTENTICACIÓN (PÚBLICAS)
// ==========================================
app.use('/auth', require('./routes/auth'));

// RUTA ADMIN API
try {
  app.use('/api/admin', isAuthenticated, isAdmin, require('./routes/admin'));
} catch (e) {
  console.log("⚠️  Ruta admin no encontrada");
}

// ==========================================
// 🚦 PROTECCIÓN LOGIN
// ==========================================
app.get('/login.html', (req, res, next) => {
  if (req.isAuthenticated()) {
    return res.redirect('/');
  }
  next();
});

// ==========================================
// ARCHIVOS ESTÁTICOS
// ==========================================
app.use(express.static('public'));

// ==========================================
// RUTAS HTML (PROTEGIDAS)
// ==========================================
app.get('/', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/admin.html', isAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

app.get('/recordatorios.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'recordatorios.html'));
});

app.get('/contactos.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'contactos.html'));
});

// ==========================================
// API PROTEGIDA
// ==========================================
try { app.use('/api', isAuthenticated, require('./routes/contacts')); } catch (e) {}
try { app.use('/api', isAuthenticated, require('./routes/recordatorios')); } catch (e) {}
try { app.use('/api', isAuthenticated, require('./routes/instances')); } catch (e) {}

// ==========================================
// ENDPOINT → INFORMACIÓN BÁSICA DE USUARIO
// ==========================================
app.get('/api/me', isAuthenticated, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    name: req.user.name,
    picture: req.user.picture, // 🔥 ENVIAR FOTO
    role: req.user.role
  });
});

// ==========================================
// ENDPOINT → PERFIL EXTENDIDO
// ==========================================
app.get('/api/me/profile', isAuthenticated, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    name: req.user.name,
    role: req.user.role,
    picture: req.user.picture || req.user.avatar || null,
    givenName: req.user.givenName || null,
    familyName: req.user.familyName || null
  });
});

// ==========================================
// ENDPOINT → LOGOUT
// ==========================================
app.post('/api/logout', (req, res) => {
  req.logout(err => {
    if (err) return res.status(500).json({ success: false, error: 'Error al cerrar sesión' });

    req.session.destroy(err => {
      if (err) return res.status(500).json({ success: false, error: 'Error al destruir sesión' });

      res.clearCookie('connect.sid');
      res.json({ success: true, message: 'Sesión cerrada correctamente' });
    });
  });
});

// ==========================================
// ENDPOINT → FOTO Y PERFIL COMPLETO
// ==========================================
app.post('/api/foto', isAuthenticated, async (req, res) => {
  let { instance, number } = req.body;
  
  try {
    if (!number || number === '--' || number === 'undefined') {
      try {
        const stateRes = await fetch(`${API_URL}/instance/connectionState/${instance}`, {
          headers: { 'apikey': API_KEY }
        });
        const stateData = await stateRes.json();

        const rawOwner = stateData.instance?.owner || stateData.owner;
        
        if (rawOwner) {
          number = String(rawOwner).split('@')[0].replace(/\D/g, '');
        } else {
          return res.json({ picture: null, name: instance });
        }

      } catch (e) {
        return res.json({ picture: null, error: "Error detectando número" });
      }
    }

    number = number.replace(/\D/g, '');

    const response = await fetch(`${API_URL}/chat/fetchProfile/${instance}`, {
      method: "POST",
      headers: { 
        "apikey": API_KEY, 
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ number })
    });

    if (!response.ok) throw new Error("Error en Evolution API");

    const data = await response.json();

    const profileData = {
      picture: data.picture || data.profilePictureUrl || data.image || null,
      numberExists: data.numberExists !== false,
      name: data.name || data.pushName || data.verifiedName || null,
      status: data.description || data.status?.status || null,
      isBusiness: data.isBusiness || false,
      businessEmail: data.email || null,
      businessWebsite: Array.isArray(data.website) ? data.website[0] : data.website,
      businessAddress: data.address || null,
      businessCategory: data.category || null,
      businessDescription: data.description || null,
      realNumber: number
    };

    res.json(profileData);

  } catch (err) {
    console.error("❌ Error en /api/foto:", err.message);
    res.status(500).json({ 
      error: "Error interno al obtener perfil",
      details: err.message,
      picture: null 
    });
  }
});

// ==========================================
// ENDPOINT → ENVIAR MENSAJE
// ==========================================
app.post('/api/send-message', isAuthenticated, async (req, res) => {
  try {
    const { instanceName, number, message } = req.body;
    const clean = number.replace(/\D/g, '');

    const response = await fetch(`${API_URL}/message/sendText/${instanceName}`, {
      method: 'POST',
      headers: { 'apikey': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: clean, text: message })
    });

    const data = await response.json();
    res.json({ success: true, data });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// SCHEDULER
// ==========================================
if (typeof checkRecordatorios === 'function') {
  checkRecordatorios();
  setInterval(() => checkRecordatorios(), 60000);
}

// ==========================================
// SERVIDOR LISTO
// ==========================================
app.listen(PORT, async () => {
  console.log("\n==============================================");
  console.log("🚀 NUNTIUS SERVER LISTO");
  console.log("==============================================");
  console.log(`🌐 http://localhost:${PORT}`);
  console.log(`🔌 Evolution URL: ${API_URL}`);
  console.log(`🔑 API Key: ${API_KEY ? API_KEY.slice(0, 8) + '...' : 'NO CONFIGURADA'}`);
  console.log(`📂 Archivos protegidos movidos a: /views`);
});

// ==========================================
// MANEJO GLOBAL DE ERRORES
// ==========================================
process.on('SIGINT', () => {
  console.log('\n🛑 Servidor detenido por el usuario.');
  process.exit(0);
});

process.on('uncaughtException', err => {
  console.error('❌ ERROR NO MANEJADO:', err);
});

process.on('unhandledRejection', reason => {
  console.error('⚠️ PROMESA NO MANEJADA:', reason);
});

