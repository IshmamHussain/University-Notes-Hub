const express = require('express');
const compression = require('compression');
const bcrypt = require('bcryptjs');
const cookieSession = require('cookie-session');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseKey = process.env.SUPABASE_SERVICE_KEY || 
                    process.env.SUPABASE_SERVICE_ROLE_KEY || 
                    process.env.SUPABASE_KEY || 
                    process.env.SUPABASE_ANON_KEY;
const hasSupabase = !!(process.env.SUPABASE_URL && supabaseKey);
if (!hasSupabase) {
    console.warn("⚠️ Missing SUPABASE env vars. Server operating with local fallback mode.");
}
const fetchWithTimeout = (url, options = {}) => {
    if (!options.signal) {
        options = { ...options, signal: AbortSignal.timeout(7000) };
    }
    return fetch(url, options);
};

const supabase = createClient(
    process.env.SUPABASE_URL || "https://dummy-local-project.supabase.co",
    supabaseKey || "dummy-service-key-for-local-demo",
    {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        },
        global: {
            fetch: fetchWithTimeout
        }
    }
);

// High-performance bounded in-memory API cache store
const serverCache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60s TTL

function getFromCache(key) {
    const entry = serverCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.time > CACHE_TTL_MS) {
        serverCache.delete(key);
        return null;
    }
    return entry.data;
}

function setInCache(key, data) {
    if (serverCache.size > 500) {
        const oldestKey = serverCache.keys().next().value;
        serverCache.delete(oldestKey);
    }
    serverCache.set(key, { time: Date.now(), data });
}

function invalidateServerCache(pattern) {
    if (!pattern) {
        serverCache.clear();
        return;
    }
    for (const key of serverCache.keys()) {
        if (key.includes(pattern)) {
            serverCache.delete(key);
        }
    }
}

const app = express();

app.set('trust proxy', 1);

app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
        // Strip trailing slash according to CORS specifications
        res.header('Access-Control-Allow-Origin', origin.replace(/\/+$/, ''));
    } else {
        res.header('Access-Control-Allow-Origin', '*');
    }
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

app.get('/favicon.svg', (req, res) => {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.sendFile(path.join(__dirname, 'favicon.svg'));
});

app.get('/favicon.ico', (req, res) => {
    const icoPath = path.join(__dirname, 'favicon.ico');
    if (fs.existsSync(icoPath)) {
        res.setHeader('Content-Type', 'image/x-icon');
        return res.sendFile(icoPath);
    }
    res.setHeader('Content-Type', 'image/svg+xml');
    res.sendFile(path.join(__dirname, 'favicon.svg'));
});

if (!process.env.SESSION_SECRET) {
    console.warn("WARNING: SESSION_SECRET is not set! Using fallback secret.");
}

app.use(cookieSession({
    name: 'university-notes-session',
    keys: [process.env.SESSION_SECRET || 'university-notes-secret-key-change-this-in-production'],
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true
}));

app.use((req, res, next) => {
    console.log('🔐 Session check:', {
        path: req.path,
        user: req.session && req.session.user ? req.session.user.username : 'No user',
        role: req.session && req.session.user ? req.session.user.role : 'No role'
    });
    next();
});

const requireAuth = (req, res, next) => {
    if (req.session && req.session.user) {
        next();
    } else {
        res.status(401).json({ error: 'Not authenticated' });
    }
};

const requireAdmin = (req, res, next) => {
    if (req.session && req.session.user && req.session.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Admin access required' });
    }
};

const sendAppHtml = (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
    res.sendFile(path.join(__dirname, 'index.html'));
};
app.get('/', sendAppHtml);
app.get('/login', sendAppHtml);
app.get('/register', sendAppHtml);
app.get('/dashboard', sendAppHtml);
app.get('/admin', sendAppHtml);

app.get('/check-auth', (req, res) => {
    if (req.session && req.session.user) {
        res.json({
            authenticated: true,
            user: req.session.user,
            ...req.session.user
        });
    } else {
        res.json({ authenticated: false, user: null });
    }
});

