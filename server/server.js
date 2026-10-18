const http = require('http');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { Server } = require('socket.io');
require('dotenv').config();

// Ensure DB is initialized
require('./db/database');

const { initSocket } = require('./socket');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const projectRoutes = require('./routes/projectRoutes');

const app = express();
const server = http.createServer(app);

// Initialize Socket.io
const io = new Server(server, {
    cors: {
        origin: true,
        credentials: true
    }
});
initSocket(io);
// Make io accessible to route controllers via req.app.get('io')
app.set('io', io);

// Security Headers with Helmet
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            connectSrc: ["'self'", "ws:", "wss:"],
            upgradeInsecureRequests: null
        }
    },
    crossOriginEmbedderPolicy: false
}));

// Middlewares
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
    origin: true,
    credentials: true
}));

// Serve static frontend files
const publicDir = path.resolve(__dirname, '../public');
app.use(express.static(publicDir));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);

// Placeholder / stub for future route modules (will be added in phases 2-6)
// app.use('/api/users', userRoutes);
// app.use('/api/projects', projectRoutes);
// app.use('/api/notifications', notificationRoutes);
// app.use('/api/dashboard', dashboardRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        app: 'Taskora',
        timestamp: new Date().toISOString()
    });
});

// Single Page Application Fallback: send index.html for client-side navigation
app.use((req, res, next) => {
    // If request is for an API endpoint that wasn't matched, return 404 JSON
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ success: false, error: 'API endpoint not found' });
    }
    // Only handle GET requests for SPA navigation
    if (req.method === 'GET') {
        return res.sendFile(path.join(publicDir, 'index.html'));
    }
    next();
});

// Central Error Handler
app.use((err, req, res, next) => {
    console.error('Unhandled server error:', err);
    res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Internal server error'
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Taskora server running on http://localhost:${PORT}`);
});

module.exports = { app, server };
