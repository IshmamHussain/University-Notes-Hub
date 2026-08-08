const express = require('express');
const bcrypt = require('bcryptjs');
const cookieSession = require('cookie-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE env vars. Ensure .env is populated.");
}
const supabase = createClient(process.env.SUPABASE_URL || "", process.env.SUPABASE_SERVICE_KEY || "");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'https://university-notes-hub.vercel.app/');
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

if (!process.env.SESSION_SECRET) {
    console.warn("WARNING: SESSION_SECRET is not set! Using fallback secret.");
}

app.use(cookieSession({
    name: 'university-notes-session',
    keys: [process.env.SESSION_SECRET || 'university-notes-secret-key-change-this-in-production'],
    maxAge: 24 * 60 * 60 * 1000
}));

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 4.5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.pdf', '.doc', '.docx', '.txt', '.ppt', '.pptx'];
        const allowedMimeTypes = [
            'application/pdf', 
            'application/msword', 
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        ];
        const fileExt = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(fileExt)) {
            if (allowedMimeTypes.includes(file.mimetype) || file.mimetype === 'application/octet-stream' || file.mimetype === 'application/x-zip-compressed') {
                cb(null, true);
            } else {
                cb(new Error(`Invalid MIME type: ${file.mimetype}`));
            }
        } else {
            cb(new Error('Only document files are allowed! Invalid extension.'));
        }
    }
});

app.use((req, res, next) => {
    console.log('🔐 Session check:', {
        path: req.path,
        user: req.session.user ? req.session.user.username : 'No user',
        role: req.session.user ? req.session.user.role : 'No role'
    });
    next();
});

const requireAuth = (req, res, next) => {
    if (req.session.user) {
        next();
    } else {
        res.status(401).json({ error: 'Not authenticated' });
    }
};

const requireAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Admin access required' });
    }
};

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/check-auth', (req, res) => {
    if (req.session.user) {
        res.json(req.session.user);
    } else {
        res.status(401).json({ error: 'Not authenticated' });
    }
});