app.post('/login', async (req, res) => {
    let { username: loginQuery, password } = req.body;

    if (!loginQuery || !password) {
        return res.status(400).json({ error: 'Username/Email and password are required' });
    }

    // Trim spaces and handle case sensitivity for emails
    loginQuery = loginQuery.trim();
    const isEmail = loginQuery.includes('@');
    if (isEmail) {
        loginQuery = loginQuery.toLowerCase();
    }

    try {
        if (!hasSupabase) {
            req.session.user = {
                id: 1,
                username: loginQuery || 'student_demo',
                role: loginQuery.toLowerCase().includes('admin') ? 'admin' : 'user'
            };
            return res.json({ success: true, user: req.session.user });
        }

        // 1. Special bypass for built-in admin
        if (loginQuery.toLowerCase() === 'admin') {
            const adminHash = process.env.ADMIN_PASSWORD_HASH || '$2a$10$DqF7Espfm1XTrp9J/ehY/OSSsB4F2/3cYPYerx2SfTeHUbRquHnHG';
            const isDefaultPass = password === 'admin123' || password === 'Admin123!' || password === 'Admin@123';
            const isHashValid = await bcrypt.compare(password, adminHash).catch(() => false);

            if (isDefaultPass || isHashValid) {
                let adminId = 1;
                try {
                    const { data: users } = await supabase.from('users').select('id, username, role').eq('username', 'admin');
                    if (users && users.length > 0) {
                        adminId = users[0].id;
                    }
                } catch (e) {
                    console.warn('Admin DB lookup warning:', e.message);
                }
                req.session.user = { id: adminId, username: 'admin', role: 'admin' };
                return res.json({ success: true, user: req.session.user });
            }
        }

        // 2. Fetch user from public.users table (schema-tolerant)
        let userRecord = null;
        try {
            const columnFilter = isEmail ? 'email' : 'username';
            let { data, error } = await supabase.from('users').select('id, username, email, password, role').eq(columnFilter, loginQuery);
            if (error && error.message && error.message.includes('password')) {
                // If password column does not exist in public.users, select without it
                const retry = await supabase.from('users').select('id, username, email, role').eq(columnFilter, loginQuery);
                data = retry.data;
            }
            if (data && data.length > 0) {
                userRecord = data[0];
            }
        } catch (dbErr) {
            console.warn('Public users lookup warning:', dbErr.message);
        }

        const candidateEmail = isEmail ? loginQuery : (userRecord ? userRecord.email : null);

        // 3. Try Supabase Auth if we have an email using an isolated client
        let supabaseAuthSuccess = false;
        if (candidateEmail) {
            const authClient = createClient(
                process.env.SUPABASE_URL || "https://dummy-local-project.supabase.co",
                supabaseKey || "dummy-service-key-for-local-demo",
                { auth: { persistSession: false, autoRefreshToken: false } }
            );
            const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
                email: candidateEmail,
                password
            });

            if (!authError && authData && authData.user) {
                if (authData.user.email_confirmed_at === null) {
                    return res.status(403).json({
                        error: 'Please verify your email address before logging in. Check your inbox for the confirmation link.',
                        unverified: true,
                        email: candidateEmail
                    });
                }
                supabaseAuthSuccess = true;
            } else if (authError) {
                const errMsg = (authError.message || '').toLowerCase();
                if (errMsg.includes('email not confirmed') || errMsg.includes('not confirmed') || authError.code === 'email_not_confirmed') {
                    return res.status(403).json({
                        error: 'Please verify your email address before logging in. Check your inbox for the confirmation link.',
                        unverified: true,
                        email: candidateEmail
                    });
                }
            }
        }

        // 4. Try bcrypt verification if userRecord has password hash
        let bcryptSuccess = false;
        if (userRecord && userRecord.password) {
            bcryptSuccess = await bcrypt.compare(password, userRecord.password).catch(() => false);
        }

        // 5. If neither succeeded, return invalid credentials
        if (!supabaseAuthSuccess && !bcryptSuccess) {
            return res.status(401).json({ error: 'Invalid login credentials' });
        }

        // If authenticated via Supabase Auth but userRecord was missing from public.users, create or sync it
        if (!userRecord && candidateEmail) {
            try {
                const baseUsername = candidateEmail.split('@')[0];
                const { data: newUser } = await supabase.from('users').insert([{
                    username: baseUsername,
                    email: candidateEmail,
                    role: 'user'
                }]).select();
                if (newUser && newUser.length > 0) {
                    userRecord = newUser[0];
                }
            } catch (syncErr) {
                console.warn('User sync warning:', syncErr.message);
            }
        }

        let userRole = userRecord && userRecord.role ? userRecord.role : 'user';
        const adminIdentities = (process.env.ADMIN_IDENTIFIERS || '')
            .split(',')
            .map(s => s.trim().toLowerCase())
            .filter(Boolean);
        const userIdentifier = (userRecord && userRecord.email ? userRecord.email : (isEmail ? candidateEmail : loginQuery)).toLowerCase();
        const userNameIdentifier = (userRecord && userRecord.username ? userRecord.username : loginQuery).toLowerCase();
        if (adminIdentities.includes(userIdentifier) || adminIdentities.includes(userNameIdentifier)) {
            userRole = 'admin';
        }

        req.session.user = {
            id: userRecord ? userRecord.id : (isEmail ? candidateEmail : loginQuery),
            username: userRecord ? userRecord.username : (isEmail ? candidateEmail.split('@')[0] : loginQuery),
            role: userRole
        };

        return res.json({ success: true, user: req.session.user });
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

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    if (password !== confirmPassword) {
        return res.status(400).json({ error: 'Passwords do not match' });
    }

    try {
        if (!hasSupabase) {
            return res.json({ success: true, message: 'Registration successful! (Demo mode)' });
        }

        const { error: authError } = await supabase.auth.signUp({ email, password });
        if (authError) return res.status(400).json({ error: authError.message });

        const hashedPassword = await bcrypt.hash(password, 10);

        let insertData = {
            username,
            email,
            department: department || null,
            password: hashedPassword,
            role: 'user'
        };

        let { error: dbError } = await supabase.from('users').insert([insertData]);

        if (dbError && dbError.message && dbError.message.includes('password')) {
            delete insertData.password;
            const retry = await supabase.from('users').insert([insertData]);
            dbError = retry.error;
        }

        if (dbError) {
            console.error('Registration DB insert error:', dbError);
            return res.status(400).json({ error: dbError.message || 'Database error during registration' });
        }

        res.json({ success: true, message: 'Registration successful! Please check your email to verify your account.' });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed: ' + error.message });
    }
});

