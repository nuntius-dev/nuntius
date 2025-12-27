// routes/contacts.js
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
const { google } = require('googleapis');
const router = express.Router();

// Importar configuración de seguridad y entorno
const API_URL = process.env.EVOLUTION_API_URL;
const API_KEY = process.env.EVOLUTION_API_KEY;
const KEY_FILE_PATH = path.join(process.cwd(), 'credentials.json');
const CONTACTS_FILE_PATH = path.join(process.cwd(), 'data', 'contacts.json');
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

// --- Helpers de Archivo ---
async function writeContacts(data) {
  try {
    await fs.writeFile(CONTACTS_FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error escritura:', error);
    throw new Error('Error al guardar contactos');
  }
}

async function readContacts() {
  let data;
  try {
    const fileContent = await fs.readFile(CONTACTS_FILE_PATH, 'utf8');
    data = JSON.parse(fileContent);
  } catch (error) {
    if (error.code === 'ENOENT') {
      const initialData = { contactos: [] };
      await fs.mkdir(path.dirname(CONTACTS_FILE_PATH), { recursive: true });
      await fs.writeFile(CONTACTS_FILE_PATH, JSON.stringify(initialData, null, 2));
      return initialData;
    }
    throw new Error('Error al leer contactos');
  }
  if (!data.contactos) data.contactos = [];
  return data;
}

// --- Endpoints Auxiliares ---
router.get('/paises', async (req, res) => {
  try {
    const data = await fs.readFile(path.join(process.cwd(), 'data', 'paises.json'), 'utf8');
    const paises = JSON.parse(data).map(p => ({ name: p.nameES, dial_code: `+${p.phoneCode}`, code: p.iso2 }));
    res.json(paises);
  } catch (error) { res.status(500).json({ error: 'Error paises' }); }
});

// ==========================================
// 🔐 CRUD Contactos (PROTEGIDO POR USUARIO)
// ==========================================

// GET: Solo trae los contactos del usuario logueado
router.get('/contacts', async (req, res) => {
  try { 
    const data = await readContacts(); 
    
    // Si es admin, ve todo. Si es usuario, solo lo suyo.
    if (req.user.role === 'admin') {
        res.json(data);
    } else {
        const myContacts = data.contactos.filter(c => c.ownerId === req.user.id);
        res.json({ ...data, contactos: myContacts });
    }
  } 
  catch (error) { res.status(500).json({ error: error.message }); }
});

// POST: Crea contacto asignado al usuario
router.post('/contacts', async (req, res) => {
  try {
    const { nombre, telefono, fecha = "", estado = "IMPAGA", notas = "", monto = "", enviado = false } = req.body;
    if (!nombre || !telefono) return res.status(400).json({ error: 'Faltan datos' });
    
    const data = await readContacts();
    
    const newContact = {
      id: Date.now().toString(), 
      ownerId: req.user.id, // 👈 ASIGNACIÓN DE DUEÑO
      nombre, 
      telefono, 
      fechaNacimiento: fecha,
      monto, 
      enviado, 
      notas, 
      fechaCreacion: new Date().toISOString(),
      etiquetas: [estado.toUpperCase()], 
      historialAtencion: [], 
      historialMensajes: []
    };
    
    data.contactos.push(newContact);
    await writeContacts(data);
    res.status(201).json(newContact);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// PUT: Edita solo si eres el dueño
router.put('/contacts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, telefono, fecha, estado, notas, monto, enviado } = req.body;
    
    const data = await readContacts();
    const idx = data.contactos.findIndex(c => c.id === id);
    
    if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
    
    // Verificar propiedad
    const contact = data.contactos[idx];
    if (req.user.role !== 'admin' && contact.ownerId !== req.user.id) {
        return res.status(403).json({ error: 'No tienes permiso para editar este contacto' });
    }

    data.contactos[idx] = {
      ...contact, 
      nombre, 
      telefono,
      fechaNacimiento: fecha || contact.fechaNacimiento,
      monto: monto !== undefined ? monto : contact.monto,
      enviado: enviado !== undefined ? enviado : contact.enviado,
      notas: notas || contact.notas,
      etiquetas: [estado.toUpperCase()] || contact.etiquetas,
    };
    
    await writeContacts(data);
    res.json(data.contactos[idx]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// DELETE: Borra solo si eres el dueño
router.delete('/contacts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = await readContacts();
    
    const contact = data.contactos.find(c => c.id === id);
    if (!contact) return res.status(404).json({ error: 'No encontrado' });

    // Verificar propiedad
    if (req.user.role !== 'admin' && contact.ownerId !== req.user.id) {
        return res.status(403).json({ error: 'No tienes permiso para borrar este contacto' });
    }

    data.contactos = data.contactos.filter(c => c.id !== id);
    await writeContacts(data);
    res.status(200).json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// DELETE BULK: Borrado masivo seguro
router.post('/contacts/delete-bulk', async (req, res) => {
  try {
    const { ids } = req.body; 
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'Se requiere array de IDs' });
    
    const data = await readContacts();
    const inicial = data.contactos.length;
    
    // Filtramos: Mantenemos los que NO están en la lista de borrar
    // O los que SÍ están en la lista pero NO pertenecen al usuario (seguridad)
    data.contactos = data.contactos.filter(c => {
        const seQuiereBorrar = ids.includes(c.id);
        const esMio = c.ownerId === req.user.id || req.user.role === 'admin';
        
        if (seQuiereBorrar && esMio) return false; // Borrar
        return true; // Mantener
    });
    
    await writeContacts(data);
    res.json({ success: true, eliminados: inicial - data.contactos.length });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// DELETE ALL: Borra SOLO los contactos del usuario
router.delete('/contacts-all', async (req, res) => {
  try {
    const data = await readContacts();
    
    if (req.user.role === 'admin') {
        data.contactos = []; // Admin borra todo el sistema
    } else {
        // Usuario borra solo los suyos, mantenemos los de otros
        data.contactos = data.contactos.filter(c => c.ownerId !== req.user.id);
    }
    
    await writeContacts(data);
    res.json({ success: true, message: 'Tus contactos han sido eliminados' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// CHECK NUMBER (Sin cambios, pero usa instanceName)
router.post('/check-number', async (req, res) => {
  let { instanceName, number } = req.body;
  if (!instanceName || !number) return res.status(400).json({ error: 'Faltan datos' });
  number = String(number).replace(/\D/g, ''); 
  try {
    const response = await fetch(`${API_URL}/chat/whatsappNumbers/${instanceName}`, {
      method: 'POST', headers: { 'apikey': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ numbers: [number] })
    });
    const data = await response.json();
    const info = Array.isArray(data) ? data[0] : data;
    if (!info) throw new Error('API vacía');
    res.json({ success: true, exists: info.exists, jid: info.jid, number: info.number, name: info.name });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ========================================================
// 🔥 IMPORTACIÓN CORREGIDA (Soporta ENV y Archivo) 🔥
// ========================================================
router.post('/import-from-sheet', async (req, res) => {
  try {
    let { sheetId, range, defaultCode } = req.body;
    if (!sheetId || !range) return res.status(400).json({ error: 'Falta datos' });

    // 🟢 AQUÍ ESTÁ LA MAGIA: DETECTOR INTELIGENTE
    let auth;
    
    // 1. Intentamos leer desde VARIABLE DE ENTORNO (Para EasyPanel/Server)
    if (process.env.GOOGLE_JSON) {
        console.log("📝 Usando credenciales desde Variable de Entorno (GOOGLE_JSON)");
        try {
            const credentials = JSON.parse(process.env.GOOGLE_JSON);
            auth = new google.auth.GoogleAuth({
                credentials,
                scopes: SCOPES
            });
        } catch (e) {
            console.error("Error parseando GOOGLE_JSON:", e);
            throw new Error("Variable GOOGLE_JSON inválida");
        }
    } 
    // 2. Si no, intentamos leer desde ARCHIVO (Para Localhost)
    else {
        console.log("📂 Usando credenciales desde Archivo (credentials.json)");
        auth = new google.auth.GoogleAuth({
            keyFile: KEY_FILE_PATH,
            scopes: SCOPES
        });
    }

    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
    const rows = response.data.values;
    if (!rows || rows.length < 2) return res.status(400).json({ error: 'La hoja está vacía o sin cabeceras' });

    // Procesamiento de datos...
    const originalHeaders = [...rows[0]]; 
    const clean = (h) => String(h||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '');
    rows.shift(); 
    
    const headers = originalHeaders.map(clean);
    const map = { nombre: -1, telefono: -1, fecha: -1, estado: -1, monto: -1, enviado: -1, otros: [] };
    
    headers.forEach((h, i) => {
      if (map.nombre === -1 && h.includes('nombre')) map.nombre = i;
      else if (map.telefono === -1 && (h.includes('telefono') || h.includes('numero') || h.includes('celular'))) map.telefono = i;
      else if (map.fecha === -1 && h.includes('fecha')) map.fecha = i;
      else if (map.estado === -1 && h.includes('estado')) map.estado = i;
      else if (map.monto === -1 && (h.includes('monto') || h.includes('valor'))) map.monto = i;
      else if (map.enviado === -1 && (h.includes('enviado') || h.includes('envio'))) map.enviado = i;
      else map.otros.push({ i, name: originalHeaders[i] });
    });

    if (map.nombre === -1 || map.telefono === -1) {
        return res.status(400).json({ error: 'No se encontraron las columnas "Nombre" o "Teléfono"' });
    }

    const data = await readContacts();
    let count = 0;

    for (const row of rows) {
      const nombre = row[map.nombre];
      let telRaw = row[map.telefono];
      if (!nombre || !telRaw) continue;

      let telefonoLimpio = String(telRaw).replace(/\D/g, '');
      if (defaultCode && defaultCode.length > 0) {
        if (!telefonoLimpio.startsWith(defaultCode) && telefonoLimpio.length <= 11) {
           telefonoLimpio = defaultCode + telefonoLimpio;
        }
      }

      const monto = (map.monto !== -1) ? row[map.monto] : "";
      let enviado = false;
      if (map.enviado !== -1) {
          const val = String(row[map.enviado] || "").toLowerCase().trim();
          enviado = (val === 'si' || val === 'true' || val === '1');
      }
      const estado = (map.estado !== -1) ? (row[map.estado] || "IMPAGA") : "IMPAGA";
      let notasArr = [];
      map.otros.forEach(o => { if(row[o.i]) notasArr.push(`${o.name}: ${row[o.i]}`); });

      data.contactos.push({
        id: Date.now().toString() + '-' + count,
        ownerId: req.user.id,
        nombre: String(nombre), telefono: telefonoLimpio,
        fechaNacimiento: (map.fecha !== -1) ? row[map.fecha] : "",
        monto: monto, enviado: enviado, notas: notasArr.join('; '),
        etiquetas: [String(estado).toUpperCase()],
        fechaCreacion: new Date().toISOString(),
        historialAtencion: [], historialMensajes: []
      });
      count++;
    }
    await writeContacts(data);
    res.status(201).json({ success: true, message: `Importados ${count} contactos exitosamente.` });

  } catch (error) {
    console.error('🔥 Error CRÍTICO Importación:', error);
    // Mensaje de error detallado para el frontend
    const msg = error.message.includes('ENOENT') ? 'Faltan las credenciales de Google en el servidor.' : error.message;
    res.status(500).json({ error: msg });
  }
});

module.exports = router;
