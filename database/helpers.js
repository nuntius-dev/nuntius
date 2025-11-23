// ARCHIVO: database/helpers.js
const fs = require('fs').promises;
const path = require('path');

// Ruta a la base de datos
const DB_PATH = path.join(__dirname, 'db.json');

// --- Helper: Leer DB ---
async function getDB() {
  try {
    const data = await fs.readFile(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    const emptyDB = { users: [], instanceOwnership: [], recordatorios: [] };
    await saveDB(emptyDB);
    return emptyDB;
  }
}

// --- Helper: Guardar DB ---
async function saveDB(db) {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

// --- Usuarios ---
async function findUserByEmail(email) {
  const db = await getDB();
  return db.users.find(u => u.email === email);
}

async function createUser(userData) {
  const db = await getDB();
  const isAdmin = userData.email === process.env.ADMIN_EMAIL;

  const newUser = {
    id: Date.now().toString(),
    email: userData.email,
    name: userData.name,
    picture: userData.picture || null,
    role: isAdmin ? 'admin' : 'user',
    createdAt: new Date().toISOString()
  };

  db.users.push(newUser);
  await saveDB(db);
  return newUser;
}

async function updateUserPicture(userId, newPicture) {
  const db = await getDB();
  const index = db.users.findIndex(u => u.id === userId);
  
  if (index !== -1) {
    db.users[index].picture = newPicture;
    await saveDB(db);
    return db.users[index];
  }
  return null;
}

// --- Instancias ---
async function assignInstance(instanceName, ownerId) {
  const db = await getDB();
  const existingIndex = db.instanceOwnership.findIndex(i => i.instanceName === instanceName);
  
  if (existingIndex >= 0) {
    db.instanceOwnership[existingIndex].ownerId = ownerId;
    db.instanceOwnership[existingIndex].updatedAt = new Date().toISOString();
  } else {
    db.instanceOwnership.push({
      instanceName,
      ownerId,
      createdAt: new Date().toISOString()
    });
  }
  await saveDB(db);
}

async function getUserInstances(userId) {
  const db = await getDB();
  return db.instanceOwnership
    .filter(i => i.ownerId === userId)
    .map(i => i.instanceName);
}

async function deleteInstanceOwnership(instanceName) {
  const db = await getDB();
  db.instanceOwnership = db.instanceOwnership.filter(i => i.instanceName !== instanceName);
  await saveDB(db);
}

// --- EXPORTAR TODO ---
module.exports = {
  getDB,
  saveDB,
  findUserByEmail,
  createUser,
  updateUserPicture,
  assignInstance,
  getUserInstances,
  deleteInstanceOwnership
};