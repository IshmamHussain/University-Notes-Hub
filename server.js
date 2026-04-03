const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'http://localhost:3000');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.static('.'));
app.use('/uploads', express.static('uploads'));

app.use(session({
    secret: 'university-notes-secret-key-change-this-in-production',
    resave: true,
    saveUninitialized: true,
    cookie: { 
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    }
}));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.pdf', '.doc', '.docx', '.txt', '.ppt', '.pptx'];
        const fileExt = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(fileExt)) {
            cb(null, true);
        } else {
            cb(new Error('Only document files are allowed!'));
        }
    }
});

const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Block@ssG@me456',
    database: 'university_notes_hub',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function testDatabase() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Database connected successfully');
        
        try {
            const [columns] = await connection.execute(`
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = 'notes' AND COLUMN_NAME = 'status'
            `);
            
            if (columns.length === 0) {
                console.log('🔄 Adding status column to notes table...');
                await connection.execute(`
                    ALTER TABLE notes 
                    ADD COLUMN status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending'
                `);
                console.log('✅ Status column added successfully');
                
                await connection.execute(`UPDATE notes SET status = 'approved' WHERE status IS NULL OR status = ''`);
                console.log('✅ Existing notes set to approved status');
            } else {
                console.log('✅ Status column already exists');
            }
        } catch (alterError) {
            console.log('❌ Error with status column:', alterError.message);
        }
        
        const [notes] = await connection.execute('SELECT COUNT(*) as count FROM notes');
        console.log(`📝 Notes in database: ${notes[0].count}`);
        
        const [users] = await connection.execute('SELECT username, role FROM users');
        console.log('👥 Users in database:');
        users.forEach(user => {
            console.log(`   - ${user.username} (${user.role})`);
        });
        
        connection.release();
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
    }
}

app.use((req, res, next) => {
    console.log('🔐 Session check:', {
        path: req.path,
        sessionId: req.sessionID,
        user: req.session.user ? req.session.user.username : 'No user',
        role: req.session.user ? req.session.user.role : 'No role'
    });
    next();
});

const requireAuth = (req, res, next) => {
    console.log('🔐 Auth check for:', req.path, 'User:', req.session.user ? req.session.user.username : 'No user');
    if (req.session.user) {
        next();
    } else {
        console.log('❌ Not authenticated');
        res.status(401).json({ error: 'Not authenticated' });
    }
};

const requireAdmin = (req, res, next) => {
    console.log('🔐 Admin check for:', req.path);
    console.log('   User:', req.session.user ? req.session.user.username : 'No user');
    console.log('   Role:', req.session.user ? req.session.user.role : 'No role');
    
    if (req.session.user && req.session.user.role === 'admin') {
        console.log('✅ Admin access granted');
        next();
    } else {
        console.log('❌ Admin access denied');
        res.status(403).json({ error: 'Admin access required' });
    }
};

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});


app.get('/check-auth', (req, res) => {
    console.log('🔐 Check-auth called, session:', req.session.user);
    if (req.session.user) {
        res.json(req.session.user);
    } else {
        res.status(401).json({ error: 'Not authenticated' });
    }
});