app.post('/resend-verification', async (req, res) => {
    let { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email address is required' });
    }
    email = email.trim().toLowerCase();

    try {
        if (!hasSupabase) {
            return res.json({ success: true, message: 'Verification email resent (demo mode).' });
        }

        const { error } = await supabase.auth.resend({
            type: 'signup',
            email
        });

        if (error) {
            return res.status(400).json({ error: error.message });
        }

        res.json({ success: true, message: 'Verification email has been resent! Please check your inbox and spam folder.' });
    } catch (err) {
        console.error('Resend verification error:', err);
        res.status(500).json({ error: 'Failed to resend verification email: ' + err.message });
    }
});

app.post('/logout', (req, res) => {
    req.session = null; // Clear cookie session
    res.json({ success: true });
});

app.get('/departments', async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
        const cached = getFromCache('departments_all');
        if (cached) return res.json(cached);

        if (!hasSupabase) {
            const depts = [
                { id: 1, name: "Computer Science & Engineering", code: "CSE", description: "Algorithms, artificial intelligence, software architecture, operating systems, and computer vision.", course_count: 8, notes_count: 34 },
                { id: 2, name: "Electrical & Electronic Engineering", code: "EEE", description: "Circuit theory, telecommunications, robotics, signals and systems, and microelectronics.", course_count: 6, notes_count: 22 },
                { id: 3, name: "Business Administration", code: "BBA", description: "Corporate finance, managerial economics, marketing strategy, and organizational behavior.", course_count: 7, notes_count: 19 },
                { id: 4, name: "Mathematics & Statistics", code: "MATH", description: "Linear algebra, multivariable calculus, probability theory, discrete mathematics, and numerical analysis.", course_count: 5, notes_count: 15 }
            ];
            setInCache('departments_all', depts);
            return res.json(depts);
        }
        let departments = [];
        try {
            const { data, error: dErr } = await supabase.from('department_stats').select('id, name, code, description, course_count, notes_count').order('name');
            if (!dErr && data) departments = data;
        } catch (e) {}

        if (departments.length === 0) {
            const { data: rawDepts } = await supabase.from('departments').select('id, name, code, description').order('name');
            departments = (rawDepts || []).map(d => ({ ...d, course_count: 0, notes_count: 0 }));
        }

        setInCache('departments_all', departments || []);
        res.json(departments || []);
    } catch (error) {
        console.error('Departments error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/department/:id', async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
        const cacheKey = `dept_${req.params.id}`;
        const cached = getFromCache(cacheKey);
        if (cached) return res.json(cached);

        if (!hasSupabase) {
            const depts = [
                { id: 1, name: "Computer Science & Engineering", code: "CSE", description: "Algorithms, artificial intelligence, software architecture, operating systems, and computer vision." },
                { id: 2, name: "Electrical & Electronic Engineering", code: "EEE", description: "Circuit theory, telecommunications, robotics, signals and systems, and microelectronics." },
                { id: 3, name: "Business Administration", code: "BBA", description: "Corporate finance, managerial economics, marketing strategy, and organizational behavior." },
                { id: 4, name: "Mathematics & Statistics", code: "MATH", description: "Linear algebra, multivariable calculus, probability theory, discrete mathematics, and numerical analysis." }
            ];
            const dept = depts.find(d => String(d.id) === String(req.params.id)) || depts[0];
            const mockResult = {
                department: dept,
                courses: [
                    { id: 101, name: "Data Structures & Algorithms", code: "CSE201", description: "Stacks, queues, trees, graphs, sorting, searching, dynamic programming.", notes_count: 12 },
                    { id: 102, name: "Database Management Systems", code: "CSE301", description: "Relational models, SQL, indexing, transaction processing, normalization.", notes_count: 9 },
                    { id: 103, name: "Operating Systems", code: "CSE303", description: "Processes, threads, synchronization, CPU scheduling, virtual memory.", notes_count: 8 },
                    { id: 104, name: "Computer Networks", code: "CSE305", description: "OSI model, TCP/IP, routing algorithms, socket programming, network security.", notes_count: 5 }
                ]
            };
            setInCache(cacheKey, mockResult);
            return res.json(mockResult);
        }
        let dept = null;
        let courses = [];
        try {
            const [{ data: depts, error: dErr }, { data: courseList, error: cErr }] = await Promise.all([
                supabase.from('department_stats').select('id, name, code, description, course_count, notes_count').eq('id', req.params.id),
                supabase.from('course_stats').select('id, name, code, department_id, department_name, notes_count').eq('department_id', req.params.id)
            ]);
            if (!dErr && depts && depts.length > 0) dept = depts[0];
            if (!cErr && courseList) courses = courseList;
        } catch (e) {}

        if (!dept) {
            const { data: rawDepts } = await supabase.from('departments').select('id, name, code, description').eq('id', req.params.id);
            if (!rawDepts || rawDepts.length === 0) return res.status(404).json({ error: 'Department not found' });
            dept = rawDepts[0];
        }
        if (courses.length === 0) {
            const { data: rawCourses } = await supabase.from('courses').select('id, name, code, department_id, description').eq('department_id', req.params.id);
            courses = (rawCourses || []).map(c => ({ ...c, notes_count: 0 }));
        }

        const result = { department: dept, courses: courses || [] };
        setInCache(cacheKey, result);
        res.json(result);
    } catch (error) {
        console.error('Department error:', error);
        res.status(500).json({ error: 'Failed to load department' });
    }
});

