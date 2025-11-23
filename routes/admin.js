// routes/admin.js
const express = require('express');
const router = express.Router();
const { isAdmin } = require('../middleware/auth');
const { 
  getDB, 
  assignInstance, 
  getUserInstances,
  findUserByEmail 
} = require('../database/helpers');

// =====================================
// TODAS LAS RUTAS REQUIEREN ROL ADMIN
// =====================================
router.use(isAdmin);

// =====================================
// GET: Listar todos los usuarios
// =====================================
router.get('/users', async (req, res) => {
  try {
    const db = await getDB();
    res.json(db.users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================
// GET: Listar ownership de instancias
// =====================================
router.get('/ownership', async (req, res) => {
  try {
    const db = await getDB();
    
    // Enriquecer con nombres de usuarios
    const enrichedOwnership = db.instanceOwnership.map(inst => {
      const owner = db.users.find(u => u.id === inst.ownerId);
      return {
        ...inst,
        ownerName: owner ? owner.name : 'Usuario eliminado',
        ownerEmail: owner ? owner.email : null
      };
    });
    
    res.json(enrichedOwnership);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================
// POST: Asignar instancia a usuario
// =====================================
router.post('/assign-instance', async (req, res) => {
  try {
    const { instanceName, userId } = req.body;
    
    if (!instanceName || !userId) {
      return res.status(400).json({ error: 'Faltan parámetros' });
    }
    
    // Verificar que el usuario existe
    const db = await getDB();
    const user = db.users.find(u => u.id === userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    // Asignar
    await assignInstance(instanceName, userId);
    
    res.json({ 
      success: true, 
      message: `Instancia ${instanceName} asignada a ${user.name}` 
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================
// DELETE: Eliminar usuario (admin only)
// =====================================
router.delete('/delete-user', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'Falta userId' });
    }
    
    const db = await getDB();
    
    // Verificar que no sea admin
    const user = db.users.find(u => u.id === userId);
    if (user && user.role === 'admin') {
      return res.status(403).json({ error: 'No puedes eliminar a un admin' });
    }
    
    // Eliminar usuario
    db.users = db.users.filter(u => u.id !== userId);
    
    // Las instancias quedan sin asignar (no las eliminamos de Evolution)
    db.instanceOwnership = db.instanceOwnership.filter(i => i.ownerId !== userId);
    
    await require('../database/helpers').saveDB(db);
    
    res.json({ success: true, message: 'Usuario eliminado' });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================
// GET: Estadísticas generales
// =====================================
router.get('/stats', async (req, res) => {
  try {
    const db = await getDB();
    
    const stats = {
      totalUsers: db.users.length,
      totalAdmins: db.users.filter(u => u.role === 'admin').length,
      totalRegularUsers: db.users.filter(u => u.role === 'user').length,
      totalAssignments: db.instanceOwnership.length,
      usersWithInstances: new Set(db.instanceOwnership.map(i => i.ownerId)).size,
      averageInstancesPerUser: db.instanceOwnership.length / db.users.filter(u => u.role === 'user').length || 0
    };
    
    res.json(stats);
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================
// POST: Cambiar rol de usuario
// =====================================
router.post('/change-role', async (req, res) => {
  try {
    const { userId, newRole } = req.body;
    
    if (!userId || !['user', 'admin'].includes(newRole)) {
      return res.status(400).json({ error: 'Parámetros inválidos' });
    }
    
    const db = await getDB();
    const user = db.users.find(u => u.id === userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    user.role = newRole;
    await require('../database/helpers').saveDB(db);
    
    res.json({ success: true, message: `Rol actualizado a ${newRole}` });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================
// GET: Ver instancias de un usuario específico
// =====================================
router.get('/user-instances', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'Falta userId' });
    }
    
    const instances = await getUserInstances(userId);
    res.json(instances);
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================
// POST: Transferir instancia entre usuarios
// =====================================
router.post('/transfer-instance', async (req, res) => {
  try {
    const { instanceName, fromUserId, toUserId } = req.body;
    
    if (!instanceName || !fromUserId || !toUserId) {
      return res.status(400).json({ error: 'Faltan parámetros' });
    }
    
    const db = await getDB();
    
    // Verificar que ambos usuarios existen
    const fromUser = db.users.find(u => u.id === fromUserId);
    const toUser = db.users.find(u => u.id === toUserId);
    
    if (!fromUser || !toUser) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    // Reasignar
    await assignInstance(instanceName, toUserId);
    
    res.json({ 
      success: true, 
      message: `Instancia transferida de ${fromUser.name} a ${toUser.name}` 
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;