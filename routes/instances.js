// routes/instances.js

const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

// Helpers para ownership
const { 
  assignInstance, 
  getUserInstances, 
  deleteInstanceOwnership 
} = require('../database/helpers');

// Variables de entorno
const API_URL = process.env.EVOLUTION_API_URL;
const API_KEY = process.env.EVOLUTION_API_KEY;

/* ==========================================================
   UTILIDAD: Obtener nombre seguro de instancia
========================================================== */
const getSafeInstanceName = (inst) =>
  inst?.instance?.instanceName || inst?.instance?.name || inst?.name;

/* ==========================================================
   🔐 MIDDLEWARE: Verificar acceso a la instancia
========================================================== */
async function ensureOwnership(req, instanceName) {
  if (req.user.role === 'admin') return true;

  const myInstances = await getUserInstances(req.user.id);
  return myInstances.includes(instanceName);
}

/* ==========================================================
   1. VER PERFIL
========================================================== */
router.get('/fetch-profile', async (req, res) => {
  const { instanceName } = req.query;
  if (!instanceName)
    return res.status(400).json({ error: 'Falta el nombre de la instancia' });

  // Seguridad
  if (!(await ensureOwnership(req, instanceName)))
    return res.status(403).json({ error: 'No tienes permiso para ver esta instancia' });

  const url = `${API_URL}/chat/fetchProfile/${instanceName}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 
        'apikey': API_KEY,
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({})
    });

    const txt = await response.text();
    let data;
    try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: data.message || 'Error al obtener perfil'
      });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ==========================================================
   2. GET QR
========================================================== */
router.get('/get-qr', async (req, res) => {
  const { instanceName } = req.query;
  if (!instanceName)
    return res.status(400).json({ error: 'Falta el nombre de la instancia' });

  if (!(await ensureOwnership(req, instanceName)))
    return res.status(403).json({ error: 'No tienes permiso para esta instancia' });

  try {
    const response = await fetch(`${API_URL}/instance/connect/${instanceName}`, {
      headers: { apikey: API_KEY }
    });

    const txt = await response.text();
    let data;
    try { data = JSON.parse(txt); } catch { data = { message: txt }; }

    if (!response.ok && !data.base64) {
      return res.status(response.status).json({
        success: false,
        error: data.message || 'Error de API'
      });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ==========================================================
   3. CHECK STATUS
========================================================== */
router.get('/check-status', async (req, res) => {
  const { instanceName } = req.query;
  if (!instanceName)
    return res.status(400).json({ error: 'Falta el nombre de la instancia' });

  if (!(await ensureOwnership(req, instanceName)))
    return res.status(403).json({ error: 'No tienes permiso' });

  try {
    const response = await fetch(`${API_URL}/instance/fetchInstances`, {
      headers: { apikey: API_KEY }
    });

    const instances = await response.json();
    const instance = instances.find(inst =>
      getSafeInstanceName(inst) === instanceName
    );

    if (instance) return res.json(instance);

    // Si no existe aún, consultar estado directo
    const stateRes = await fetch(`${API_URL}/instance/connectionState/${instanceName}`, {
      headers: { apikey: API_KEY }
    });

    const txt = await stateRes.text();
    let state;
    try { state = JSON.parse(txt).state; }
    catch { state = txt.replace(/"/g, ''); }

    res.json({
      instance: {
        instanceName,
        state
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ==========================================================
   4. GET INSTANCES (con filtrado por usuario)
========================================================== */
router.get('/get-instances', async (req, res) => {
  try {
    const response = await fetch(`${API_URL}/instance/fetchInstances`, {
      headers: { apikey: API_KEY }
    });

    let instances = await response.json();

    if (req.user.role === 'admin')
      return res.json(instances);

    const myInstances = await getUserInstances(req.user.id);

    instances = instances.filter(inst =>
      myInstances.includes(getSafeInstanceName(inst))
    );

    res.json(instances);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ==========================================================
   5. DIAGNÓSTICO DE API
========================================================== */
router.get('/test-connection', async (req, res) => {
  try {
    const url = `${API_URL}/instance/fetchInstances`;
    const response = await fetch(url, {
      headers: { apikey: API_KEY }
    });

    res.json({
      success: response.ok,
      status: response.status,
      url,
      hasApiKey: !!API_KEY
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ==========================================================
   6. REINICIAR INSTANCIA
========================================================== */
router.post('/restart-instance', async (req, res) => {
  const { instanceName } = req.query;

  if (!instanceName)
    return res.status(400).json({ error: 'Falta el nombre de la instancia' });

  if (!(await ensureOwnership(req, instanceName)))
    return res.status(403).json({ error: 'No tienes permiso' });

  try {
    const response = await fetch(`${API_URL}/instance/restart/${instanceName}`, {
      method: 'POST',
      headers: { 
        apikey: API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    const txt = await response.text();
    let data;
    try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

    if (!response.ok)
      return res.status(response.status).json({ error: data.message });

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ==========================================================
   7. LOGOUT INSTANCIA (con ownership)
========================================================== */
router.delete('/logout-instance', async (req, res) => {
  const { instanceName } = req.query;

  if (!instanceName)
    return res.status(400).json({ error: 'Falta el nombre de la instancia' });

  if (!(await ensureOwnership(req, instanceName)))
    return res.status(403).json({ error: 'No tienes permiso' });

  try {
    const response = await fetch(`${API_URL}/instance/logout/${instanceName}`, {
      method: 'DELETE',
      headers: { apikey: API_KEY }
    });

    await deleteInstanceOwnership(instanceName); // 🔥 eliminar dueño

    const txt = await response.text();
    let data;
    try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ==========================================================
   8. CREATE INSTANCE (asigna ownership)
========================================================== */
router.post('/create-instance', async (req, res) => {
  const { instanceName } = req.body;

  if (!instanceName)
    return res.status(400).json({ error: 'Falta el nombre de la instancia' });

  try {
    const response = await fetch(`${API_URL}/instance/create`, {
      method: 'POST',
      headers: {
        apikey: API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS'
      })
    });

    const txt = await response.text();
    let data;
    try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

    if (!response.ok)
      return res.status(response.status).json({ error: data.message });

    // 🔥 asignar dueño al creador
    await assignInstance(instanceName, req.user.id);

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;