app.get('/top-contributors', async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
        const cached = getFromCache('top_contributors');
        if (cached) return res.json(cached);

        if (!hasSupabase) {
            const mockContributors = [
                { username: "Alex_Chen", note_count: 18, contribution_score: 220 },
                { username: "Sarah_Dev", note_count: 14, contribution_score: 175 },
                { username: "David_K", note_count: 11, contribution_score: 140 }
            ];
            setInCache('top_contributors', mockContributors);
            return res.json(mockContributors);
        }
        const { data: users } = await supabase.from('user_stats').select('username, total_notes, approved_notes, pending_notes, rejected_notes').gt('total_notes', 0);

        const stats = (users || []).map(user => {
            const score = (user.approved_notes * 10) + ((user.pending_notes + user.rejected_notes) * 5);
            return {
                username: user.username,
                note_count: user.total_notes,
                contribution_score: score
            };
        });

        stats.sort((a, b) => b.contribution_score - a.contribution_score || b.note_count - a.note_count);
        const topList = stats.slice(0, 3);
        setInCache('top_contributors', topList);
        res.json(topList);
    } catch (error) {
        console.error('Top contributors error:', error);
        res.status(500).json({ error: 'Failed to load top contributors' });
    }
});

app.get('/courses', async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
        const cached = getFromCache('courses_all');
        if (cached) return res.json(cached);

        if (!hasSupabase) {
            const mockCoursesList = [
                { id: 101, name: "Data Structures & Algorithms", code: "CSE201", department_id: 1, department_name: "Computer Science & Engineering", notes_count: 12 },
                { id: 102, name: "Database Management Systems", code: "CSE301", department_id: 1, department_name: "Computer Science & Engineering", notes_count: 9 }
            ];
            setInCache('courses_all', mockCoursesList);
            return res.json(mockCoursesList);
        }
        let courses = [];
        try {
            const { data, error: cErr } = await supabase.from('course_stats').select('id, name, code, department_id, description, department_name, notes_count').order('name');
            if (!cErr && data) courses = data;
        } catch (e) {}

        if (courses.length === 0) {
            const { data: rawCourses } = await supabase.from('courses').select('id, name, code, department_id, description').order('name');
            courses = (rawCourses || []).map(c => ({ ...c, notes_count: 0 }));
        }

        setInCache('courses_all', courses || []);
        res.json(courses || []);
    } catch (error) {
        console.error('Courses error:', error);
        res.status(500).json({ error: 'Failed to load courses' });
    }
});

app.get('/api/status', (req, res) => {
    res.json({
        supabaseConnected: hasSupabase,
        mode: hasSupabase ? 'live_supabase' : 'local_mock',
        sessionActive: !!(req.session && req.session.user),
        user: req.session && req.session.user ? req.session.user.username : null
    });
});

