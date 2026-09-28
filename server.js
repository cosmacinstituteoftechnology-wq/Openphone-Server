/**
 * ============================================================
 * OPENPHONE-CLONE SERVER — V2.0 ENTERPRISE EDITION
 * Firebase Firestore Database | Virtual Extensions | Full Network API
 * ============================================================
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

// ── FIREBASE SDK ──
const { initializeApp } = require('firebase/app');
const { 
  getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, addDoc, query, where, getDocs, orderBy, limit 
} = require('firebase/firestore');

// ── INITIALIZE EXPRESS & SOCKET.IO ──
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve the HTML from root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'phone_dailer.html'));
});

// ── FIREBASE CONFIGURATION ──
// NOTE: In production, store these in Render Environment Variables!
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyAn_k3_o500O-tvMxHKsBXTfKuTDd0igzI",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "openphone-2a844.firebaseapp.com",
  projectId: process.env.FIREBASE_PROJECT_ID || "openphone-2a844",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "openphone-2a844.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MSG_SENDER_ID || "274916994647",
  appId: process.env.FIREBASE_APP_ID || "1:274916994647:web:c7abf7feeac67ad2c9bd12",
  measurementId: process.env.FIREBASE_MEASUREMENT_ID || "G-4V12VQGPZC"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// ── IN-MEMORY CACHE (For fast real-time routing) ──
const activeCalls = new Map();
const socketUserMap = new Map(); // socketId -> userId
const userSocketMap = new Map(); // userId -> socketId

// ── HELPER FUNCTIONS ──
function generateId(prefix) {
  return `${prefix}${crypto.randomBytes(6).toString('hex')}`;
}

function generateVirtualNumber() {
  // Generates an internal extension like "EXT4821"
  return `EXT${Math.floor(1000 + Math.random() * 9000)}`;
}

async function saveToFirestore(collectionName, docId, data) {
  try {
    await setDoc(doc(db, collectionName, docId), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
    return { success: true };
  } catch (err) {
    console.error(`❌ Firestore write error (${collectionName}):`, err.message);
    return { success: false, error: err.message };
  }
}

async function getFromFirestore(collectionName, docId) {
  try {
    const docRef = doc(db, collectionName, docId);
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? docSnap.data() : null;
  } catch (err) {
    console.error(`❌ Firestore read error (${collectionName}):`, err.message);
    return null;
  }
}

async function queryFirestore(collectionName, field, operator, value) {
  try {
    const q = query(collection(db, collectionName), where(field, operator, value));
    const querySnapshot = await getDocs(q);
    const results = [];
    querySnapshot.forEach((doc) => results.push({ id: doc.id, ...doc.data() }));
    return results;
  } catch (err) {
    console.error(`❌ Firestore query error (${collectionName}):`, err.message);
    return [];
  }
}

async function fireWebhooks(eventType, payload) {
  try {
    const hooks = await queryFirestore('webhooks', 'status', '==', 'enabled');
    for (const hook of hooks) {
      if (hook.events.includes(eventType) || hook.events.includes('*')) {
        await axios.post(hook.url, {
          id: generateId('EV'), object: 'event', apiVersion: 'v4',
          createdAt: new Date().toISOString(), type: eventType, data: payload,
        }, { timeout: 5000 }).catch(e => console.error(`Webhook failed: ${hook.url}`));
      }
    }
  } catch (err) {
    console.error('Webhook processing error:', err.message);
  }
}

// ============================================================
// REST API ROUTES
// ============================================================

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), version: '2.0.0', database: 'Firebase Connected' });
});

// ── 1. USER MANAGEMENT ──
app.post('/api/users/register', async (req, res) => {
  const { username, email, password } = req.body;
  const userId = generateId('USR');
  const virtualNumber = generateVirtualNumber();
  
  const user = {
    userId, username, email, virtualNumber,
    role: 'member', status: 'active',
    createdAt: new Date().toISOString()
  };

  const result = await saveToFirestore('users', userId, user);
  if (result.success) {
    res.status(201).json({ data: user });
  } else {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.get('/api/users/:userId', async (req, res) => {
  const user = await getFromFirestore('users', req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ data: user });
});

app.get('/api/users', async (req, res) => {
  const users = await queryFirestore('users', 'status', '==', 'active');
  res.json({ data: users });
});

app.put('/api/users/:userId', async (req, res) => {
  const result = await saveToFirestore('users', req.params.userId, req.body);
  res.json({ success: result.success });
});

// ── 2. VIRTUAL NUMBER MANAGEMENT ──
app.post('/api/virtual-numbers/generate', async (req, res) => {
  const { userId } = req.body;
  const virtualNumber = generateVirtualNumber();
  
  const numberData = {
    numberId: generateId('VN'),
    virtualNumber, userId,
    status: 'active',
    createdAt: new Date().toISOString()
  };
  
  await saveToFirestore('virtual_numbers', numberData.numberId, numberData);
  res.status(201).json({ data: numberData });
});

app.get('/api/virtual-numbers/:userId', async (req, res) => {
  const numbers = await queryFirestore('virtual_numbers', 'userId', '==', req.params.userId);
  res.json({ data: numbers });
});

// ── 3. CONTACTS & ADDRESS BOOK ──
app.post('/api/contacts', async (req, res) => {
  const contactId = generateId('CT');
  const contact = { contactId, ...req.body, createdAt: new Date().toISOString() };
  await saveToFirestore('contacts', contactId, contact);
  res.status(201).json({ data: contact });
});

app.get('/api/contacts/:userId', async (req, res) => {
  const contacts = await queryFirestore('contacts', 'userId', '==', req.params.userId);
  res.json({ data: contacts });
});

// ── 4. SMS / MESSAGING (Mock Gateway) ──
app.post('/api/messages/send', async (req, res) => {
  const { from, to, content, userId } = req.body;
  const messageId = generateId('MSG');
  
  const message = {
    messageId, from, to, content, userId,
    direction: 'outgoing', status: 'sent',
    createdAt: new Date().toISOString()
  };
  
  await saveToFirestore('messages', messageId, message);
  
  // Real-time delivery via Socket.IO
  const targetSocket = userSocketMap.get(to);
  if (targetSocket) {
    io.to(targetSocket).emit('message-received', message);
  }
  
  await fireWebhooks('message.sent', { object: message });
  res.status(201).json({ data: message });
});

app.get('/api/messages/:userId', async (req, res) => {
  const messages = await queryFirestore('messages', 'userId', '==', req.params.userId);
  res.json({ data: messages });
});

// ── 5. CALL LOGS & ANALYTICS ──
app.post('/api/calls/log', async (req, res) => {
  const callId = generateId('CALL');
  const callLog = { callId, ...req.body, createdAt: new Date().toISOString() };
  await saveToFirestore('call_logs', callId, callLog);
  res.status(201).json({ data: callLog });
});

app.get('/api/calls/logs/:userId', async (req, res) => {
  const logs = await queryFirestore('call_logs', 'userId', '==', req.params.userId);
  res.json({ data: logs });
});

app.get('/api/analytics/:userId', async (req, res) => {
  const callLogs = await queryFirestore('call_logs', 'userId', '==', req.params.userId);
  const messages = await queryFirestore('messages', 'userId', '==', req.params.userId);
  
  res.json({
    data: {
      totalCalls: callLogs.length,
      totalMessages: messages.length,
      activeCalls: activeCalls.size,
      timestamp: new Date().toISOString()
    }
  });
});

// ── 6. RING GROUPS & IVR ──
app.post('/api/ring-groups', async (req, res) => {
  const groupId = generateId('RG');
  const group = { groupId, ...req.body, createdAt: new Date().toISOString() };
  await saveToFirestore('ring_groups', groupId, group);
  res.status(201).json({ data: group });
});

app.get('/api/ring-groups/:userId', async (req, res) => {
  const groups = await queryFirestore('ring_groups', 'userId', '==', req.params.userId);
  res.json({ data: groups });
});

// ── 7. WEBHOOKS ──
app.post('/api/webhooks', async (req, res) => {
  const webhookId = generateId('WH');
  const hook = { webhookId, ...req.body, status: 'enabled', createdAt: new Date().toISOString() };
  await saveToFirestore('webhooks', webhookId, hook);
  res.status(201).json({ data: hook });
});

// ============================================================
// SOCKET.IO — REAL-TIME NETWORK ENGINE
// ============================================================
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // ── User Registration & Presence ──
  socket.on('register', async (userData) => {
    const { userId, username } = userData;
    socketUserMap.set(socket.id, userId);
    userSocketMap.set(userId, socket.id);
    
    await saveToFirestore('users', userId, { userId, username, status: 'online', lastSeen: new Date().toISOString() });
    
    io.emit('user-list', Array.from(userSocketMap.keys()).map(id => ({
      userId: id, username: id, status: 'online'
    })));
  });

  // ── Call Signaling (WebRTC) ──
  socket.on('call-initiate', async ({ from, to }) => {
    const callId = generateId('CALL');
    const call = {
      callId, from, to, status: 'ringing',
      direction: 'outgoing', startedAt: new Date().toISOString()
    };
    activeCalls.set(callId, call);
    
    await fireWebhooks('call.ringing', { object: call });
    
    const targetSocket = userSocketMap.get(to);
    if (targetSocket) {
      io.to(targetSocket).emit('call-incoming', { callId, from });
    } else {
      socket.emit('call-voicemail', { callId, message: 'User offline. Leave a voicemail.' });
    }
  });

  socket.on('call-answer', ({ callId }) => {
    const call = activeCalls.get(callId);
    if (!call) return;
    call.status = 'active';
    activeCalls.set(callId, call);
    
    const callerSocket = userSocketMap.get(call.from);
    if (callerSocket) io.to(callerSocket).emit('call-answered', { callId });
  });

  socket.on('call-end', async ({ callId }) => {
    const call = activeCalls.get(callId);
    if (!call) return;
    
    call.status = 'completed';
    call.completedAt = new Date().toISOString();
    call.duration = Math.floor((new Date(call.completedAt) - new Date(call.startedAt)) / 1000);
    
    await saveToFirestore('call_logs', callId, call);
    activeCalls.delete(callId);
    
    if (userSocketMap.has(call.from)) io.to(userSocketMap.get(call.from)).emit('call-ended', { callId });
    if (userSocketMap.has(call.to)) io.to(userSocketMap.get(call.to)).emit('call-ended', { callId });
    
    await fireWebhooks('call.completed', { object: call });
  });

  // ── WebRTC ICE Candidate Exchange ──
  socket.on('ice-candidate', ({ to, candidate }) => {
    const targetSocket = userSocketMap.get(to);
    if (targetSocket) {
      io.to(targetSocket).emit('ice-candidate', { from: socketUserMap.get(socket.id), candidate });
    }
  });

  socket.on('offer', ({ to, offer }) => {
    const targetSocket = userSocketMap.get(to);
    if (targetSocket) io.to(targetSocket).emit('offer', { from: socketUserMap.get(socket.id), offer });
  });

  socket.on('answer', ({ to, answer }) => {
    const targetSocket = userSocketMap.get(to);
    if (targetSocket) io.to(targetSocket).emit('answer', { from: socketUserMap.get(socket.id), answer });
  });

  // ── Disconnect & Cleanup ──
  socket.on('disconnect', async () => {
    const userId = socketUserMap.get(socket.id);
    if (userId) {
      await saveToFirestore('users', userId, { status: 'offline', lastSeen: new Date().toISOString() });
      socketUserMap.delete(socket.id);
      userSocketMap.delete(userId);
      io.emit('user-list', Array.from(userSocketMap.keys()).map(id => ({ userId: id, username: id, status: 'online' })));
      console.log(`👋 Disconnected: ${userId}`);
    }
  });
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 OpenPhone Enterprise Server v2.0 running on port ${PORT}`);
  console.log(`🔥 Firebase Firestore Connected`);
  console.log(`🔗 REST API available at /api`);
});
