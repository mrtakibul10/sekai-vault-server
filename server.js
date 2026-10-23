const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const http = require('http');
const https = require('https');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const userDir = path.join(__dirname, 'uploads', req.body.username || 'guest');
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }
        cb(null, userDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

const DB_FILE = './database.json';
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ 
        users: {}, 
        data: {}, 
        posts: [],
        admin: { password: "adminpassword123", notice: { text: "", theme: "neon" }, messages: [] } 
    }));
}

function getDB() {
    try {
        let db = JSON.parse(fs.readFileSync(DB_FILE));
        if(!db.admin) db.admin = { password: "adminpassword123", notice: { text: "", theme: "neon" }, messages: [] };
        if(!db.posts) db.posts = [];
        return db;
    } catch (e) {
        return { users: {}, data: {}, posts: [], admin: { password: "adminpassword123", notice: { text: "", theme: "neon" }, messages: [] } };
    }
}
function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Check Username
app.post('/api/check-username', (req, res) => {
    const { username } = req.body;
    const db = getDB();
    if (db.users[username]) {
        return res.json({ available: false, message: "Not Available Username" });
    }
    res.json({ available: true, message: "Username Available" });
});

// Register
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    const db = getDB();
    if (db.users[username]) {
        return res.status(400).json({ error: "Username Not Available" });
    }
    const now = new Date().getTime();
    db.users[username] = { 
        password, 
        displayName: username,
        isSuper: false, 
        isVip: false, 
        loginDays: 1, 
        lastLoginDate: new Date().toDateString(),
        createdAt: now,
        lastActive: now,
        friends: [],
        friendRequests: [],
        isPrivate: false,
        banUntil: null, 
        banReason: "" 
    };
    db.data[username] = { files: [], theme: 'neon', profileBanner: '' };
    saveDB(db);
    res.json({ success: true });
});

// Login & Daily Login Streak Count
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const db = getDB();
    if (db.users[username]) {
        if (db.users[username].password !== password) {
            return res.status(401).json({ error: "ইউজারনেম বা পাসওয়ার্ড ভুল!" });
        }
        if (db.users[username].banUntil) {
            const now = new Date().getTime();
            if (now < db.users[username].banUntil) {
                return res.status(403).json({ error: `ব্যান মেয়াদ শেষ হবে: ${new Date(db.users[username].banUntil).toLocaleString()}`, banned: true });
            } else {
                db.users[username].banUntil = null;
            }
        }

        const today = new Date().toDateString();
        if (db.users[username].lastLoginDate !== today) {
            db.users[username].loginDays = (db.users[username].loginDays || 0) + 1;
            db.users[username].lastLoginDate = today;
        }

        db.users[username].lastActive = new Date().getTime();
        saveDB(db);

        return res.json({ 
            success: true, 
            userData: db.data[username], 
            userInfo: db.users[username],
            notice: db.admin.notice 
        });
    }
    res.status(401).json({ error: "ইউজারনেম বা পাসওয়ার্ড ভুল!" });
});

app.post('/api/save-data', (req, res) => {
    const { username, userData } = req.body;
    const db = getDB();
    if (db.users[username]) {
        db.data[username] = userData;
        db.users[username].lastActive = new Date().getTime();
        saveDB(db);
        return res.json({ success: true, notice: db.admin.notice });
    }
    res.status(400).json({ error: "User not found" });
});

app.post('/api/update-profile', (req, res) => {
    const { username, displayName, isVip, isSuper, isPrivate } = req.body;
    const db = getDB();
    if(db.users[username]) {
        if(displayName !== undefined) db.users[username].displayName = displayName;
        if(isVip !== undefined) db.users[username].isVip = isVip;
        if(isSuper !== undefined) db.users[username].isSuper = isSuper;
        if(isPrivate !== undefined) db.users[username].isPrivate = isPrivate;
        saveDB(db);
        return res.json({ success: true, userInfo: db.users[username] });
    }
    res.status(400).json({ error: "User not found" });
});

// Vault Upload (File + Image support)
app.post('/api/upload', upload.single('file'), (req, res) => {
    const username = req.body.username;
    const title = req.body.title || "Untitled Vault Item";
    const isPublic = req.body.isPublic === 'true';
    const db = getDB();
    
    const fileUrl = req.file ? `/uploads/${username}/${req.file.filename}` : '';
    const fileName = req.file ? req.file.originalname : '';
    
    const fileObj = { 
        id: Date.now(), 
        title: title,
        name: fileName, 
        url: fileUrl, 
        isPublic, 
        type: req.file && req.file.mimetype.startsWith('image/') ? 'image' : 'file' 
    };

    if(!db.data[username].files) db.data[username].files = [];
    db.data[username].files.push(fileObj);
    saveDB(db);

    res.json({ success: true, file: fileObj });
});

