-- Courses / Tracks table
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,           -- 'IELTS_FULL', 'IELTS_READING', 'TOEFL_FULL', 'FOUNDATIONS', 'PRIVATE_VIP'
  name TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  exam_type TEXT,                      -- 'IELTS', 'TOEFL', 'FOUNDATIONS', 'PRIVATE'
  module TEXT,                         -- 'reading','writing','listening','speaking', or NULL for full
  price REAL NOT NULL,
  original_price REAL,
  description TEXT,
  description_ar TEXT,
  hours INTEGER,                       -- for private VIP: 20 hours
  is_active INTEGER DEFAULT 1,
  color TEXT DEFAULT '#3b82f6',
  icon TEXT DEFAULT 'fa-graduation-cap',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Activation Codes table
CREATE TABLE IF NOT EXISTS activation_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  course_id INTEGER NOT NULL,
  created_by INTEGER,
  used_by INTEGER,
  used_at DATETIME,
  expires_at DATETIME,
  is_used INTEGER DEFAULT 0,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (course_id) REFERENCES courses(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (used_by) REFERENCES users(id)
);

-- Enrollments table
CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  course_id INTEGER NOT NULL,
  activation_code_id INTEGER,
  activated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  is_active INTEGER DEFAULT 1,
  welcome_shown INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (course_id) REFERENCES courses(id),
  FOREIGN KEY (activation_code_id) REFERENCES activation_codes(id)
);

-- Private VIP Hours tracking
CREATE TABLE IF NOT EXISTS private_hours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  enrollment_id INTEGER NOT NULL,
  total_hours INTEGER DEFAULT 20,
  used_hours REAL DEFAULT 0,
  remaining_hours REAL DEFAULT 20,
  last_session_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (enrollment_id) REFERENCES enrollments(id)
);

-- Hours sessions log
CREATE TABLE IF NOT EXISTS hours_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  private_hours_id INTEGER NOT NULL,
  hours_used REAL NOT NULL,
  session_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  logged_by INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (private_hours_id) REFERENCES private_hours(id),
  FOREIGN KEY (logged_by) REFERENCES users(id)
);

-- Payment requests log
CREATE TABLE IF NOT EXISTS payment_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  course_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  payment_method TEXT,
  status TEXT DEFAULT 'pending',
  whatsapp_sent INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (course_id) REFERENCES courses(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_enrollments_user ON enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_activation_codes_code ON activation_codes(code);
CREATE INDEX IF NOT EXISTS idx_private_hours_user ON private_hours(user_id);
