CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    department VARCHAR(100),
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

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
