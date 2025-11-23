// routes/recordatorios.js
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const router = express.Router();

// Archivos JSON
const RECORDATORIOS_FILE = path.join(process.cwd(), 'data', 'recordatorios.json');
const PLANTILLAS_FILE = path.join(process.cwd(), 'data', 'plantillas.json');

// --- HELPERS ---

async function readJSON(filePath, defaultData) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(defaultData, null, 2));
      return defaultData;
    }
    throw error;
  }
}

async function writeJSON(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function calcularProximoEnvio(tipo, diaEnvio, horaEnvio) {
  const ahora = new Date();
  if (!horaEnvio) return null;
  
  const [hora, minuto] = horaEnvio.split(':').map(Number);

  if (tipo === 'semanal') {
    const diasSemana = { 'lunes': 1, 'martes': 2, 'miercoles': 3, 'jueves': 4, 'viernes': 5, 'sabado': 6, 'domingo': 0 };
    const diaObjetivo = diasSemana[diaEnvio.toLowerCase()];
    const diaActual = ahora.getDay();
    
    let diasHasta = diaObjetivo - diaActual;
    if (diasHasta < 0 || (diasHasta === 0 && (ahora.getHours() > hora || (ahora.getHours() === hora && ahora.getMinutes() >= minuto)))) {
      diasHasta += 7;
    }
    
    const proxima = new Date(ahora);
    proxima.setDate(ahora.getDate() + diasHasta);
    proxima.setHours(hora, minuto, 0, 0);
    return proxima.toISOString();
  }

  if (tipo === 'mensual') {
    const proxima = new Date(ahora);
    let nuevoMes = proxima.getMonth() + 1;
    proxima.setMonth(nuevoMes);
    proxima.setHours(hora, minuto, 0, 0);
    return proxima.toISOString();
  }

  return null;
}

// ============================================
// 📝 ENDPOINTS DE PLANTILLAS (Multi-Tenant)
// ============================================

// GET - Listar (Solo las mías)
router.get('/recordatorios/plantillas', async (req, res) => {
  try {
    const data = await readJSON(PLANTILLAS_FILE, { plantillas: [] });
    
    if (req.user.role === 'admin') {
        res.json(data.plantillas);
    } else {
        const misPlantillas = data.plantillas.filter(p => p.ownerId === req.user.id);
        res.json(misPlantillas);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST - Crear (Asignar dueño)
router.post('/recordatorios/plantillas', async (req, res) => {
  try {
    const { nombre, mensaje } = req.body;
    if (!nombre || !mensaje) return res.status(400).json({ error: 'Faltan datos' });

    const data = await readJSON(PLANTILLAS_FILE, { plantillas: [] });
    
    const nueva = { 
        id: `plt_${Date.now()}`, 
        ownerId: req.user.id, // 🔥 Dueño
        nombre, 
        mensaje, 
        fechaCreacion: new Date().toISOString() 
    };

    data.plantillas.push(nueva);
    await writeJSON(PLANTILLAS_FILE, data);
    res.status(201).json(nueva);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT - Editar (Verificar dueño)
router.put('/recordatorios/plantillas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, mensaje } = req.body;
    const data = await readJSON(PLANTILLAS_FILE, { plantillas: [] });
    const idx = data.plantillas.findIndex(p => p.id === id);

    if (idx === -1) return res.status(404).json({ error: 'No encontrada' });

    // Verificar permisos
    if (req.user.role !== 'admin' && data.plantillas[idx].ownerId !== req.user.id) {
        return res.status(403).json({ error: 'No tienes permiso' });
    }

    data.plantillas[idx] = { ...data.plantillas[idx], nombre, mensaje };
    await writeJSON(PLANTILLAS_FILE, data);
    res.json(data.plantillas[idx]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE - Eliminar (Verificar dueño)
router.delete('/recordatorios/plantillas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = await readJSON(PLANTILLAS_FILE, { plantillas: [] });
    
    const plantilla = data.plantillas.find(p => p.id === id);
    if (!plantilla) return res.status(404).json({ error: 'No encontrada' });

    if (req.user.role !== 'admin' && plantilla.ownerId !== req.user.id) {
        return res.status(403).json({ error: 'No tienes permiso' });
    }

    data.plantillas = data.plantillas.filter(p => p.id !== id);
    await writeJSON(PLANTILLAS_FILE, data);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 🔔 ENDPOINTS DE RECORDATORIOS (Multi-Tenant)
// ============================================

// GET - Listar (Solo los míos)
router.get('/recordatorios', async (req, res) => {
  try {
    const data = await readJSON(RECORDATORIOS_FILE, { recordatorios: [] });
    
    if (req.user.role === 'admin') {
        res.json(data.recordatorios);
    } else {
        const misRecordatorios = data.recordatorios.filter(r => r.ownerId === req.user.id);
        res.json(misRecordatorios);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST - Crear (Asignar dueño)
router.post('/recordatorios', async (req, res) => {
  try {
    const {
      tipo, instanceName, mensaje, modoDestinatarios,
      destinatarios, fechaHoraEnvio, diasAnticipacion, diaEnvio, horaEnvio
    } = req.body;

    if (!tipo || !instanceName || !mensaje) {
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }

    const data = await readJSON(RECORDATORIOS_FILE, { recordatorios: [] });

    let proximoEnvio = null;
    if (tipo === 'prueba') {
      proximoEnvio = fechaHoraEnvio || new Date().toISOString();
    } else if (['semanal', 'mensual'].includes(tipo)) {
      proximoEnvio = calcularProximoEnvio(tipo, diaEnvio, horaEnvio);
    } else if (['revision', 'aniversario', 'cumpleanos'].includes(tipo)) {
      const manana = new Date();
      manana.setDate(manana.getDate() + 1);
      manana.setHours(9, 0, 0, 0);
      proximoEnvio = manana.toISOString();
    }

    const nuevoRecordatorio = {
      id: `rec_${Date.now()}`,
      ownerId: req.user.id, // 🔥 Dueño
      tipo,
      instanceName,
      mensaje,
      modoDestinatarios,
      destinatarios: destinatarios || [],
      diasAnticipacion: diasAnticipacion || 0,
      diaEnvio: diaEnvio || null,
      horaEnvio: horaEnvio || null,
      activo: true,
      fechaCreacion: new Date().toISOString(),
      proximoEnvio,
      ultimoEnvio: null,
      totalDestinatarios: destinatarios ? destinatarios.length : 0,
      historial: []
    };

    data.recordatorios.push(nuevoRecordatorio);
    await writeJSON(RECORDATORIOS_FILE, data);

    res.status(201).json(nuevoRecordatorio);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH - Activar/Pausar (Verificar dueño)
router.patch('/recordatorios/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    const data = await readJSON(RECORDATORIOS_FILE, { recordatorios: [] });
    const index = data.recordatorios.findIndex(r => r.id === id);

    if (index === -1) return res.status(404).json({ error: 'No encontrado' });

    // Verificar permisos
    if (req.user.role !== 'admin' && data.recordatorios[index].ownerId !== req.user.id) {
        return res.status(403).json({ error: 'No tienes permiso' });
    }

    data.recordatorios[index].activo = !data.recordatorios[index].activo;
    
    if (data.recordatorios[index].activo) {
        const r = data.recordatorios[index];
        const ahora = new Date();
        if (new Date(r.proximoEnvio) < ahora && ['semanal', 'mensual'].includes(r.tipo)) {
            r.proximoEnvio = calcularProximoEnvio(r.tipo, r.diaEnvio, r.horaEnvio);
        }
    }

    await writeJSON(RECORDATORIOS_FILE, data);
    res.json(data.recordatorios[index]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE - Eliminar (Verificar dueño)
router.delete('/recordatorios/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = await readJSON(RECORDATORIOS_FILE, { recordatorios: [] });
    
    const recordatorio = data.recordatorios.find(r => r.id === id);
    if (!recordatorio) return res.status(404).json({ error: 'No encontrado' });

    if (req.user.role !== 'admin' && recordatorio.ownerId !== req.user.id) {
        return res.status(403).json({ error: 'No tienes permiso' });
    }

    data.recordatorios = data.recordatorios.filter(r => r.id !== id);
    await writeJSON(RECORDATORIOS_FILE, data);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;