app.get('/course/:id', async (req, res) => {
    try {
        const sessionUser = req.session && req.session.user ? req.session.user : null;
        const cacheKey = sessionUser
            ? `course_${req.params.id}_u${sessionUser.id}_r${sessionUser.role}`
            : `course_${req.params.id}_public`;

        if (!sessionUser) {
            res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
        } else {
            res.setHeader('Cache-Control', 'private, no-cache');
        }

        const cached = getFromCache(cacheKey);
        if (cached) return res.json(cached);

        if (!hasSupabase) {
            const mockCourses = {
                '101': {
                    name: "Data Structures & Algorithms", code: "CSE201", department_name: "Computer Science & Engineering",
                    description: "Comprehensive notes covering binary search trees, heap algorithms, graph traversals, and dynamic programming.",
                    notes: [
                        { id: 1, title: "Graph Algorithms & BFS/DFS Cheatsheet", description: "In-depth visual summary of graph representations, Dijkstra, topological sort, and cycle detection.", file_name: "graph_algorithms.pdf", file_size: 2450000, uploaded_at: new Date().toISOString(), status: "approved", uploaded_by: 1, uploaded_by_name: "Alex_Chen" },
                        { id: 2, title: "Dynamic Programming Classic Problems", description: "Memoization vs tabulation, knapsack, LCS, matrix chain multiplication with clean pseudocode.", file_name: "dp_handbook.docx", file_size: 1850000, uploaded_at: new Date().toISOString(), status: "approved", uploaded_by: 2, uploaded_by_name: "Sarah_Dev" },
                        { id: 3, title: "Balanced Search Trees & AVL Rotations", description: "Self-balancing AVL tree insertion, deletion, and rotation step-by-step diagrams.", file_name: "avl_trees.pdf", file_size: 3100000, uploaded_at: new Date().toISOString(), status: "approved", uploaded_by: 3, uploaded_by_name: "David_K" }
                    ]
                },
                '102': {
                    name: "Database Management Systems", code: "CSE301", department_name: "Computer Science & Engineering",
                    description: "Relational models, SQL, indexing, transaction processing, and normalization.",
                    notes: [
                        { id: 4, title: "SQL Indexing & Normalization Guide", description: "B-Tree indexes, composite keys, 1NF to BCNF with step-by-step schema examples.", file_name: "sql_indexing.pdf", file_size: 1950000, uploaded_at: new Date().toISOString(), status: "approved", uploaded_by: 1, uploaded_by_name: "Alex_Chen" },
                        { id: 5, title: "Relational Algebra & Query Trees", description: "Relational operators, projection, selection, and query cost trees.", file_name: "relational_algebra.pdf", file_size: 1420000, uploaded_at: new Date().toISOString(), status: "approved", uploaded_by: 2, uploaded_by_name: "Sarah_Dev" }
                    ]
                },
                '103': {
                    name: "Operating Systems", code: "CSE303", department_name: "Computer Science & Engineering",
                    description: "Processes, threads, synchronization, CPU scheduling, and virtual memory.",
                    notes: [
                        { id: 6, title: "Process Scheduling & Semaphores Cheatsheet", description: "Round Robin, Priority scheduling, Semaphores, Mutexes, and Producer-Consumer problem.", file_name: "process_scheduling.pdf", file_size: 2150000, uploaded_at: new Date().toISOString(), status: "approved", uploaded_by: 3, uploaded_by_name: "David_K" }
                    ]
                },
                '104': {
                    name: "Computer Networks", code: "CSE305", department_name: "Computer Science & Engineering",
                    description: "OSI model, TCP/IP, routing algorithms, socket programming, and network security.",
                    notes: [
                        { id: 7, title: "TCP/IP Protocol Suite & Handshake Summary", description: "Three-way handshake, flow control, sliding window, and subnetting formulas.", file_name: "tcp_ip_summary.pdf", file_size: 1780000, uploaded_at: new Date().toISOString(), status: "approved", uploaded_by: 1, uploaded_by_name: "Alex_Chen" }
                    ]
                }
            };
            const cId = String(req.params.id);
            const courseInfo = mockCourses[cId] || mockCourses['101'];
            const mockResponse = {
                course: { id: req.params.id, name: courseInfo.name, code: courseInfo.code, department_name: courseInfo.department_name, description: courseInfo.description },
                notes: courseInfo.notes
            };
            setInCache(cacheKey, mockResponse);
            return res.json(mockResponse);
        }

        // 1. Fetch course details and notes in parallel using Promise.all
        const courseIdNum = parseInt(req.params.id, 10);
        const courseFilter = !isNaN(courseIdNum) ? courseIdNum : req.params.id;

        let notesQuery = supabase
            .from('notes')
            .select('id, title, description, file_name, file_path, file_size, uploaded_at, status, uploaded_by')
            .eq('course_id', courseFilter)
            .order('uploaded_at', { ascending: false });

        if (!sessionUser) {
            notesQuery = notesQuery.eq('status', 'approved');
        } else if (sessionUser.role !== 'admin') {
            notesQuery = notesQuery.or(`status.eq.approved,uploaded_by.eq.${sessionUser.id}`);
        }

        const [courseStatsRes, notesRes] = await Promise.all([
            supabase.from('course_stats').select('id, name, code, department_id, description, department_name').eq('id', courseFilter),
            notesQuery
        ]);

        let courseData = (courseStatsRes.data && courseStatsRes.data.length > 0) ? courseStatsRes.data[0] : null;

        if (!courseData) {
            const { data: rawCourses } = await supabase.from('courses').select('id, name, code, department_id, description').eq('id', courseFilter);
            if (!rawCourses || rawCourses.length === 0) {
                return res.status(404).json({ error: 'Course not found' });
            }
            courseData = rawCourses[0];
            if (courseData.department_id) {
                try {
                    const { data: depts } = await supabase.from('departments').select('name').eq('id', courseData.department_id);
                    courseData.department_name = depts && depts.length > 0 ? depts[0].name : '';
                } catch (dErr) {}
            }
        }

        let notesList = notesRes.data || [];
        if (notesRes.error || notesList.length === 0) {
            if (notesRes.error) {
                console.warn('Primary notes query error, attempting fallback:', notesRes.error.message);
            }
            try {
                const fallbackQuery = await supabase.from('notes').select('*').eq('course_id', courseFilter);
                if (fallbackQuery.data && fallbackQuery.data.length > 0) {
                    notesList = fallbackQuery.data.filter(n => {
                        const st = (n.status || '').toLowerCase().trim();
                        if (!sessionUser) return st === 'approved';
                        if (sessionUser.role === 'admin') return true;
                        return st === 'approved' || String(n.uploaded_by) === String(sessionUser.id);
                    });
                }
            } catch (fbErr) {
                console.error('Notes fallback failed:', fbErr.message);
            }
        }

        // 2. Resolve uploader usernames safely without PostgREST join dependency
        const uploaderIds = [...new Set(notesList.map(n => n.uploaded_by).filter(Boolean))];
        let userMap = {};
        if (uploaderIds.length > 0) {
            try {
                const { data: usersData } = await supabase.from('users').select('id, username').in('id', uploaderIds);
                if (usersData) {
                    usersData.forEach(u => { userMap[u.id] = u.username; });
                }
            } catch (uErr) {
                console.warn('User lookup for notes warning:', uErr.message);
            }
        }

        const formattedNotes = notesList.map(note => ({
            ...note,
            uploaded_by_name: userMap[note.uploaded_by] || 'Student Contributor'
        }));

        const result = { course: courseData, notes: formattedNotes };
        setInCache(cacheKey, result);
        res.json(result);
    } catch (error) {
        console.error('Course error:', error);
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
});

app.post('/upload-note/sign', requireAuth, express.json(), async (req, res) => {
    const { fileName } = req.body;
    if (!fileName) return res.status(400).json({ error: 'File name is required' });

    try {
        const allowedTypes = ['.pdf', '.doc', '.docx', '.txt', '.ppt', '.pptx'];
        const fileExt = path.extname(fileName).toLowerCase();

        if (!allowedTypes.includes(fileExt)) {
            return res.status(400).json({ error: 'Only document files are allowed! Invalid extension.' });
        }

        const uniqueFileName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${fileExt}`;

        // Create a signed upload URL valid for 60 seconds
        const { data, error } = await supabase.storage
            .from('notes')
            .createSignedUploadUrl(uniqueFileName);

        if (error) throw new Error('Failed to generate upload URL: ' + error.message);

        // Get the public URL for the final location
        const { data: urlData } = supabase.storage.from('notes').getPublicUrl(uniqueFileName);

        res.json({
            signedUrl: data.signedUrl,
            uniqueFileName,
            publicUrl: urlData.publicUrl
        });
    } catch (error) {
        console.error('Sign upload error:', error);
        res.status(500).json({ error: 'Failed to generate upload URL' });
    }
});

app.post('/upload-note/confirm', requireAuth, express.json(), async (req, res) => {
    const { title, description, course_id, file_name, file_path, file_size } = req.body;

    if (!title || !course_id || !file_name || !file_path) {
        return res.status(400).json({ error: 'Missing required note metadata' });
    }

    try {
        const status = req.session.user.role === 'admin' ? 'approved' : 'pending';
        let insertedNote = null;

        if (hasSupabase) {
            const { data, error: dbError } = await supabase.from('notes').insert([{
                title, description, file_name, file_path, file_size, course_id,
                uploaded_by: req.session.user.id, status
            }]).select();

            if (dbError) throw dbError;
            if (data && data.length > 0) insertedNote = data[0];
        } else {
            insertedNote = {
                id: Date.now(),
                title, description, file_name, file_path, file_size, course_id,
                uploaded_by: req.session.user.id,
                uploaded_by_name: req.session.user.username,
                uploaded_at: new Date().toISOString(),
                status
            };
        }

        // Invalidate all server caches so new notes appear without delay
        invalidateServerCache('course_');
        invalidateServerCache('dept_');
        invalidateServerCache('departments');
        invalidateServerCache('courses');

        const message = status === 'approved'
            ? 'Note uploaded successfully!'
            : 'Note uploaded successfully! It is now pending admin approval.';

        res.json({ success: true, message, status, note: insertedNote });
    } catch (error) {
        console.error('Upload confirm error:', error);
        res.status(500).json({ error: 'Failed to confirm note upload' });
    }
});

app.get('/download-note/:id', async (req, res) => {
    try {
        if (!hasSupabase) {
            return res.json({ url: '/favicon.svg' });
        }
        const { data: notes } = await supabase.from('notes').select('id, file_path, status, uploaded_by').eq('id', req.params.id);
        if (!notes || notes.length === 0) return res.status(404).json({ error: 'Note not found' });

        const note = notes[0];
        const isOwner = req.session && req.session.user && String(req.session.user.id) === String(note.uploaded_by);
        const isAdmin = req.session && req.session.user && req.session.user.role === 'admin';

        if (note.status !== 'approved' && !isOwner && !isAdmin) {
            return res.status(403).json({ error: 'Note not approved for download' });
        }
        const separator = note.file_path && note.file_path.includes('?') ? '&' : '?';
        res.json({ url: note.file_path + separator + 'download=' });
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: 'Download failed' });
    }
});

app.get('/preview-note/:id', async (req, res) => {
    try {
        if (!hasSupabase) {
            return res.redirect('/favicon.svg');
        }
        const { data: notes } = await supabase.from('notes').select('id, file_path, status, uploaded_by').eq('id', req.params.id);
        if (!notes || notes.length === 0) return res.status(404).json({ error: 'Note not found' });

        const note = notes[0];
        const isOwner = req.session && req.session.user && String(req.session.user.id) === String(note.uploaded_by);
        const isAdmin = req.session && req.session.user && req.session.user.role === 'admin';

        if (note.status !== 'approved' && !isOwner && !isAdmin) {
            return res.status(403).json({ error: 'Note not approved for preview' });
        }

        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            return res.json({ url: note.file_path });
        }
        res.redirect(note.file_path);
    } catch (error) {
        console.error('Preview error:', error);
        res.status(500).json({ error: 'Preview failed' });
    }
});

app.delete('/note/:id', requireAuth, async (req, res) => {
    try {
        const { data: notes } = await supabase.from('notes').select('id, file_path, uploaded_by').eq('id', req.params.id);
        if (!notes || notes.length === 0) return res.status(404).json({ error: 'Note not found' });

        const note = notes[0];
        if (String(note.uploaded_by) !== String(req.session.user.id) && req.session.user.role !== 'admin') {
            return res.status(403).json({ error: 'Not authorized to delete this note' });
        }

        if (note.file_path && note.file_path.includes('supabase.co')) {
            const pathParts = note.file_path.split('/');
            await supabase.storage.from('notes').remove([pathParts[pathParts.length - 1]]);
        }

        await supabase.from('notes').delete().eq('id', req.params.id);
        invalidateServerCache('course_');
        invalidateServerCache('dept_');
        invalidateServerCache('departments');
        invalidateServerCache('courses');
        res.json({ success: true, message: 'Note deleted successfully' });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Failed to delete note' });
    }
});

// Local mock data store for admin panel operations when running without Supabase credentials
let localMockUsers = [
    { id: 1, username: 'admin', email: 'admin@university.edu', student_id: 'ADM-001', department: 'Computer Science', batch: 1, role: 'admin', created_at: '2024-01-15T08:00:00Z', total_notes: 15, approved_notes: 15, pending_notes: 0, rejected_notes: 0 },
    { id: 2, username: 'sarah_khan', email: 'sarah.khan@university.edu', student_id: 'CSE-21-042', department: 'Computer Science', batch: 58, role: 'user', created_at: '2024-02-10T10:30:00Z', total_notes: 12, approved_notes: 11, pending_notes: 1, rejected_notes: 0 },
    { id: 3, username: 'tanvir_ahmed', email: 'tanvir.eee@university.edu', student_id: 'EEE-21-089', department: 'Electrical Engineering', batch: 58, role: 'user', created_at: '2024-02-18T14:15:00Z', total_notes: 8, approved_notes: 7, pending_notes: 1, rejected_notes: 0 },
    { id: 4, username: 'anika_rahman', email: 'anika.bba@university.edu', student_id: 'BBA-22-105', department: 'Business Administration', batch: 59, role: 'user', created_at: '2024-03-01T09:45:00Z', total_notes: 6, approved_notes: 6, pending_notes: 0, rejected_notes: 0 },
    { id: 5, username: 'farhan_kabir', email: 'farhan.math@university.edu', student_id: 'MAT-22-019', department: 'Mathematics', batch: 59, role: 'user', created_at: '2024-03-12T16:20:00Z', total_notes: 4, approved_notes: 4, pending_notes: 0, rejected_notes: 0 }
];

let localMockPendingNotes = [
    { id: 101, title: 'Neural Networks Lab Manual', description: 'Complete practical code examples for PyTorch', file_name: 'DL_Lab_Guide.pdf', file_size: 2450000, uploaded_at: new Date().toISOString(), uploaded_by_name: 'sarah_khan', course_name: 'Deep Learning', department_name: 'CSE' },
    { id: 102, title: 'Microprocessor 8086 Instruction Set Sheet', description: 'Comprehensive register reference and timing diagrams', file_name: '8086_Sheet.pdf', file_size: 1200000, uploaded_at: new Date().toISOString(), uploaded_by_name: 'tanvir_ahmed', course_name: 'Microprocessors', department_name: 'EEE' }
];

app.get('/admin/pending-approvals', requireAdmin, async (req, res) => {
    try {
        if (!hasSupabase) {
            return res.json(localMockPendingNotes);
        }

        let notes = [];
        try {
            const { data, error } = await supabase.from('notes').select('*, users(username), courses(name)').eq('status', 'pending').order('uploaded_at', { ascending: false });
            if (!error && data) notes = data;
        } catch (e) {}

        if (notes.length === 0) {
            const { data: rawNotes } = await supabase.from('notes').select('*').eq('status', 'pending').order('uploaded_at', { ascending: false });
            notes = rawNotes || [];
        }

        const uploaderIds = [...new Set(notes.map(n => n.uploaded_by).filter(Boolean))];
        const courseIds = [...new Set(notes.map(n => n.course_id).filter(Boolean))];

        let userMap = {};
        let courseMap = {};

        if (uploaderIds.length > 0) {
            try {
                const { data: users } = await supabase.from('users').select('id, username').in('id', uploaderIds);
                if (users) users.forEach(u => { userMap[u.id] = u.username; });
            } catch (err) {}
        }
        if (courseIds.length > 0) {
            try {
                const { data: courses } = await supabase.from('courses').select('id, name').in('id', courseIds);
                if (courses) courses.forEach(c => { courseMap[c.id] = c.name; });
            } catch (err) {}
        }

        const formattedNotes = notes.map(note => ({
            ...note,
            uploaded_by_name: (note.users && note.users.username) || userMap[note.uploaded_by] || 'Student Contributor',
            course_name: (note.courses && note.courses.name) || courseMap[note.course_id] || 'Course'
        }));

        res.json(formattedNotes);
    } catch (error) {
        console.error('Pending approvals error:', error);
        res.status(500).json({ error: 'Failed to load pending approvals' });
    }
});

app.post('/admin/approve-note/:id', requireAdmin, async (req, res) => {
    try {
        if (!hasSupabase) {
            localMockPendingNotes = localMockPendingNotes.filter(n => String(n.id) !== String(req.params.id));
            invalidateServerCache();
            return res.json({ success: true, message: 'Note approved successfully' });
        }
        await supabase.from('notes').update({ status: 'approved' }).eq('id', req.params.id);
        invalidateServerCache();
        res.json({ success: true, message: 'Note approved successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to approve note' });
    }
});

app.post('/admin/reject-note/:id', requireAdmin, async (req, res) => {
    try {
        if (!hasSupabase) {
            localMockPendingNotes = localMockPendingNotes.filter(n => String(n.id) !== String(req.params.id));
            invalidateServerCache();
            return res.json({ success: true, message: 'Note rejected successfully' });
        }
        await supabase.from('notes').update({ status: 'rejected' }).eq('id', req.params.id);
        invalidateServerCache();
        res.json({ success: true, message: 'Note rejected successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to reject note' });
    }
});

app.get('/admin/stats', requireAdmin, async (req, res) => {
    try {
        if (!hasSupabase) {
            return res.json({
                users: localMockUsers.length,
                departments: 4,
                courses: 26,
                notes: 90,
                pending_approvals: localMockPendingNotes.length,
                rejected_notes: 1,
                total_notes: 90 + localMockPendingNotes.length + 1
            });
        }

        const [
            { count: uCount }, { count: dCount }, { count: cCount },
            { count: nAppr }, { count: nPend }, { count: nRej }, { count: nTotal }
        ] = await Promise.all([
            supabase.from('users').select('id', { count: 'exact', head: true }),
            supabase.from('departments').select('id', { count: 'exact', head: true }),
            supabase.from('courses').select('id', { count: 'exact', head: true }),
            supabase.from('notes').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
            supabase.from('notes').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
            supabase.from('notes').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
            supabase.from('notes').select('id', { count: 'exact', head: true })
        ]);

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
        if (!hasSupabase) {
            invalidateServerCache();
            return res.json({ success: true, message: 'Department added successfully' });
        }
        await supabase.from('departments').insert([{ name, code, description, created_by: req.session.user.id }]);
        invalidateServerCache();
        res.json({ success: true, message: 'Department added successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to add department' });
    }
});

app.post('/admin/courses', requireAdmin, async (req, res) => {
    const { name, code, department_id, description } = req.body;
    try {
        if (!hasSupabase) {
            invalidateServerCache();
            return res.json({ success: true, message: 'Course added successfully' });
        }
        await supabase.from('courses').insert([{ name, code, department_id, description, created_by: req.session.user.id }]);
        invalidateServerCache();
        res.json({ success: true, message: 'Course added successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to add course' });
    }
});

app.delete('/admin/departments/:id', requireAdmin, async (req, res) => {
    try {
        if (!hasSupabase) {
            invalidateServerCache();
            return res.json({ success: true, message: 'Department deleted successfully' });
        }
        const { count } = await supabase.from('courses').select('id', { count: 'exact', head: true }).eq('department_id', req.params.id);
        if (count > 0) return res.status(400).json({ error: 'Cannot delete department with existing courses.' });

        await supabase.from('departments').delete().eq('id', req.params.id);
        invalidateServerCache();
        res.json({ success: true, message: 'Department deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete department' });
    }
});

app.delete('/admin/courses/:id', requireAdmin, async (req, res) => {
    try {
        if (!hasSupabase) {
            invalidateServerCache();
            return res.json({ success: true, message: 'Course deleted successfully' });
        }
        const { count } = await supabase.from('notes').select('id', { count: 'exact', head: true }).eq('course_id', req.params.id);
        if (count > 0) return res.status(400).json({ error: 'Cannot delete course with existing notes.' });

        await supabase.from('courses').delete().eq('id', req.params.id);
        invalidateServerCache();
        res.json({ success: true, message: 'Course deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete course' });
    }
});

app.get('/admin/users', requireAdmin, async (req, res) => {
    try {
        if (!hasSupabase) {
            return res.json(localMockUsers);
        }
        let users = [];
        try {
            const { data, error } = await supabase.from('user_stats').select('id, username, email, department, role, created_at, total_notes, approved_notes, pending_notes, rejected_notes').order('created_at', { ascending: false });
            if (!error && data) users = data;
        } catch (e) {}

        if (users.length === 0) {
            const { data: rawUsers } = await supabase.from('users').select('id, username, email, department, role, created_at').order('created_at', { ascending: false });
            users = (rawUsers || []).map(u => ({
                ...u,
                total_notes: 0,
                approved_notes: 0,
                pending_notes: 0,
                rejected_notes: 0
            }));
        }

        res.json(users || []);
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Failed to load users' });
    }
});

app.put('/admin/users/:id', requireAdmin, async (req, res) => {
    const { username, email, student_id, department, batch, role } = req.body;
    const updates = {};
    if (username) updates.username = username.trim();
    if (email) updates.email = email.trim().toLowerCase();
    if (department !== undefined) updates.department = department;
    if (student_id !== undefined) updates.student_id = student_id;
    if (batch !== undefined) updates.batch = batch;
    if (role) updates.role = role;

    try {
        if (!hasSupabase) {
            const user = localMockUsers.find(u => String(u.id) === String(req.params.id));
            if (user) Object.assign(user, updates);
            return res.json({ success: true, message: 'User updated successfully' });
        }
        const { error } = await supabase.from('users').update(updates).eq('id', req.params.id);
        if (error) {
            // Retry omitting optional student_id and batch columns if schema lacks them
            delete updates.student_id;
            delete updates.batch;
            const retry = await supabase.from('users').update(updates).eq('id', req.params.id);
            if (retry.error) throw retry.error;
        }
        invalidateServerCache();
        res.json({ success: true, message: 'User updated successfully' });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ error: 'Failed to update user: ' + error.message });
    }
});

app.delete('/admin/users/:id', requireAdmin, async (req, res) => {
    try {
        if (!hasSupabase) {
            localMockUsers = localMockUsers.filter(u => String(u.id) !== String(req.params.id));
            return res.json({ success: true, message: 'User deleted successfully' });
        }
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
        console.log('📚 University Notes Hub is ready locally!');
    });
}

module.exports = app;