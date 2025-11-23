// scheduler.js
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
const { google } = require('googleapis');

// ==========================================
// ⚙️ CONFIGURACIÓN
// ==========================================
const RECORDATORIOS_FILE = path.join(process.cwd(), 'data', 'recordatorios.json');
const KEY_FILE_PATH = path.join(process.cwd(), 'credentials.json');
const API_URL = process.env.EVOLUTION_API_URL;
const API_KEY = process.env.EVOLUTION_API_KEY;

// ID de tu Hoja de Google
const GOOGLE_SHEET_ID = "1Cp2VMzVi3tLumyQ6i2u6nFrDFMPt4jmwCKNmIZoAm_o"; 

// Permisos de escritura
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// ==========================================
// 🛠️ FUNCIONES AUXILIARES
// ==========================================

const formatearDinero = (valor) => {
  if (!valor) return "$0";
  const numeroLimpio = String(valor).replace(/\D/g, '');
  const numero = parseInt(numeroLimpio);
  if (isNaN(numero)) return "$0";
  return new Intl.NumberFormat('es-CO', { 
    style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 
  }).format(numero);
};

function procesarMensaje(plantilla, contacto) {
  let msg = plantilla;
  // Soporte para ambas llaves de fecha por si acaso
  const fechaReal = contacto.fecha || contacto.fechaNacimiento || "Pendiente";
  
  msg = msg.replace(/{nombre}/gi, contacto.nombre || "Estimado Cliente");
  msg = msg.replace(/{telefono}/gi, contacto.telefono || "");
  msg = msg.replace(/{ciudad}/gi, contacto.ciudad || "");
  msg = msg.replace(/{monto}/gi, formatearDinero(contacto.monto));
  msg = msg.replace(/{fecha}/gi, fechaReal);
  return msg;
}

async function enviarMensaje(instanceName, numero, mensaje) {
  try {
    const url = `${API_URL}/message/sendText/${instanceName}`;
    const body = { number: numero, text: mensaje, linkPreview: false };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'apikey': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return response.ok;
  } catch (error) {
    console.error("Error API:", error.message);
    return false;
  }
}

// ==========================================
// 📝 FUNCIÓN INTELIGENTE (ACTUALIZAR O CREAR)
// ==========================================
async function actualizarGoogleSheet(contacto, motivo) {
  if (!GOOGLE_SHEET_ID) return;

  try {
    const auth = new google.auth.GoogleAuth({ keyFile: KEY_FILE_PATH, scopes: SCOPES });
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Buscar el teléfono en la Columna D
    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: 'Clientes!D:D', 
    });

    const rows = readRes.data.values || [];
    const telefonoDestino = String(contacto.telefono).replace(/\D/g, ''); 
    
    let rowIndex = -1;
    
    // Buscamos coincidencias (ignorando el +57 si es necesario para ser flexibles)
    for (let i = 0; i < rows.length; i++) {
      const celda = String(rows[i][0] || "").replace(/\D/g, '');
      // Si uno contiene al otro (ej: 57300... contiene a 300...)
      if (celda && (telefonoDestino.includes(celda) || celda.includes(telefonoDestino))) {
        rowIndex = i + 1;
        break;
      }
    }

    const hoy = new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" });

    // ==========================================
    // CASO 1: EL USUARIO YA EXISTE -> ACTUALIZAR
    // ==========================================
    if (rowIndex !== -1) {
        // Actualizar Columna A y B (Motivo y Enviado)
        await sheets.spreadsheets.values.update({
          spreadsheetId: GOOGLE_SHEET_ID,
          range: `Clientes!A${rowIndex}:B${rowIndex}`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [[motivo, "TRUE"]] }
        });

        // Actualizar Columna H (UltimoRecordatorio)
        await sheets.spreadsheets.values.update({
          spreadsheetId: GOOGLE_SHEET_ID,
          range: `Clientes!H${rowIndex}`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [[hoy]] }
        });
        
        console.log(`📝 Sheet: Actualizada Fila ${rowIndex}`);
    } 
    // ==========================================
    // CASO 2: EL USUARIO NO EXISTE -> CREAR NUEVO
    // ==========================================
    else {
        console.log(`⚠️ Usuario nuevo (${contacto.nombre}). Agregando al Sheet...`);
        
        // Preparamos la fila nueva según tu estructura:
        // A: Motivo | B: Enviado? | C: Nombre | D: Teléfono | E: Monto | F: Fecha | G: Estado | H: UltimoRecordatorio
        
        const nuevaFila = [
            motivo,                           // A
            "TRUE",                           // B
            contacto.nombre || "Sin Nombre",  // C
            contacto.telefono,                // D
            formatearDinero(contacto.monto),  // E (Formateado bonito)
            contacto.fecha || contacto.fechaNacimiento || "", // F
            "IMPAGA",                         // G (Asumimos deuda por defecto)
            hoy                               // H
        ];

        await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: 'Clientes!A:H',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [nuevaFila] }
        });
        
        console.log(`✅ Sheet: Nueva fila creada al final.`);
    }

  } catch (error) {
    console.error("Error Sheet:", error.message);
  }
}


// ==========================================
// ⏰ LÓGICA PRINCIPAL
// ==========================================
async function checkRecordatorios() {
  try {
    const dataRaw = await fs.readFile(RECORDATORIOS_FILE, 'utf8');
    const data = JSON.parse(dataRaw);
    const ahora = new Date();
    let huboCambios = false;

    for (const rec of data.recordatorios) {
      if (!rec.activo || !rec.proximoEnvio) continue;

      const fechaEnvio = new Date(rec.proximoEnvio);
      
      if (fechaEnvio <= ahora) {
        console.log(`🚀 Ejecutando envío: ${rec.tipo}`);
        
        let enviadosCount = 0;
        let fallidosCount = 0;

        for (const dest of rec.destinatarios) {
            const mensajeFinal = procesarMensaje(rec.mensaje, dest);
            const enviado = await enviarMensaje(rec.instanceName, dest.telefono, mensajeFinal);
            
            if (enviado) {
                console.log(`✅ Enviado a ${dest.nombre}`);
                enviadosCount++;
                
                // 🔥 PASAMOS TODO EL CONTACTO (dest) PARA PODER CREARLO SI NO EXISTE
                await actualizarGoogleSheet(dest, rec.tipo.toUpperCase());
                
            } else {
                console.error(`❌ Falló envío a ${dest.nombre}`);
                fallidosCount++;
            }
            
            await new Promise(r => setTimeout(r, 2000)); 
        }

        rec.ultimoEnvio = new Date().toISOString();
        rec.historial.push({
            fecha: rec.ultimoEnvio,
            enviados: enviadosCount,
            fallidos: fallidosCount,
            destinatarios: rec.totalDestinatarios
        });

        if (rec.tipo === 'prueba') {
            rec.activo = false;
            rec.proximoEnvio = null;
        } else {
            rec.activo = false; 
        }

        huboCambios = true;
      }
    }

    if (huboCambios) {
        await fs.writeFile(RECORDATORIOS_FILE, JSON.stringify(data, null, 2));
    }

  } catch (error) {
    console.error("Error en scheduler:", error.message);
  }
}

module.exports = checkRecordatorios;