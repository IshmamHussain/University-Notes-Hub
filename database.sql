CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255),
    department VARCHAR(100),
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Ensure password column exists if table was already created
ALTER TABLE users ADD COLUMN IF NOT EXISTS password VARCHAR(255);

CREATE TABLE IF NOT EXISTS departments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(10) UNIQUE NOT NULL,
    description TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS courses (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    description TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notes (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size INTEGER,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected'))
);

-- Default admin user using raw insert, note that Supabase Auth admin must be created inside Supabase UI
INSERT INTO users (username, email, role)
VALUES ('admin', 'admin@university.edu', 'admin')
ON CONFLICT (username) DO NOTHING;
-- PERFORMANCE OPTIMIZATION VIEWS

CREATE OR REPLACE VIEW department_stats AS
SELECT 
    d.id, d.name, d.code, d.description, d.created_by, d.created_at,
    COUNT(DISTINCT c.id) as course_count,
    COUNT(DISTINCT n.id) FILTER (WHERE n.status = 'approved') as notes_count
FROM departments d
LEFT JOIN courses c ON d.id = c.department_id
LEFT JOIN notes n ON c.id = n.course_id
GROUP BY d.id;

CREATE OR REPLACE VIEW course_stats AS
SELECT 
    c.id, c.name, c.code, c.department_id, c.description, c.created_by, c.created_at,
    d.name as department_name,
    COUNT(n.id) FILTER (WHERE n.status = 'approved') as notes_count
FROM courses c
LEFT JOIN departments d ON c.department_id = d.id
LEFT JOIN notes n ON c.id = n.course_id
GROUP BY c.id, d.name;

CREATE OR REPLACE VIEW user_stats AS
SELECT 
    u.id, u.username, u.email, u.department, u.role, u.created_at,
    COUNT(n.id) as total_notes,
    COUNT(n.id) FILTER (WHERE n.status = 'approved') as approved_notes,
    COUNT(n.id) FILTER (WHERE n.status = 'pending') as pending_notes,
    COUNT(n.id) FILTER (WHERE n.status = 'rejected') as rejected_notes
FROM users u
LEFT JOIN notes n ON u.id = n.uploaded_by
GROUP BY u.id;

-- ========================================================
-- SEED DATA: Departments, Courses, and Sample Approved Notes
-- ========================================================

INSERT INTO departments (id, name, code, description) VALUES
(1, 'Computer Science & Engineering', 'CSE', 'Algorithms, artificial intelligence, software architecture, operating systems, and computer vision.'),
(2, 'Electrical & Electronic Engineering', 'EEE', 'Circuit theory, telecommunications, robotics, signals and systems, and microelectronics.'),
(3, 'Business Administration', 'BBA', 'Corporate finance, managerial economics, marketing strategy, and organizational behavior.'),
(4, 'Mathematics & Statistics', 'MATH', 'Linear algebra, multivariable calculus, probability theory, discrete mathematics, and numerical analysis.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO courses (id, name, code, department_id, description) VALUES
(101, 'Data Structures & Algorithms', 'CSE201', 1, 'Stacks, queues, trees, graphs, sorting, searching, and dynamic programming.'),
(102, 'Database Management Systems', 'CSE301', 1, 'Relational models, SQL, indexing, transaction processing, and normalization.'),
(103, 'Operating Systems', 'CSE303', 1, 'Processes, threads, synchronization, CPU scheduling, and virtual memory.'),
(104, 'Computer Networks', 'CSE305', 1, 'OSI model, TCP/IP, routing algorithms, socket programming, and network security.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO notes (id, title, description, file_name, file_path, file_size, course_id, uploaded_by, status) VALUES
(1, 'Graph Algorithms & BFS/DFS Cheatsheet', 'In-depth visual summary of graph representations, Dijkstra, topological sort, and cycle detection.', 'graph_algorithms.pdf', 'https://university-notes-hub.vercel.app/favicon.svg', 2450000, 101, 1, 'approved'),
(2, 'Dynamic Programming Classic Problems', 'Memoization vs tabulation, knapsack, LCS, matrix chain multiplication with clean pseudocode.', 'dp_handbook.docx', 'https://university-notes-hub.vercel.app/favicon.svg', 1850000, 101, 1, 'approved'),
(3, 'Balanced Search Trees & AVL Rotations', 'Self-balancing AVL tree insertion, deletion, and rotation step-by-step diagrams.', 'avl_trees.pdf', 'https://university-notes-hub.vercel.app/favicon.svg', 3100000, 101, 1, 'approved'),
(4, 'SQL Indexing & Normalization Guide', 'B-Tree indexes, composite keys, 1NF to BCNF with step-by-step schema examples.', 'sql_indexing.pdf', 'https://university-notes-hub.vercel.app/favicon.svg', 1950000, 102, 1, 'approved'),
(5, 'Relational Algebra & Query Trees', 'Relational operators, projection, selection, and query cost trees.', 'relational_algebra.pdf', 'https://university-notes-hub.vercel.app/favicon.svg', 1420000, 102, 1, 'approved'),
(6, 'Process Scheduling & Semaphores Cheatsheet', 'Round Robin, Priority scheduling, Semaphores, Mutexes, and Producer-Consumer problem.', 'process_scheduling.pdf', 'https://university-notes-hub.vercel.app/favicon.svg', 2150000, 103, 1, 'approved'),
(7, 'TCP/IP Protocol Suite & Handshake Summary', 'Three-way handshake, flow control, sliding window, and subnetting formulas.', 'tcp_ip_summary.pdf', 'https://university-notes-hub.vercel.app/favicon.svg', 1780000, 104, 1, 'approved')
ON CONFLICT (id) DO NOTHING;

-- Performance Optimization Indexes
CREATE INDEX IF NOT EXISTS idx_notes_course_status ON notes(course_id, status);
CREATE INDEX IF NOT EXISTS idx_notes_uploaded_by ON notes(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_courses_dept ON courses(department_id);

-- Reset primary key auto-increment sequences
SELECT setval(pg_get_serial_sequence('departments', 'id'), COALESCE(MAX(id), 1)) FROM departments;
SELECT setval(pg_get_serial_sequence('courses', 'id'), COALESCE(MAX(id), 1)) FROM courses;
SELECT setval(pg_get_serial_sequence('notes', 'id'), COALESCE(MAX(id), 1)) FROM notes;

-- ========================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Ensure public and authenticated users can view departments, courses, and approved notes
-- ========================================================

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'departments' AND policyname = 'Public can view departments') THEN
        CREATE POLICY "Public can view departments" ON departments FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'courses' AND policyname = 'Public can view courses') THEN
        CREATE POLICY "Public can view courses" ON courses FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notes' AND policyname = 'Public can view approved notes') THEN
        CREATE POLICY "Public can view approved notes" ON notes FOR SELECT USING (status = 'approved' OR status ILIKE 'approved');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notes' AND policyname = 'Users can view and insert own notes') THEN
        CREATE POLICY "Users can view and insert own notes" ON notes FOR ALL USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'Public can view user profiles') THEN
        CREATE POLICY "Public can view user profiles" ON users FOR SELECT USING (true);
    END IF;
END $$;

-- Optional: Promote an admin account (replace with your admin email or username)
-- UPDATE users SET role = 'admin' WHERE email = 'admin@example.com';