app.post('/login', async (req, res) => {
    let { username: loginQuery, password } = req.body;

    if (!loginQuery || !password) {
        return res.status(400).json({ error: 'Username/Email and password are required' });
    }
    
    // Trim spaces and handle case sensitivity for emails
    loginQuery = loginQuery.trim();
    if (loginQuery.includes('@')) {
        loginQuery = loginQuery.toLowerCase();
    }

    try {
        // Special bypass for built-in admin if needed
        if (loginQuery === 'admin') {
            const adminHash = process.env.ADMIN_PASSWORD_HASH || '$2a$10$DqF7Espfm1XTrp9J/ehY/OSSsB4F2/3cYPYerx2SfTeHUbRquHnHG';
            const isValid = await bcrypt.compare(password, adminHash);
            
            if (isValid) {
                const { data: users } = await supabase.from('users').select('*').eq('username', 'admin');
                if (users && users.length > 0) {
                    req.session.user = { id: users[0].id, username: users[0].username, role: users[0].role };
                    return res.json({ success: true, user: req.session.user });
                }
            }
        }

        // Check if loginQuery is an email or username
        let userRecord;
        if (loginQuery.includes('@')) {
            const { data } = await supabase.from('users').select('*').eq('email', loginQuery);
            userRecord = data ? data[0] : null;
        } else {
            const { data } = await supabase.from('users').select('*').eq('username', loginQuery);
            userRecord = data ? data[0] : null;
        }

        if (!userRecord) {
            return res.status(401).json({ error: 'Invalid login credentials' });
        }

        // Validate password using bcrypt
        const isMatch = await bcrypt.compare(password, userRecord.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid login credentials' });
        }

        req.session.user = {
            id: userRecord.id,
            username: userRecord.username,
            role: userRecord.role
        };

        res.json({ success: true, user: req.session.user });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
});

app.post('/register', async (req, res) => {
    let { username, email, department, password, confirmPassword } = req.body;

    // Normalize inputs
    username = username ? username.trim() : '';
    email = email ? email.trim().toLowerCase() : '';

    if (password !== confirmPassword) {
        return res.status(400).json({ error: 'Passwords do not match' });
    }

    try {
        const { error: authError } = await supabase.auth.signUp({ email, password });
        if (authError) return res.status(400).json({ error: authError.message });

        const hashedPassword = await bcrypt.hash(password, 10);

        const { error: dbError } = await supabase.from('users').insert([{
            username,
            email,
            department: department || null,
            password: hashedPassword,
            role: 'user'
        }]);

        if (dbError) throw dbError;

        res.json({ success: true, message: 'Registration successful! Please check your email to verify your account.' });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed: ' + error.message });
    }
});

app.post('/logout', (req, res) => {
    req.session = null; // Clear cookie session
    res.json({ success: true });
});

app.get('/departments', async (req, res) => {
    try {
        const { data: departments, error: dErr } = await supabase.from('department_stats').select('*').order('name');
        if (dErr) throw new Error('Database fetch failed');
        res.json(departments || []);
    } catch (error) {
        console.error('Departments error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/department/:id', async (req, res) => {
    try {
        const { data: depts, error: dErr } = await supabase.from('department_stats').select('*').eq('id', req.params.id);
        if (dErr || !depts || depts.length === 0) return res.status(404).json({ error: 'Department not found' });

        const { data: courses, error: cErr } = await supabase.from('course_stats').select('*').eq('department_id', req.params.id);
        
        res.json({ department: depts[0], courses: courses || [] });
    } catch (error) {
        console.error('Department error:', error);
        res.status(500).json({ error: 'Failed to load department' });
    }
});

app.get('/top-contributors', async (req, res) => {
    try {
        const { data: users } = await supabase.from('user_stats').select('*').gt('total_notes', 0);

        const stats = (users || []).map(user => {
            const score = (user.approved_notes * 10) + ((user.pending_notes + user.rejected_notes) * 5);
            return {
                username: user.username,
                note_count: user.total_notes,
                contribution_score: score
            };
        });

        stats.sort((a, b) => b.contribution_score - a.contribution_score || b.note_count - a.note_count);
        res.json(stats.slice(0, 3));
    } catch (error) {
        console.error('Top contributors error:', error);
        res.status(500).json({ error: 'Failed to load top contributors' });
    }
});

app.get('/courses', async (req, res) => {
    try {
        const { data: courses, error: cErr } = await supabase.from('course_stats').select('*').order('name');
        if (cErr) throw new Error('Failed to fetch courses');
        res.json(courses || []);
    } catch (error) {
        console.error('Courses error:', error);
        res.status(500).json({ error: 'Failed to load courses' });
    }
});

app.get('/course/:id', requireAuth, async (req, res) => {
    try {
        const { data: courses } = await supabase.from('courses').select('*').eq('id', req.params.id);
        if (!courses || courses.length === 0) return res.status(404).json({ error: 'Course not found' });

        const { data: depts } = await supabase.from('departments').select('name').eq('id', courses[0].department_id);
        const courseData = { ...courses[0], department_name: depts && depts.length > 0 ? depts[0].name : 'Unknown' };

        let notesQuery = supabase.from('notes').select('*, users(username)').eq('course_id', req.params.id).order('uploaded_at', { ascending: false });

        if (req.session.user.role !== 'admin') {
            notesQuery = notesQuery.or(`status.eq.approved,uploaded_by.eq.${req.session.user.id}`);
        }

        const { data: notesData } = await notesQuery;

        const formattedNotes = (notesData || []).map(note => ({
            ...note,
            uploaded_by_name: note.users ? note.users.username : 'Unknown'
        }));

        res.json({ course: courseData, notes: formattedNotes });
    } catch (error) {
        console.error('Course error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/upload-note', requireAuth, upload.single('noteFile'), async (req, res) => {
    const { title, description, course_id } = req.body;
    if (!req.file) return res.status(400).json({ error: 'Please select a file to upload' });

    try {
        const fileExt = path.extname(req.file.originalname).toLowerCase();
        const uniqueFileName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${fileExt}`;

        const { error: storageError } = await supabase.storage
            .from('notes')
            .upload(uniqueFileName, req.file.buffer, { contentType: req.file.mimetype, upsert: false });

        if (storageError) throw new Error('Supabase Storage Error: ' + storageError.message);

        const { data: urlData } = supabase.storage.from('notes').getPublicUrl(uniqueFileName);
        const status = req.session.user.role === 'admin' ? 'approved' : 'pending';

        const { error: dbError } = await supabase.from('notes').insert([{
            title, description, file_name: req.file.originalname, file_path: urlData.publicUrl,
            file_size: req.file.size, course_id, uploaded_by: req.session.user.id, status
        }]);

        if (dbError) throw dbError;

        const message = status === 'approved' ? 'Note uploaded successfully!' : 'Note uploaded successfully! It will be available after admin approval.';
        res.json({ success: true, message, status });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Failed to upload note' });
    }
});

app.get('/download-note/:id', requireAuth, async (req, res) => {
    try {
        const { data: notes } = await supabase.from('notes').select('*').eq('id', req.params.id);
        if (!notes || notes.length === 0) return res.status(404).json({ error: 'Note not found' });

        const note = notes[0];
        if (req.session.user.role !== 'admin' && note.status !== 'approved') {
            return res.status(403).json({ error: 'Note not approved for download' });
        }
        res.json({ url: note.file_path + '?download=' });
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: 'Download failed' });
    }
});

app.delete('/note/:id', requireAuth, async (req, res) => {
    try {
        const { data: notes } = await supabase.from('notes').select('*').eq('id', req.params.id);
        if (!notes || notes.length === 0) return res.status(404).json({ error: 'Note not found' });

        const note = notes[0];
        if (note.uploaded_by !== req.session.user.id && req.session.user.role !== 'admin') {
            return res.status(403).json({ error: 'Not authorized to delete this note' });
        }

        if (note.file_path && note.file_path.includes('supabase.co')) {
            const pathParts = note.file_path.split('/');
            await supabase.storage.from('notes').remove([pathParts[pathParts.length - 1]]);
        }

        await supabase.from('notes').delete().eq('id', req.params.id);
        res.json({ success: true, message: 'Note deleted successfully' });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Failed to delete note' });
    }
});

app.get('/admin/pending-approvals', requireAdmin, async (req, res) => {
    try {
        const { data: notes } = await supabase.from('notes').select('*, users(username), courses(name)').eq('status', 'pending').order('uploaded_at', { ascending: false });

        const formattedNotes = (notes || []).map(note => ({
            ...note,
            uploaded_by_name: note.users ? note.users.username : 'Unknown',
            course_name: note.courses ? note.courses.name : 'Unknown'
        }));

        res.json(formattedNotes);
    } catch (error) {
        console.error('Pending approvals error:', error);
        res.status(500).json({ error: 'Failed to load pending approvals' });
    }
});

app.post('/admin/approve-note/:id', requireAdmin, async (req, res) => {
    try {
        await supabase.from('notes').update({ status: 'approved' }).eq('id', req.params.id);
        res.json({ success: true, message: 'Note approved successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to approve note' });
    }
});

app.post('/admin/reject-note/:id', requireAdmin, async (req, res) => {
    try {
        await supabase.from('notes').update({ status: 'rejected' }).eq('id', req.params.id);
        res.json({ success: true, message: 'Note rejected successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to reject note' });
    }
});

app.get('/admin/stats', requireAdmin, async (req, res) => {
    try {
        const { count: uCount } = await supabase.from('users').select('*', { count: 'exact', head: true });
        const { count: dCount } = await supabase.from('departments').select('*', { count: 'exact', head: true });
        const { count: cCount } = await supabase.from('courses').select('*', { count: 'exact', head: true });
        const { count: nAppr } = await supabase.from('notes').select('*', { count: 'exact', head: true }).eq('status', 'approved');
        const { count: nPend } = await supabase.from('notes').select('*', { count: 'exact', head: true }).eq('status', 'pending');
        const { count: nRej } = await supabase.from('notes').select('*', { count: 'exact', head: true }).eq('status', 'rejected');
        const { count: nTotal } = await supabase.from('notes').select('*', { count: 'exact', head: true });

        res.json({
            users: uCount || 0, departments: dCount || 0, courses: cCount || 0,
            notes: nAppr || 0, pending_approvals: nPend || 0, rejected_notes: nRej || 0, total_notes: nTotal || 0
        });
    } catch (error) {
        console.error('Admin stats error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/admin/departments', requireAdmin, async (req, res) => {
    const { name, code, description } = req.body;
    try {
        await supabase.from('departments').insert([{ name, code, description, created_by: req.session.user.id }]);
        res.json({ success: true, message: 'Department added successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to add department' });
    }
});

app.post('/admin/courses', requireAdmin, async (req, res) => {
    const { name, code, department_id, description } = req.body;
    try {
        await supabase.from('courses').insert([{ name, code, department_id, description, created_by: req.session.user.id }]);
        res.json({ success: true, message: 'Course added successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to add course' });
    }
});

app.delete('/admin/departments/:id', requireAdmin, async (req, res) => {
    try {
        const { count } = await supabase.from('courses').select('*', { count: 'exact', head: true }).eq('department_id', req.params.id);
        if (count > 0) return res.status(400).json({ error: 'Cannot delete department with existing courses.' });

        await supabase.from('departments').delete().eq('id', req.params.id);
        res.json({ success: true, message: 'Department deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete department' });
    }
});

app.delete('/admin/courses/:id', requireAdmin, async (req, res) => {
    try {
        const { count } = await supabase.from('notes').select('*', { count: 'exact', head: true }).eq('course_id', req.params.id);
        if (count > 0) return res.status(400).json({ error: 'Cannot delete course with existing notes.' });

        await supabase.from('courses').delete().eq('id', req.params.id);
        res.json({ success: true, message: 'Course deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete course' });
    }
});

app.get('/admin/users', requireAdmin, async (req, res) => {
    try {
        const { data: users, error } = await supabase.from('user_stats').select('*').order('created_at', { ascending: false });
        if (error) throw new Error('Database fetch failed');
        res.json(users || []);
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Failed to load users' });
    }
});

app.put('/admin/users/:id', requireAdmin, async (req, res) => {
    let { username, email, student_id, department, batch, role } = req.body;
    username = username ? username.trim() : null;
    email = email ? email.trim().toLowerCase() : null;
    try {
        await supabase.from('users').update({ username, email, student_id, department, batch, role }).eq('id', req.params.id);
        res.json({ success: true, message: 'User updated successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update user' });
    }
});

app.delete('/admin/users/:id', requireAdmin, async (req, res) => {
    try {
        await supabase.from('users').delete().eq('id', req.params.id);
        res.json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

app.get('/verified', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Verification Successful</title>
            <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap" rel="stylesheet">
            <style>
                body { 
                    font-family: 'Poppins', sans-serif; 
                    display: flex; 
                    align-items: center; 
                    justify-content: center; 
                    height: 100vh; 
                    background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%); 
                    margin: 0; 
                }
                .card { 
                    background: white; 
                    padding: 3rem; 
                    border-radius: 16px; 
                    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1); 
                    text-align: center;
                    max-width: 400px;
                }
                .icon { 
                    background: linear-gradient(135deg, #10b981, #34d399);
                    color: white; 
                    width: 80px; 
                    height: 80px; 
                    border-radius: 50%; 
                    display: flex; 
                    align-items: center; 
                    justify-content: center; 
                    font-size: 2.5rem; 
                    margin: 0 auto 1.5rem; 
                }
                h2 { color: #0f172a; margin-bottom: 0.5rem; }
                p { color: #64748b; margin-bottom: 2rem; }
                a { 
                    display: inline-block; 
                    padding: 12px 24px; 
                    background: linear-gradient(135deg, #1e3a8a, #1e40af); 
                    color: white; 
                    text-decoration: none; 
                    border-radius: 50px; 
                    font-weight: 600;
                    transition: transform 0.3s ease, box-shadow 0.3s ease;
                }
                a:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 8px 20px rgba(30, 58, 138, 0.3);
                }
            </style>
        </head>
        <body>
            <div class="card">
                <div class="icon">✓</div>
                <h2>Verification Successful!</h2>
                <p>Your student email has been successfully verified.</p>
                <a href="/login">Return to Login</a>
            </div>
        </body>
        </html>
    `);
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.use((err, req, res, next) => {
    console.error('Express error:', err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
        console.log('📚 University Notes Hub is ready locally (Supabase connected)!');
    });
}

module.exports = app;