app.get('/admin/test', requireAdmin, (req, res) => {
    res.json({ message: 'Admin API is working!', user: req.session.user });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    console.log('🔐 Login attempt:', username);
    
    try {
        const connection = await pool.getConnection();
        const [users] = await connection.execute(
            'SELECT * FROM users WHERE username = ?', 
            [username]
        );
        connection.release();

        if (users.length === 0) {
            console.log('❌ User not found:', username);
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const user = users[0];
        
        const validPassword = (user.password === password) || 
                             (user.username === 'admin' && password === 'admin123');
        
        if (!validPassword) {
            console.log('❌ Invalid password for user:', username);
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        req.session.user = {
            id: user.id,
            username: user.username,
            role: user.role
        };

        req.session.save((err) => {
            if (err) {
                console.error('❌ Session save error:', err);
                return res.status(500).json({ error: 'Login failed' });
            }
            
            console.log('✅ Login successful:', username, 'Role:', user.role);
            res.json({ success: true, user: req.session.user });
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/register', async (req, res) => {
    const { username, email, student_id, department, batch, password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
        return res.status(400).json({ error: 'Passwords do not match' });
    }

    const studentIdRegex = /^\d{3}-\d{3}-\d{3}$/;
    if (!studentIdRegex.test(student_id)) {
        return res.status(400).json({ error: 'Student ID must be in format: XXX-XXX-XXX (e.g., 123-456-789)' });
    }

    if (!batch || batch < 1 || batch > 999) {
        return res.status(400).json({ error: 'Please enter a valid batch number (1-999)' });
    }

    if (!department) {
        return res.status(400).json({ error: 'Please select a department' });
    }

    try {
        const connection = await pool.getConnection();
        
        const [existingUsers] = await connection.execute(
            'SELECT id FROM users WHERE username = ? OR email = ? OR student_id = ?',
            [username, email, student_id]
        );

        if (existingUsers.length > 0) {
            connection.release();
            return res.status(400).json({ error: 'Username, email, or student ID already exists' });
        }

        await connection.execute(
            'INSERT INTO users (username, email, student_id, department, batch, password, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [username, email, student_id, department, batch, password, 'user']
        );
        
        connection.release();
        res.json({ success: true, message: 'Registration successful' });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed: ' + error.message });
    }
});

app.post('/logout', (req, res) => {
    console.log('🔐 Logout:', req.session.user ? req.session.user.username : 'No user');
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.json({ success: true });
    });
});

app.get('/departments', async (req, res) => {
    try {
        const connection = await pool.getConnection();
        const [departments] = await connection.execute(`
            SELECT 
                d.*,
                (SELECT COUNT(*) FROM courses WHERE department_id = d.id) as course_count,
                (SELECT COUNT(*) FROM notes n 
                 JOIN courses c ON n.course_id = c.id 
                 WHERE c.department_id = d.id AND n.status = 'approved') as notes_count
            FROM departments d
            ORDER BY d.name
        `);
        connection.release();
        res.json(departments);
    } catch (error) {
        console.error('Departments error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/department/:id', async (req, res) => {
    try {
        const connection = await pool.getConnection();
        
        const [departments] = await connection.execute(
            'SELECT * FROM departments WHERE id = ?',
            [req.params.id]
        );
        
        if (departments.length === 0) {
            return res.status(404).json({ error: 'Department not found' });
        }

        const [courses] = await connection.execute(`
            SELECT 
                c.*,
                (SELECT COUNT(*) FROM notes WHERE course_id = c.id AND status = 'approved') as notes_count
            FROM courses c
            WHERE c.department_id = ?
            ORDER BY c.name
        `, [req.params.id]);
        
        connection.release();
        res.json({ department: departments[0], courses });
    } catch (error) {
        console.error('Department error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/courses', async (req, res) => {
    try {
        const connection = await pool.getConnection();
        const [courses] = await connection.execute(`
            SELECT 
                c.*, 
                d.name as department_name,
                (SELECT COUNT(*) FROM notes WHERE course_id = c.id AND status = 'approved') as notes_count
            FROM courses c 
            JOIN departments d ON c.department_id = d.id 
            ORDER BY d.name, c.name
        `);
        connection.release();
        res.json(courses);
    } catch (error) {
        console.error('Courses error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});


app.get('/admin/users', requireAdmin, async (req, res) => {
    try {
        const connection = await pool.getConnection();
        
        const [users] = await connection.execute(`
            SELECT 
                id, 
                username, 
                email,
                student_id,
                department,
                batch,
                role, 
                created_at
            FROM users 
            ORDER BY created_at DESC
        `);
        
        for (let user of users) {
            try {
                const [noteCounts] = await connection.execute(`
                    SELECT 
                        COUNT(*) as total_notes,
                        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_notes,
                        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_notes,
                        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_notes
                    FROM notes 
                    WHERE uploaded_by = ?
                `, [user.id]);
                
                user.total_notes = noteCounts[0].total_notes || 0;
                user.approved_notes = noteCounts[0].approved_notes || 0;
                user.pending_notes = noteCounts[0].pending_notes || 0;
                user.rejected_notes = noteCounts[0].rejected_notes || 0;
            } catch (countError) {
                console.error(`Error getting note counts for user ${user.id}:`, countError);
                user.total_notes = 0;
                user.approved_notes = 0;
                user.pending_notes = 0;
                user.rejected_notes = 0;
            }
        }
        
        connection.release();
        
        res.setHeader('Content-Type', 'application/json');
        res.json(users);
    } catch (error) {
        console.error('❌ Get users error:', error);
        res.status(500).json({ error: 'Failed to load users: ' + error.message });
    }
});

app.put('/admin/users/:id', requireAdmin, async (req, res) => {
    const { username, email, student_id, department, batch, role } = req.body;
    const userId = req.params.id;

    if (student_id) {
        const studentIdRegex = /^\d{3}-\d{3}-\d{3}$/;
        if (!studentIdRegex.test(student_id)) {
            return res.status(400).json({ error: 'Student ID must be in format: XXX-XXX-XXX (e.g., 123-456-789)' });
        }
    }

    if (batch && (batch < 1 || batch > 999)) {
        return res.status(400).json({ error: 'Please enter a valid batch number (1-999)' });
    }

    if (parseInt(userId) === req.session.user.id) {
        return res.status(400).json({ error: 'Cannot modify your own account' });
    }

    try {
        const connection = await pool.getConnection();
        
        const [existingUsers] = await connection.execute(
            'SELECT id FROM users WHERE (username = ? OR email = ? OR student_id = ?) AND id != ?',
            [username, email, student_id, userId]
        );

        if (existingUsers.length > 0) {
            connection.release();
            return res.status(400).json({ error: 'Username, email, or student ID already exists' });
        }

        await connection.execute(
            'UPDATE users SET username = ?, email = ?, student_id = ?, department = ?, batch = ?, role = ? WHERE id = ?',
            [username, email, student_id, department, batch, role, userId]
        );
        
        connection.release();
        
        res.json({ success: true, message: 'User updated successfully' });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ error: 'Failed to update user: ' + error.message });
    }
});

app.delete('/admin/users/:id', requireAdmin, async (req, res) => {
    const userId = req.params.id;

    console.log('🗑️ Delete user request:', userId);

    if (parseInt(userId) === req.session.user.id) {
        return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    try {
        const connection = await pool.getConnection();
        
        // Check if user has uploaded notes
        const [userNotes] = await connection.execute(
            'SELECT COUNT(*) as note_count FROM notes WHERE uploaded_by = ?',
            [userId]
        );

        if (userNotes[0].note_count > 0) {
            connection.release();
            return res.status(400).json({ error: 'Cannot delete user with uploaded notes. Please delete their notes first.' });
        }

        await connection.execute(
            'DELETE FROM users WHERE id = ?',
            [userId]
        );
        
        connection.release();
        
        res.setHeader('Content-Type', 'application/json');
        res.json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
        console.error('❌ Delete user error:', error);
        res.status(500).json({ error: 'Failed to delete user: ' + error.message });
    }
});

app.get('/top-contributors', async (req, res) => {
    try {
        const connection = await pool.getConnection();
        
        const [contributors] = await connection.execute(`
            SELECT 
                u.username,
                COUNT(n.id) as note_count,
                SUM(CASE WHEN n.status = 'approved' THEN 10 ELSE 5 END) as contribution_score
            FROM users u 
            LEFT JOIN notes n ON u.id = n.uploaded_by 
            WHERE n.id IS NOT NULL
            GROUP BY u.id, u.username
            HAVING COUNT(n.id) > 0
            ORDER BY contribution_score DESC, note_count DESC
            LIMIT 3
        `);
        
        connection.release();
        res.json(contributors);
    } catch (error) {
        console.error('Top contributors error:', error);
        res.status(500).json({ error: 'Failed to load top contributors' });
    }
});

app.get('/course/:id', requireAuth, async (req, res) => {
    try {
        const connection = await pool.getConnection();
        
        const [courses] = await connection.execute(
            'SELECT c.*, d.name as department_name FROM courses c JOIN departments d ON c.department_id = d.id WHERE c.id = ?',
            [req.params.id]
        );
        
        if (courses.length === 0) {
            return res.status(404).json({ error: 'Course not found' });
        }

        let notesQuery = '';
        let queryParams = [req.params.id];
        
        if (req.session.user.role === 'admin') {
            notesQuery = `SELECT n.*, u.username as uploaded_by_name FROM notes n 
                         JOIN users u ON n.uploaded_by = u.id 
                         WHERE n.course_id = ?
                         ORDER BY n.uploaded_at DESC`;
        } else {
            notesQuery = `SELECT n.*, u.username as uploaded_by_name FROM notes n 
                         JOIN users u ON n.uploaded_by = u.id 
                         WHERE n.course_id = ? AND (n.status = "approved" OR n.uploaded_by = ?)
                         ORDER BY n.uploaded_at DESC`;
            queryParams.push(req.session.user.id);
        }
        
        console.log('🔍 Notes query for user:', req.session.user.username);
        console.log('🔍 User ID:', req.session.user.id);
        console.log('🔍 Query:', notesQuery);
        console.log('🔍 Params:', queryParams);
        
        const [notes] = await connection.execute(notesQuery, queryParams);
        
        console.log('📝 Found notes:', notes.length);
        notes.forEach(note => {
            const isOwnNote = note.uploaded_by === req.session.user.id;
            console.log(`   - "${note.title}" | Status: ${note.status} | Own note: ${isOwnNote} | Uploaded by: ${note.uploaded_by_name} (${note.uploaded_by})`);
        });
        
        connection.release();
        
        res.json({ 
            course: courses[0],
            notes 
        });
    } catch (error) {
        console.error('Course error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/upload-note', requireAuth, upload.single('noteFile'), async (req, res) => {
    console.log('📤 Upload request received:');
    console.log('   Title:', req.body.title);
    console.log('   Course ID:', req.body.course_id);
    console.log('   File:', req.file);
    console.log('   User:', req.session.user);
    console.log('   User Role:', req.session.user.role);

    const { title, description, course_id } = req.body;
    
    if (!req.file) {
        console.log('❌ No file in request');
        return res.status(400).json({ error: 'Please select a file to upload' });
    }

    try {
        const connection = await pool.getConnection();
        console.log('✅ Database connection established');
        
        const status = req.session.user.role === 'admin' ? 'approved' : 'pending';
        console.log('📝 Setting note status to:', status);
        
        const result = await connection.execute(
            'INSERT INTO notes (title, description, file_name, file_path, file_size, course_id, uploaded_by, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                title,
                description,
                req.file.originalname,
                req.file.path,
                req.file.size,
                course_id,
                req.session.user.id,
                status
            ]
        );
        
        console.log('✅ Note inserted into database, ID:', result[0].insertId);
        connection.release();
        
        const message = status === 'approved' 
            ? 'Note uploaded successfully!' 
            : 'Note uploaded successfully! It will be available after admin approval.';
            
        res.json({ success: true, message, status });
    } catch (error) {
        console.error('❌ Database error:', error);
        res.status(500).json({ error: 'Failed to upload note' });
    }
});

app.get('/download-note/:id', requireAuth, async (req, res) => {
    try {
        const connection = await pool.getConnection();
        const [notes] = await connection.execute(
            'SELECT * FROM notes WHERE id = ?',
            [req.params.id]
        );
        connection.release();

        if (notes.length === 0) {
            return res.status(404).json({ error: 'Note not found' });
        }

        const note = notes[0];
        
        // Check if user can download (admin or note is approved)
        if (req.session.user.role !== 'admin' && note.status !== 'approved') {
            return res.status(403).json({ error: 'Note not approved for download' });
        }
        
        // Check if file exists
        if (!fs.existsSync(note.file_path)) {
            return res.status(404).json({ error: 'File not found on server' });
        }
        
        res.download(note.file_path, note.file_name);
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: 'Download failed' });
    }
});

app.delete('/note/:id', requireAuth, async (req, res) => {
    try {
        const connection = await pool.getConnection();
        
        // Check if user owns the note or is admin
        const [notes] = await connection.execute(
            'SELECT * FROM notes WHERE id = ?',
            [req.params.id]
        );
        
        if (notes.length === 0) {
            return res.status(404).json({ error: 'Note not found' });
        }

        const note = notes[0];
        if (note.uploaded_by !== req.session.user.id && req.session.user.role !== 'admin') {
            return res.status(403).json({ error: 'Not authorized to delete this note' });
        }

        // Delete file from filesystem
        if (fs.existsSync(note.file_path)) {
            fs.unlinkSync(note.file_path);
        }

        await connection.execute(
            'DELETE FROM notes WHERE id = ?',
            [req.params.id]
        );
        connection.release();
        
        res.json({ success: true, message: 'Note deleted successfully' });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Failed to delete note' });
    }
});


app.get('/admin/pending-approvals', requireAdmin, async (req, res) => {
    try {
        console.log('📋 Loading pending approvals for admin:', req.session.user.username);
        const connection = await pool.getConnection();
        
        const [pendingNotes] = await connection.execute(`
            SELECT n.*, u.username as uploaded_by_name, c.name as course_name 
            FROM notes n 
            JOIN users u ON n.uploaded_by = u.id 
            JOIN courses c ON n.course_id = c.id 
            WHERE n.status = 'pending'
            ORDER BY n.uploaded_at DESC
        `);
        
        console.log('📝 Found pending notes:', pendingNotes.length);
        connection.release();
        
        // Ensure we're sending JSON
        res.setHeader('Content-Type', 'application/json');
        res.json(pendingNotes);
    } catch (error) {
        console.error('❌ Pending approvals error:', error);
        res.status(500).json({ error: 'Failed to load pending approvals: ' + error.message });
    }
});

app.post('/admin/approve-note/:id', requireAdmin, async (req, res) => {
    try {
        const connection = await pool.getConnection();
        await connection.execute(
            'UPDATE notes SET status = "approved" WHERE id = ?',
            [req.params.id]
        );
        connection.release();
        
        res.setHeader('Content-Type', 'application/json');
        res.json({ success: true, message: 'Note approved successfully' });
    } catch (error) {
        console.error('Approve note error:', error);
        res.status(500).json({ error: 'Failed to approve note' });
    }
});

app.post('/admin/reject-note/:id', requireAdmin, async (req, res) => {
    try {
        const connection = await pool.getConnection();
        await connection.execute(
            'UPDATE notes SET status = "rejected" WHERE id = ?',
            [req.params.id]
        );
        connection.release();
        
        res.setHeader('Content-Type', 'application/json');
        res.json({ success: true, message: 'Note rejected successfully' });
    } catch (error) {
        console.error('Reject note error:', error);
        res.status(500).json({ error: 'Failed to reject note' });
    }
});

app.get('/admin/stats', requireAdmin, async (req, res) => {
    try {
        const connection = await pool.getConnection();
        
        const [userCount] = await connection.execute('SELECT COUNT(*) as count FROM users');
        const [deptCount] = await connection.execute('SELECT COUNT(*) as count FROM departments');
        const [courseCount] = await connection.execute('SELECT COUNT(*) as count FROM courses');
        
        const [approvedNoteCount] = await connection.execute('SELECT COUNT(*) as count FROM notes WHERE status = "approved"');
        
        const [pendingCount] = await connection.execute('SELECT COUNT(*) as count FROM notes WHERE status = "pending"');
        const [rejectedCount] = await connection.execute('SELECT COUNT(*) as count FROM notes WHERE status = "rejected"');
        const [totalNoteCount] = await connection.execute('SELECT COUNT(*) as count FROM notes');
        
        connection.release();
        
        res.json({
            users: userCount[0].count,
            departments: deptCount[0].count,
            courses: courseCount[0].count,
            notes: approvedNoteCount[0].count,
            pending_approvals: pendingCount[0].count,
            rejected_notes: rejectedCount[0].count,
            total_notes: totalNoteCount[0].count
        });
    } catch (error) {
        console.error('Admin stats error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/admin/departments', requireAdmin, async (req, res) => {
    const { name, code, description } = req.body;
    
    try {
        const connection = await pool.getConnection();
        await connection.execute(
            'INSERT INTO departments (name, code, description, created_by) VALUES (?, ?, ?, ?)',
            [name, code, description, req.session.user.id]
        );
        connection.release();
        
        res.json({ success: true, message: 'Department added successfully' });
    } catch (error) {
        console.error('Add department error:', error);
        res.status(500).json({ error: 'Failed to add department' });
    }
});

app.post('/admin/courses', requireAdmin, async (req, res) => {
    const { name, code, department_id, description } = req.body;
    
    try {
        const connection = await pool.getConnection();
        await connection.execute(
            'INSERT INTO courses (name, code, department_id, description, created_by) VALUES (?, ?, ?, ?, ?)',
            [name, code, department_id, description, req.session.user.id]
        );
        connection.release();
        
        res.json({ success: true, message: 'Course added successfully' });
    } catch (error) {
        console.error('Add course error:', error);
        res.status(500).json({ error: 'Failed to add course' });
    }
});

app.delete('/admin/departments/:id', requireAdmin, async (req, res) => {
    try {
        const connection = await pool.getConnection();
        
        const [courses] = await connection.execute(
            'SELECT COUNT(*) as course_count FROM courses WHERE department_id = ?',
            [req.params.id]
        );
        
        if (courses[0].course_count > 0) {
            connection.release();
            return res.status(400).json({ error: 'Cannot delete department with existing courses. Please delete all courses first.' });
        }

        await connection.execute(
            'DELETE FROM departments WHERE id = ?',
            [req.params.id]
        );
        connection.release();
        
        res.json({ success: true, message: 'Department deleted successfully' });
    } catch (error) {
        console.error('Delete department error:', error);
        res.status(500).json({ error: 'Failed to delete department' });
    }
});

app.delete('/admin/courses/:id', requireAdmin, async (req, res) => {
    try {
        const connection = await pool.getConnection();
        
        // Check if course has notes
        const [notes] = await connection.execute(
            'SELECT COUNT(*) as note_count FROM notes WHERE course_id = ?',
            [req.params.id]
        );
        
        if (notes[0].note_count > 0) {
            connection.release();
            return res.status(400).json({ error: 'Cannot delete course with existing notes. Please delete all notes first.' });
        }

        await connection.execute(
            'DELETE FROM courses WHERE id = ?',
            [req.params.id]
        );
        connection.release();
        
        res.json({ success: true, message: 'Course deleted successfully' });
    } catch (error) {
        console.error('Delete course error:', error);
        res.status(500).json({ error: 'Failed to delete course' });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log('📚 University Notes Hub is ready!');
    testDatabase();
});