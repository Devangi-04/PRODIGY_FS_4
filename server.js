const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const multer = require('multer');
require('dotenv').config();

// Import models
const User = require('./models/User');
const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// File upload configuration
const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage });

// MongoDB Connection
mongoose.connect('mongodb://localhost:27017/chatapp', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('MongoDB Connected'))
  .catch(err => console.log('MongoDB Connection Error:', err));

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: 'Something went wrong!', error: err.message });
});

// Routes
const authRoutes = require('./routes/auth');
app.use('/auth', authRoutes);

// Protected route middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// API Routes
app.get('/api/messages/:room', authenticateToken, async (req, res) => {
    try {
        const messages = await Message.find({ room: req.params.room })
            .sort({ createdAt: -1 })
            .limit(50)
            .populate('sender', 'username')
            .lean();
        res.json(messages.reverse());
    } catch (error) {
        res.status(500).json({ message: 'Error fetching messages', error: error.message });
    }
});

// File upload endpoint
app.post('/api/upload', authenticateToken, upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }
        res.json({ fileUrl: `/uploads/${req.file.filename}` });
    } catch (error) {
        res.status(500).json({ message: 'Error uploading file', error: error.message });
    }
});

// Store active users and their statuses
const activeUsers = new Map(); // socket.id -> { username, userId, status }
const userRooms = new Map(); // socket.id -> room
const userSockets = new Map(); // userId -> socket.id

// Socket authentication middleware
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('Authentication error'));
    }

    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, decoded) => {
        if (err) return next(new Error('Authentication error'));
        socket.userId = decoded.userId;
        socket.username = decoded.username;
        next();
    });
});

// Socket.IO Connection Handler
io.on('connection', async (socket) => {
    console.log('New user connected:', socket.username);

    // Handle User Login
    socket.on('login', async () => {
        // Store user information
        activeUsers.set(socket.id, {
            username: socket.username,
            userId: socket.userId,
            status: 'online'
        });
        userSockets.set(socket.userId, socket.id);
        socket.join('general'); // Default room
        userRooms.set(socket.id, 'general');
        
        // Send chat history
        const messages = await Message.find({ room: 'general' })
            .sort({ createdAt: -1 })
            .limit(50)
            .populate('sender', 'username')
            .lean();
        
        socket.emit('chatHistory', messages.reverse());
        
        // Get all users with their status
        const users = await User.find({}, 'username');
        const userStatuses = users.map(user => ({
            username: user.username,
            status: activeUsers.get(userSockets.get(user._id))?.status || 'offline'
        }));
        
        // Broadcast updated user list
        io.emit('updateUsers', userStatuses);
        io.to('general').emit('message', {
            system: true,
            message: `${socket.username} joined the chat`,
            timestamp: new Date()
        });
    });

    // Join Room
    socket.on('joinRoom', async (room) => {
        const oldRoom = userRooms.get(socket.id);
        
        // Leave old room
        if (oldRoom) {
            socket.leave(oldRoom);
            io.to(oldRoom).emit('message', {
                system: true,
                message: `${socket.username} left the room`,
                timestamp: new Date()
            });
        }

        // Join new room
        socket.join(room);
        userRooms.set(socket.id, room);
        
        // Send room history
        const messages = await Message.find({ room })
            .sort({ createdAt: -1 })
            .limit(50)
            .populate('sender', 'username')
            .lean();
        
        socket.emit('chatHistory', messages.reverse());
        
        io.to(room).emit('message', {
            system: true,
            message: `${socket.username} joined the room`,
            timestamp: new Date()
        });
    });

    // Handle Messages
    socket.on('sendMessage', async (data) => {
        const room = userRooms.get(socket.id);
        
        if (room) {
            const messageData = {
                sender: socket.userId,
                content: data.message,
                room,
                type: data.type || 'text',
                fileUrl: data.fileUrl
            };

            // Save message to database
            const message = new Message(messageData);
            await message.save();

            const populatedMessage = await Message.findById(message._id)
                .populate('sender', 'username')
                .lean();

            io.to(room).emit('message', {
                ...populatedMessage,
                timestamp: new Date()
            });
        }
    });

    // Handle Private Messages
    socket.on('privateMessage', async (data) => {
        try {
            const recipient = await User.findOne({ username: data.to });
            if (!recipient) {
                socket.emit('error', { message: 'User not found' });
                return;
            }

            const recipientSocketId = userSockets.get(recipient._id.toString());
            if (!recipientSocketId) {
                socket.emit('error', { message: 'User is offline' });
                return;
            }

            const messageData = {
                sender: socket.userId,
                recipient: recipient._id,
                content: data.message,
                room: `private_${Math.min(socket.userId, recipient._id)}_${Math.max(socket.userId, recipient._id)}`,
                type: data.type || 'text',
                fileUrl: data.fileUrl
            };

            const message = new Message(messageData);
            await message.save();

            const populatedMessage = await Message.findById(message._id)
                .populate('sender', 'username')
                .populate('recipient', 'username')
                .lean();

            // Send to sender
            socket.emit('privateMessage', {
                ...populatedMessage,
                timestamp: new Date()
            });

            // Send to recipient if online
            const recipientSocket = io.sockets.sockets.get(recipientSocketId);
            if (recipientSocket) {
                recipientSocket.emit('privateMessage', {
                    ...populatedMessage,
                    timestamp: new Date()
                });
            }
        } catch (error) {
            console.error('Private message error:', error);
            socket.emit('error', { message: 'Error sending private message' });
        }
    });

    // Handle Typing Status
    socket.on('typing', (isTyping) => {
        const room = userRooms.get(socket.id);
        if (room) {
            socket.to(room).emit('userTyping', {
                username: socket.username,
                isTyping
            });
        }
    });

    // Handle Disconnection
    socket.on('disconnect', async () => {
        const room = userRooms.get(socket.id);
        
        if (socket.username) {
            io.to(room).emit('message', {
                system: true,
                message: `${socket.username} left the chat`,
                timestamp: new Date()
            });
            
            activeUsers.delete(socket.id);
            userRooms.delete(socket.id);
            userSockets.delete(socket.userId);

            // Update all users' status
            const users = await User.find({}, 'username');
            const userStatuses = users.map(user => ({
                username: user.username,
                status: activeUsers.get(userSockets.get(user._id))?.status || 'offline'
            }));
            
            io.emit('updateUsers', userStatuses);
        }
        
        console.log('User disconnected:', socket.username);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