// Leaderboard API
app.get('/api/leaderboard', (req, res) => {
    const db = getDB();
    let list = [];
    for(let u in db.users) {
        list.push({
            username: u,
            displayName: db.users[u].displayName || u,
            loginDays: db.users[u].loginDays || 1,
            createdAt: db.users[u].createdAt || Date.now(),
            isVip: db.users[u].isVip || false,
            isSuper: db.users[u].isSuper || false,
            profileBanner: db.data[u] ? db.data[u].profileBanner : ''
        });
    }
    list.sort((a, b) => b.loginDays - a.loginDays || a.createdAt - b.createdAt);
    res.json(list);
});

// Global Feed Posts
app.get('/api/posts', (req, res) => {
    const db = getDB();
    res.json(db.posts || []);
});

app.post('/api/create-post', (req, res) => {
    const { username, title, content, imageUrl } = req.body;
    const db = getDB();
    const post = {
        id: Date.now(),
        username,
        displayName: db.users[username] ? db.users[username].displayName : username,
        title,
        content,
        imageUrl,
        likes: [],
        comments: [],
        time: new Date().toLocaleTimeString()
    };
    if(!db.posts) db.posts = [];
    db.posts.unshift(post);
    saveDB(db);
    res.json({ success: true, post });
});

app.post('/api/like-post', (req, res) => {
    const { postId, username } = req.body;
    const db = getDB();
    const post = (db.posts || []).find(p => p.id == postId);
    if(post) {
        if(!post.likes) post.likes = [];
        const idx = post.likes.indexOf(username);
        if(idx > -1) post.likes.splice(idx, 1);
        else post.likes.push(username);
        saveDB(db);
        return res.json({ success: true, likes: post.likes });
    }
    res.status(404).json({ error: "Post not found" });
});

// Friends & Search API
app.get('/api/users-list', (req, res) => {
    const db = getDB();
    let users = [];
    for(let u in db.users) {
        users.push({
            username: u,
            displayName: db.users[u].displayName || u,
            isVip: db.users[u].isVip,
            isSuper: db.users[u].isSuper,
            isPrivate: db.users[u].isPrivate,
            profileBanner: db.data[u] ? db.data[u].profileBanner : ''
        });
    }
    res.json(users);
});

app.post('/api/friend-request', (req, res) => {
    const { fromUser, toUser } = req.body;
    const db = getDB();
    if(db.users[toUser]) {
        if(!db.users[toUser].friendRequests) db.users[toUser].friendRequests = [];
        if(!db.users[toUser].friendRequests.includes(fromUser)) {
            db.users[toUser].friendRequests.push(fromUser);
            saveDB(db);
        }
        return res.json({ success: true });
    }
    res.status(404).json({ error: "User not found" });
});

app.post('/api/friend-action', (req, res) => {
    const { username, targetUser, action } = req.body;
    const db = getDB();
    if(db.users[username]) {
        db.users[username].friendRequests = (db.users[username].friendRequests || []).filter(u => u !== targetUser);
        if(action === 'accept') {
            if(!db.users[username].friends) db.users[username].friends = [];
            if(!db.users[username].friends.includes(targetUser)) db.users[username].friends.push(targetUser);

            if(db.users[targetUser]) {
                if(!db.users[targetUser].friends) db.users[targetUser].friends = [];
                if(!db.users[targetUser].friends.includes(username)) db.users[targetUser].friends.push(username);
            }
        }
        saveDB(db);
        return res.json({ success: true, userInfo: db.users[username] });
    }
    res.status(404).json({ error: "User not found" });
});

app.get('/api/user-profile/:username', (req, res) => {
    const u = req.params.username;
    const db = getDB();
    if(db.users[u]) {
        res.json({
            success: true,
            username: u,
            userInfo: db.users[u],
            userData: db.users[u].isPrivate ? { isPrivate: true } : db.data[u]
        });
    } else {
        res.status(404).json({ error: "User not found" });
    }
});

// 24/7 Keep-Alive Ping Endpoint
app.get('/ping', (req, res) => {
    res.json({ status: "Online", message: "Sekai Vault Bot Active 24/7" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    setInterval(() => {
        const appUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
        const client = appUrl.startsWith('https') ? https : http;
        client.get(`${appUrl}/ping`, (res) => {}).on('error', (err) => {});
    }, 8 * 60 * 1000);
});
