import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())

// ==================== AUTH HELPERS ====================
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + 'prepmaster_salt_2024')
  const hash = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
}

async function generateSessionId(): Promise<string> {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function getUser(c: any): Promise<any | null> {
  const sessionId = getCookie(c, 'session_id')
  if (!sessionId) return null
  const session = await c.env.DB.prepare(
    `SELECT s.user_id, u.name, u.email, u.role 
     FROM auth_sessions s JOIN users u ON s.user_id = u.id 
     WHERE s.id = ? AND s.expires_at > datetime('now')`
  ).bind(sessionId).first()
  return session
}

// ==================== AUTH ROUTES ====================
app.post('/api/auth/register', async (c) => {
  const { name, email, password } = await c.req.json()
  if (!name || !email || !password) return c.json({ error: 'All fields required' }, 400)
  if (password.length < 6) return c.json({ error: 'Password must be at least 6 characters' }, 400)

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
  if (existing) return c.json({ error: 'Email already registered' }, 409)

  const hash = await hashPassword(password)
  const result = await c.env.DB.prepare(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
  ).bind(name, email, hash, 'student').run()

  const sessionId = await generateSessionId()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  await c.env.DB.prepare(
    'INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(sessionId, result.meta.last_row_id, expiresAt).run()

  setCookie(c, 'session_id', sessionId, { httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 604800, path: '/' })
  return c.json({ success: true, user: { name, email, role: 'student' } })
})

app.post('/api/auth/login', async (c) => {
  const { email, password } = await c.req.json()
  if (!email || !password) return c.json({ error: 'Email and password required' }, 400)

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first() as any
  if (!user) return c.json({ error: 'Invalid credentials' }, 401)

  const hash = await hashPassword(password)
  if (hash !== user.password_hash) return c.json({ error: 'Invalid credentials' }, 401)

  await c.env.DB.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").bind(user.id).run()

  const sessionId = await generateSessionId()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  await c.env.DB.prepare(
    'INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(sessionId, user.id, expiresAt).run()

  setCookie(c, 'session_id', sessionId, { httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 604800, path: '/' })
  return c.json({ success: true, user: { name: user.name, email: user.email, role: user.role } })
})

app.post('/api/auth/logout', async (c) => {
  const sessionId = getCookie(c, 'session_id')
  if (sessionId) {
    await c.env.DB.prepare('DELETE FROM auth_sessions WHERE id = ?').bind(sessionId).run()
  }
  deleteCookie(c, 'session_id', { path: '/' })
  return c.json({ success: true })
})

app.get('/api/auth/me', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ user: null })
  return c.json({ user })
})

// ==================== QUESTIONS ROUTES ====================
app.get('/api/questions', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const examType = c.req.query('exam_type') || 'TOEFL'
  const module = c.req.query('module') || 'reading'
  const limit = parseInt(c.req.query('limit') || '10')

  const questions = await c.env.DB.prepare(
    'SELECT id, title, content, passage, options, question_type, difficulty, time_limit, points FROM questions WHERE exam_type = ? AND module = ? AND is_active = 1 LIMIT ?'
  ).bind(examType, module, limit).all()

  return c.json({ questions: questions.results })
})

app.get('/api/questions/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  const q = await c.env.DB.prepare('SELECT * FROM questions WHERE id = ?').bind(c.req.param('id')).first()
  if (!q) return c.json({ error: 'Not found' }, 404)
  return c.json({ question: q })
})

// ==================== SESSIONS ROUTES ====================
app.post('/api/sessions/start', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const { exam_type, module } = await c.req.json()
  const result = await c.env.DB.prepare(
    "INSERT INTO practice_sessions (user_id, exam_type, module) VALUES (?, ?, ?)"
  ).bind(user.user_id, exam_type, module).run()

  return c.json({ session_id: result.meta.last_row_id })
})

app.post('/api/sessions/:id/answer', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const { question_id, answer, time_spent } = await c.req.json()
  const sessionId = c.req.param('id')

  const question = await c.env.DB.prepare('SELECT * FROM questions WHERE id = ?').bind(question_id).first() as any
  if (!question) return c.json({ error: 'Question not found' }, 404)

  let isCorrect = null
  let pointsEarned = 0

  if (question.correct_answer) {
    isCorrect = answer === question.correct_answer ? 1 : 0
    pointsEarned = isCorrect ? (question.points || 1.0) : 0
  }

  await c.env.DB.prepare(
    'INSERT INTO session_answers (session_id, question_id, user_answer, is_correct, points_earned, time_spent) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(sessionId, question_id, answer, isCorrect, pointsEarned, time_spent).run()

  return c.json({ 
    is_correct: isCorrect,
    points_earned: pointsEarned,
    correct_answer: question.correct_answer,
    explanation: question.explanation
  })
})

app.post('/api/sessions/:id/complete', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const sessionId = c.req.param('id')
  const { time_taken } = await c.req.json()

  const answers = await c.env.DB.prepare(
    'SELECT SUM(points_earned) as total_score, COUNT(*) as total_questions FROM session_answers WHERE session_id = ?'
  ).bind(sessionId).first() as any

  const questionsInfo = await c.env.DB.prepare(
    `SELECT SUM(q.points) as max_score FROM session_answers sa 
     JOIN questions q ON sa.question_id = q.id WHERE sa.session_id = ?`
  ).bind(sessionId).first() as any

  const score = answers?.total_score || 0
  const maxScore = questionsInfo?.max_score || 0

  await c.env.DB.prepare(
    "UPDATE practice_sessions SET score = ?, max_score = ?, time_taken = ?, completed = 1, completed_at = datetime('now') WHERE id = ?"
  ).bind(score, maxScore, time_taken, sessionId).run()

  return c.json({ success: true, score, max_score: maxScore })
})

// ==================== DASHBOARD / STATS ROUTES ====================
app.get('/api/dashboard/stats', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)

  const totalSessions = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM practice_sessions WHERE user_id = ? AND completed = 1'
  ).bind(user.user_id).first() as any

  const avgScore = await c.env.DB.prepare(
    'SELECT AVG(CASE WHEN max_score > 0 THEN (score / max_score) * 100 ELSE 0 END) as avg FROM practice_sessions WHERE user_id = ? AND completed = 1'
  ).bind(user.user_id).first() as any

  const moduleStats = await c.env.DB.prepare(
    `SELECT module, exam_type, COUNT(*) as sessions, 
     AVG(CASE WHEN max_score > 0 THEN (score / max_score) * 100 ELSE 0 END) as avg_score
     FROM practice_sessions WHERE user_id = ? AND completed = 1
     GROUP BY module, exam_type`
  ).bind(user.user_id).all()

  const recentSessions = await c.env.DB.prepare(
    `SELECT id, exam_type, module, score, max_score, time_taken, completed_at 
     FROM practice_sessions WHERE user_id = ? AND completed = 1 
     ORDER BY completed_at DESC LIMIT 5`
  ).bind(user.user_id).all()

  const streakData = await c.env.DB.prepare(
    `SELECT DATE(completed_at) as date FROM practice_sessions 
     WHERE user_id = ? AND completed = 1 
     GROUP BY DATE(completed_at) ORDER BY date DESC LIMIT 7`
  ).bind(user.user_id).all()

  return c.json({
    total_sessions: totalSessions?.count || 0,
    avg_score: Math.round(avgScore?.avg || 0),
    module_stats: moduleStats.results,
    recent_sessions: recentSessions.results,
    streak_days: streakData.results.length
  })
})

// ==================== ADMIN ROUTES ====================
app.get('/api/admin/users', async (c) => {
  const user = await getUser(c)
  if (!user || user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403)

  const users = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.created_at, u.last_login,
     COUNT(ps.id) as total_sessions
     FROM users u LEFT JOIN practice_sessions ps ON u.id = ps.user_id AND ps.completed = 1
     GROUP BY u.id ORDER BY u.created_at DESC`
  ).all()
  return c.json({ users: users.results })
})

app.get('/api/admin/questions', async (c) => {
  const user = await getUser(c)
  if (!user || user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403)

  const questions = await c.env.DB.prepare(
    'SELECT id, exam_type, module, question_type, difficulty, title, is_active, created_at FROM questions ORDER BY created_at DESC'
  ).all()
  return c.json({ questions: questions.results })
})

app.post('/api/admin/questions', async (c) => {
  const user = await getUser(c)
  if (!user || user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403)

  const body = await c.req.json()
  const { exam_type, module, question_type, difficulty, title, content, passage, options, correct_answer, explanation, time_limit, points } = body

  if (!exam_type || !module || !title || !content) {
    return c.json({ error: 'Required fields missing' }, 400)
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO questions (exam_type, module, question_type, difficulty, title, content, passage, options, correct_answer, explanation, time_limit, points, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(exam_type, module, question_type || 'multiple_choice', difficulty || 'medium', title, content,
    passage || null, options ? JSON.stringify(options) : null, correct_answer || null,
    explanation || null, time_limit || 600, points || 1.0, user.user_id).run()

  return c.json({ success: true, id: result.meta.last_row_id })
})

app.put('/api/admin/questions/:id', async (c) => {
  const user = await getUser(c)
  if (!user || user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403)

  const body = await c.req.json()
  const { title, content, passage, options, correct_answer, explanation, difficulty, is_active } = body

  await c.env.DB.prepare(
    `UPDATE questions SET title=?, content=?, passage=?, options=?, correct_answer=?, explanation=?, difficulty=?, is_active=? WHERE id=?`
  ).bind(title, content, passage || null,
    options ? (typeof options === 'string' ? options : JSON.stringify(options)) : null,
    correct_answer || null, explanation || null, difficulty || 'medium',
    is_active !== undefined ? is_active : 1, c.req.param('id')).run()

  return c.json({ success: true })
})

app.delete('/api/admin/questions/:id', async (c) => {
  const user = await getUser(c)
  if (!user || user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403)

  await c.env.DB.prepare('UPDATE questions SET is_active = 0 WHERE id = ?').bind(c.req.param('id')).run()
  return c.json({ success: true })
})

app.get('/api/admin/stats', async (c) => {
  const user = await getUser(c)
  if (!user || user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403)

  const totalUsers = await c.env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'student'").first() as any
  const totalSessions = await c.env.DB.prepare("SELECT COUNT(*) as count FROM practice_sessions WHERE completed = 1").first() as any
  const totalQuestions = await c.env.DB.prepare("SELECT COUNT(*) as count FROM questions WHERE is_active = 1").first() as any
  const examBreakdown = await c.env.DB.prepare(
    "SELECT exam_type, module, COUNT(*) as count FROM practice_sessions WHERE completed = 1 GROUP BY exam_type, module"
  ).all()

  return c.json({
    total_users: totalUsers?.count || 0,
    total_sessions: totalSessions?.count || 0,
    total_questions: totalQuestions?.count || 0,
    exam_breakdown: examBreakdown.results
  })
})

// ==================== SETUP ROUTE (initialize DB) ====================
app.get('/api/setup', async (c) => {
  try {
    // Create tables using batch for D1 compatibility
    await c.env.DB.batch([
      c.env.DB.prepare("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_login DATETIME)"),
      c.env.DB.prepare("CREATE TABLE IF NOT EXISTS practice_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, exam_type TEXT NOT NULL, module TEXT NOT NULL, score REAL, max_score REAL, time_taken INTEGER, completed INTEGER DEFAULT 0, started_at DATETIME DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME)"),
      c.env.DB.prepare("CREATE TABLE IF NOT EXISTS questions (id INTEGER PRIMARY KEY AUTOINCREMENT, exam_type TEXT NOT NULL, module TEXT NOT NULL, question_type TEXT NOT NULL, difficulty TEXT NOT NULL DEFAULT 'medium', title TEXT NOT NULL, content TEXT NOT NULL, passage TEXT, options TEXT, correct_answer TEXT, explanation TEXT, time_limit INTEGER, points REAL DEFAULT 1.0, is_active INTEGER DEFAULT 1, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"),
      c.env.DB.prepare("CREATE TABLE IF NOT EXISTS session_answers (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL, question_id INTEGER NOT NULL, user_answer TEXT, is_correct INTEGER, points_earned REAL DEFAULT 0, time_spent INTEGER, answered_at DATETIME DEFAULT CURRENT_TIMESTAMP)"),
      c.env.DB.prepare("CREATE TABLE IF NOT EXISTS auth_sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at DATETIME NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"),
      c.env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_ps_user ON practice_sessions(user_id)"),
      c.env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_q_exam ON questions(exam_type, module)"),
    ])

    // Create admin user
    const adminHash = await hashPassword('Admin@123')
    await c.env.DB.prepare("INSERT OR IGNORE INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'admin')")
      .bind('admin@prepmaster.edu', 'Admin User', adminHash).run()

    // Create demo student
    const studentHash = await hashPassword('Student@123')
    await c.env.DB.prepare("INSERT OR IGNORE INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'student')")
      .bind('student@prepmaster.edu', 'Alex Johnson', studentHash).run()

    return c.json({ success: true, message: 'Database initialized successfully' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

app.get('/api/setup/seed', async (c) => {
  try {
    const questions = [
      {
        exam_type: 'TOEFL', module: 'reading', question_type: 'multiple_choice', difficulty: 'medium',
        title: 'The Industrial Revolution',
        content: 'According to the passage, what was the primary driver of the Industrial Revolution?',
        passage: 'The Industrial Revolution, which began in Britain during the 18th century, fundamentally transformed human society. The shift from agrarian and handicraft economies to manufacturing and industry was driven primarily by technological innovations, particularly the development of steam power. James Watt\'s improvements to the steam engine in the 1760s allowed factories to be built anywhere, not just near water sources. This led to rapid urbanization as workers moved from rural areas to cities seeking employment. The social consequences were profound: a new middle class emerged, child labor became widespread, and traditional ways of life were permanently altered. The revolution eventually spread to Western Europe and North America, reshaping global trade patterns and establishing the foundations of modern capitalism.',
        options: JSON.stringify(['Technological innovations, especially steam power', 'Availability of cheap labor', 'Colonial expansion and resource extraction', 'Government subsidies for manufacturing']),
        correct_answer: 'Technological innovations, especially steam power',
        explanation: 'The passage explicitly states the shift was "driven primarily by technological innovations, particularly the development of steam power."',
        time_limit: 1200, points: 1.0
      },
      {
        exam_type: 'TOEFL', module: 'reading', question_type: 'multiple_choice', difficulty: 'easy',
        title: 'Photosynthesis Basics',
        content: 'What is the main product of photosynthesis according to the passage?',
        passage: 'Photosynthesis is the process by which green plants and some other organisms convert light energy, usually from the sun, into chemical energy that can be later released to fuel the organism\'s activities. This process involves the absorption of carbon dioxide and water, which are converted into glucose and oxygen. The reaction occurs primarily in the chloroplasts of plant cells, where chlorophyll—the green pigment—captures light energy. Glucose produced during photosynthesis serves as the primary energy source for the plant, while oxygen is released as a byproduct into the atmosphere. This oxygen release is what makes photosynthesis essential to life on Earth, as it maintains the atmospheric oxygen that most organisms need for respiration.',
        options: JSON.stringify(['Glucose and oxygen', 'Carbon dioxide and water', 'Chlorophyll and light', 'Nitrogen and glucose']),
        correct_answer: 'Glucose and oxygen',
        explanation: 'The passage clearly states that carbon dioxide and water "are converted into glucose and oxygen."',
        time_limit: 1200, points: 1.0
      },
      {
        exam_type: 'TOEFL', module: 'reading', question_type: 'multiple_choice', difficulty: 'hard',
        title: 'The Industrial Revolution - Inference',
        content: 'What can be inferred from the passage about James Watt\'s steam engine?',
        passage: 'The Industrial Revolution, which began in Britain during the 18th century, fundamentally transformed human society. The shift from agrarian and handicraft economies to manufacturing and industry was driven primarily by technological innovations, particularly the development of steam power. James Watt\'s improvements to the steam engine in the 1760s allowed factories to be built anywhere, not just near water sources. This led to rapid urbanization as workers moved from rural areas to cities seeking employment.',
        options: JSON.stringify(['It made factory location more flexible', 'It was invented entirely by Watt', 'It was first used in agriculture', 'It required proximity to rivers']),
        correct_answer: 'It made factory location more flexible',
        explanation: 'The passage states factories could be "built anywhere, not just near water sources," implying location flexibility increased.',
        time_limit: 1200, points: 1.0
      },
      {
        exam_type: 'TOEFL', module: 'listening', question_type: 'multiple_choice', difficulty: 'medium',
        title: 'Campus Conversation',
        content: 'Listen to the following conversation between a student and a professor. What is the student\'s main concern?\n\n[Audio Transcript]\nStudent: "Professor Williams, I\'m worried about the upcoming midterm. I\'ve been studying but I feel like I don\'t fully understand the material on behavioral economics."\nProfessor: "That\'s understandable. The concepts can be challenging at first. What specific areas are you struggling with?"\nStudent: "Mainly the concept of loss aversion and how it differs from risk aversion."\nProfessor: "Good that you\'ve identified the problem. Loss aversion refers to the tendency to prefer avoiding losses over acquiring gains, while risk aversion is about preferring certainty over uncertainty."',
        passage: null,
        options: JSON.stringify(['Understanding behavioral economics concepts', 'Preparing for the final exam', 'Finding study materials', 'Getting an extension on an assignment']),
        correct_answer: 'Understanding behavioral economics concepts',
        explanation: 'The student explicitly states concern about understanding "the material on behavioral economics."',
        time_limit: 600, points: 1.0
      },
      {
        exam_type: 'TOEFL', module: 'listening', question_type: 'multiple_choice', difficulty: 'medium',
        title: 'Academic Lecture - Climate',
        content: 'What does the professor say about deforestation and climate change?\n\n[Audio Transcript]\nProfessor: "Today we\'re examining the interconnected nature of deforestation and climate change. Forests act as carbon sinks, absorbing significant amounts of CO2 from the atmosphere. When forests are cleared, not only do we lose this carbon-absorbing capacity, but the stored carbon is released back into the atmosphere. This creates what scientists call a double impact—reduced absorption combined with increased emissions. Studies show that deforestation accounts for approximately 10-15% of global greenhouse gas emissions annually."',
        passage: null,
        options: JSON.stringify(['Deforestation has a double negative impact on climate', 'Forests absorb more CO2 than previously thought', 'Climate change causes more deforestation', 'Deforestation occurs mainly in tropical regions']),
        correct_answer: 'Deforestation has a double negative impact on climate',
        explanation: 'The professor describes a "double impact"—reduced CO2 absorption plus increased emissions.',
        time_limit: 600, points: 1.0
      },
      {
        exam_type: 'TOEFL', module: 'writing', question_type: 'independent', difficulty: 'medium',
        title: 'Technology in Education',
        content: 'Do you agree or disagree with the following statement?\n\n"Technology has made it easier for students to learn compared to previous generations."\n\nUse specific reasons and examples to support your answer. Write at least 300 words.',
        passage: null, options: null, correct_answer: null,
        explanation: 'Evaluated on task response, coherence, vocabulary, and grammar.',
        time_limit: 1800, points: 5.0
      },
      {
        exam_type: 'TOEFL', module: 'speaking', question_type: 'independent', difficulty: 'medium',
        title: 'Task 1 - Personal Preference',
        content: 'Some people prefer to work in a team, while others prefer to work independently. Which do you prefer and why?\n\nPreparation time: 15 seconds | Response time: 45 seconds\n\nKey points to address:\n• State your preference clearly\n• Provide 2-3 specific reasons\n• Use examples from your experience',
        passage: null, options: null, correct_answer: null,
        explanation: 'Evaluated on delivery, language use, and topic development.',
        time_limit: 60, points: 4.0
      },
      {
        exam_type: 'IELTS', module: 'reading', question_type: 'multiple_choice', difficulty: 'medium',
        title: 'The Psychology of Decision Making',
        content: 'According to the passage, what is "cognitive bias"?',
        passage: 'The Psychology of Decision Making\n\nHuman beings like to think of themselves as rational actors, making decisions based on careful analysis of available information. However, decades of research in behavioral psychology have revealed that our decision-making processes are frequently influenced by cognitive biases—systematic patterns of deviation from rationality in judgment. These biases often arise from the mental shortcuts, known as heuristics, that our brains use to simplify complex information processing.\n\nOne of the most well-documented cognitive biases is confirmation bias, the tendency to search for and interpret information in a way that confirms one\'s preexisting beliefs. Another common bias is the availability heuristic, where people judge the likelihood of events based on how easily examples come to mind.',
        options: JSON.stringify(['Rational patterns of decision-making', 'Systematic deviations from rational judgment', 'Mental shortcuts that improve decisions', 'Statistical errors in data analysis']),
        correct_answer: 'Systematic deviations from rational judgment',
        explanation: 'The passage defines cognitive biases as "systematic patterns of deviation from rationality in judgment."',
        time_limit: 1200, points: 1.0
      },
      {
        exam_type: 'IELTS', module: 'writing', question_type: 'task2', difficulty: 'hard',
        title: 'Task 2 - Opinion Essay',
        content: 'Some people believe that universities should focus on providing academic knowledge and skills, while others think that universities should also prepare students for employment.\n\nDiscuss both views and give your own opinion.\n\nWrite at least 250 words.',
        passage: null, options: null, correct_answer: null,
        explanation: 'Evaluated on task achievement, coherence, vocabulary range, and grammatical accuracy.',
        time_limit: 2400, points: 9.0
      },
      {
        exam_type: 'IELTS', module: 'speaking', question_type: 'part2', difficulty: 'medium',
        title: 'Part 2 - Long Turn',
        content: 'Describe a time when you helped someone.\n\nYou should say:\n• Who you helped\n• How you helped them\n• Why they needed help\n• And explain how you felt after helping them\n\nPreparation time: 1 minute | Speaking time: 1-2 minutes',
        passage: null, options: null, correct_answer: null,
        explanation: 'Evaluated on fluency, vocabulary, grammar, and pronunciation.',
        time_limit: 180, points: 4.0
      },
      {
        exam_type: 'IELTS', module: 'listening', question_type: 'multiple_choice', difficulty: 'medium',
        title: 'Section 1 - Booking a Tour',
        content: 'Listen to a conversation between a travel agent and a customer.\n\n[Audio Transcript]\nAgent: "Good morning, Adventure Tours. How can I help you?"\nCustomer: "Hi, I\'d like to book a tour to Scotland for next month."\nAgent: "We have three options. The 3-day Highland tour costs £285 per person, the 5-day coastal tour is £420, and our premium 7-day full Scotland tour is £680."\nCustomer: "What does the 5-day tour include?"\nAgent: "It includes accommodation at 4-star hotels, all breakfasts and dinners, transport by coach, and guided visits to Edinburgh Castle, Loch Ness, and the Isle of Skye."\nCustomer: "That sounds perfect. I\'ll take two places on the 5-day tour."\n\nHow much will the customer pay in total?',
        passage: null,
        options: JSON.stringify(['£420', '£840', '£680', '£570']),
        correct_answer: '£840',
        explanation: 'The 5-day tour costs £420 per person. The customer is booking for 2 people: £420 × 2 = £840.',
        time_limit: 600, points: 1.0
      }
    ]

    for (const q of questions) {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO questions (exam_type, module, question_type, difficulty, title, content, passage, options, correct_answer, explanation, time_limit, points, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
      ).bind(q.exam_type, q.module, q.question_type, q.difficulty, q.title, q.content,
        q.passage, q.options, q.correct_answer, q.explanation, q.time_limit, q.points).run()
    }

    return c.json({ success: true, message: `Seeded ${questions.length} questions` })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ==================== STATIC FILES ====================
app.use('/static/*', serveStatic({ root: './' }))
app.use('/public/*', serveStatic({ root: './' }))

// Favicon
app.get('/favicon.svg', (c) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#1a2b4a"/><text x="16" y="22" font-size="18" text-anchor="middle" fill="#f59e0b" font-family="Arial" font-weight="bold">Y</text></svg>'
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } })
})

// ==================== FRONTEND PAGES ====================
const getLayout = (title: string, body: string, scripts: string = '') => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title} - The Yamen Guide</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet"/>
  <style>
    :root {
      --navy: #1a2b4a;
      --navy-dark: #0f1e35;
      --navy-light: #2d4470;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --gold: #f59e0b;
      --success: #10b981;
      --danger: #ef4444;
      --grey-50: #f8fafc;
      --grey-100: #f1f5f9;
      --grey-200: #e2e8f0;
      --grey-400: #94a3b8;
      --grey-600: #475569;
      --grey-800: #1e293b;
    }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--grey-50); color: var(--grey-800); }
    .btn-primary { background: var(--accent); color: white; padding: 0.625rem 1.5rem; border-radius: 0.5rem; font-weight: 600; cursor: pointer; transition: all 0.2s; border: none; display: inline-flex; align-items: center; gap: 0.5rem; }
    .btn-primary:hover { background: var(--accent-hover); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(59,130,246,0.4); }
    .btn-secondary { background: white; color: var(--navy); padding: 0.625rem 1.5rem; border-radius: 0.5rem; font-weight: 600; cursor: pointer; transition: all 0.2s; border: 1px solid var(--grey-200); display: inline-flex; align-items: center; gap: 0.5rem; }
    .btn-secondary:hover { background: var(--grey-100); border-color: var(--accent); color: var(--accent); }
    .btn-danger { background: var(--danger); color: white; padding: 0.5rem 1rem; border-radius: 0.5rem; font-weight: 600; cursor: pointer; transition: all 0.2s; border: none; }
    .card { background: white; border-radius: 0.75rem; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06); border: 1px solid var(--grey-200); }
    .navbar { background: var(--navy); padding: 0 1.5rem; display: flex; align-items: center; justify-content: space-between; height: 64px; position: sticky; top: 0; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
    .navbar-brand { color: white; font-size: 1.25rem; font-weight: 700; display: flex; align-items: center; gap: 0.5rem; text-decoration: none; }
    .navbar-brand span.accent { color: var(--gold); }
    .badge-toefl { background: #dbeafe; color: #1e40af; padding: 0.125rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
    .badge-ielts { background: #d1fae5; color: #065f46; padding: 0.125rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
    .badge-reading { background: #fef3c7; color: #92400e; padding: 0.125rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
    .badge-listening { background: #ede9fe; color: #5b21b6; padding: 0.125rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
    .badge-speaking { background: #fee2e2; color: #991b1b; padding: 0.125rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
    .badge-writing { background: #ecfdf5; color: #065f46; padding: 0.125rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
    .timer-bar { background: linear-gradient(90deg, #10b981, #3b82f6); height: 4px; border-radius: 2px; transition: width 1s linear; }
    .timer-warning { background: linear-gradient(90deg, #f59e0b, #ef4444); }
    .module-card { border: 2px solid transparent; transition: all 0.2s; cursor: pointer; }
    .module-card:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 8px 24px rgba(59,130,246,0.15); }
    .module-card.reading:hover { border-color: #f59e0b; }
    .module-card.listening:hover { border-color: #8b5cf6; }
    .module-card.speaking:hover { border-color: #ef4444; }
    .module-card.writing:hover { border-color: #10b981; }
    .progress-ring { transform: rotate(-90deg); }
    .option-btn { width: 100%; text-align: left; padding: 0.875rem 1.25rem; border: 2px solid var(--grey-200); border-radius: 0.5rem; cursor: pointer; transition: all 0.2s; background: white; font-size: 0.95rem; display: flex; align-items: flex-start; gap: 0.75rem; }
    .option-btn:hover { border-color: var(--accent); background: #eff6ff; }
    .option-btn.selected { border-color: var(--accent); background: #eff6ff; color: var(--navy); }
    .option-btn.correct { border-color: var(--success); background: #f0fdf4; color: #065f46; }
    .option-btn.incorrect { border-color: var(--danger); background: #fef2f2; color: #991b1b; }
    textarea.answer-area { width: 100%; border: 2px solid var(--grey-200); border-radius: 0.5rem; padding: 1rem; font-size: 0.95rem; line-height: 1.6; resize: vertical; min-height: 200px; font-family: inherit; transition: border-color 0.2s; }
    textarea.answer-area:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
    .stat-card { background: white; border-radius: 0.75rem; padding: 1.25rem; border-left: 4px solid var(--accent); box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .sidebar { background: var(--navy); width: 240px; min-height: calc(100vh - 64px); flex-shrink: 0; }
    .sidebar a { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1.5rem; color: #94a3b8; text-decoration: none; transition: all 0.2s; font-size: 0.9rem; }
    .sidebar a:hover, .sidebar a.active { background: rgba(255,255,255,0.1); color: white; }
    .sidebar a.active { border-right: 3px solid var(--gold); }
    .exam-tab { padding: 0.5rem 1.5rem; border-radius: 0.5rem; font-weight: 600; cursor: pointer; transition: all 0.2s; border: 2px solid transparent; }
    .exam-tab.active { border-color: currentColor; }
    .exam-tab.toefl { color: #1e40af; }
    .exam-tab.toefl.active { background: #dbeafe; }
    .exam-tab.ielts { color: #065f46; }
    .exam-tab.ielts.active { background: #d1fae5; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .recording-dot { animation: pulse 1.5s ease-in-out infinite; }
    @media (max-width: 768px) {
      .sidebar { display: none; }
      .sidebar.open { display: block; position: fixed; top: 64px; left: 0; bottom: 0; z-index: 99; width: 240px; }
    }
  </style>
</head>
<body>
${body}
${scripts}
</body>
</html>`

// ==================== PAGE ROUTES ====================

// Login page
app.get('/login', (c) => {
  return c.html(getLayout('Login', `
    <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0f1e35] to-[#1a2b4a] p-4">
      <div class="w-full max-w-md">
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-16 h-16 bg-[#f59e0b] rounded-2xl mb-4">
            <i class="fas fa-graduation-cap text-white text-2xl"></i>
          </div>
          <h1 class="text-3xl font-bold text-white">The Yamen Guide</h1>
          <p class="text-[#94a3b8] mt-1">TOEFL & IELTS Preparation Platform</p>
        </div>
        <div class="card">
          <div class="flex mb-6 bg-[#f1f5f9] rounded-lg p-1">
            <button id="loginTab" onclick="switchTab('login')" class="flex-1 py-2 rounded-md font-semibold text-sm transition-all bg-white text-[#1a2b4a] shadow-sm">Sign In</button>
            <button id="registerTab" onclick="switchTab('register')" class="flex-1 py-2 rounded-md font-semibold text-sm transition-all text-[#94a3b8]">Create Account</button>
          </div>
          
          <div id="loginForm">
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-semibold text-[#475569] mb-1">Email Address</label>
                <input id="loginEmail" type="email" placeholder="your@email.com" 
                  class="w-full border-2 border-[#e2e8f0] rounded-lg px-4 py-3 focus:outline-none focus:border-[#3b82f6] transition-colors" 
                  value="student@prepmaster.edu"/>
              </div>
              <div>
                <label class="block text-sm font-semibold text-[#475569] mb-1">Password</label>
                <div class="relative">
                  <input id="loginPassword" type="password" placeholder="••••••••" 
                    class="w-full border-2 border-[#e2e8f0] rounded-lg px-4 py-3 focus:outline-none focus:border-[#3b82f6] transition-colors"
                    value="Student@123"/>
                  <button onclick="togglePass('loginPassword')" class="absolute right-3 top-3.5 text-[#94a3b8] hover:text-[#475569]">
                    <i class="fas fa-eye text-sm"></i>
                  </button>
                </div>
              </div>
              <div id="loginError" class="hidden text-red-600 text-sm bg-red-50 p-3 rounded-lg"></div>
              <button onclick="doLogin()" class="btn-primary w-full justify-center py-3">
                <i class="fas fa-sign-in-alt"></i> Sign In
              </button>
            </div>
            <div class="mt-4 p-3 bg-[#f8fafc] rounded-lg text-sm text-[#475569]">
              <p class="font-semibold mb-1">Demo Accounts:</p>
              <p>Student: student@prepmaster.edu / Student@123</p>
              <p>Admin: admin@prepmaster.edu / Admin@123</p>
            </div>
          </div>
          
          <div id="registerForm" class="hidden">
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-semibold text-[#475569] mb-1">Full Name</label>
                <input id="regName" type="text" placeholder="John Smith" 
                  class="w-full border-2 border-[#e2e8f0] rounded-lg px-4 py-3 focus:outline-none focus:border-[#3b82f6] transition-colors"/>
              </div>
              <div>
                <label class="block text-sm font-semibold text-[#475569] mb-1">Email Address</label>
                <input id="regEmail" type="email" placeholder="your@email.com"
                  class="w-full border-2 border-[#e2e8f0] rounded-lg px-4 py-3 focus:outline-none focus:border-[#3b82f6] transition-colors"/>
              </div>
              <div>
                <label class="block text-sm font-semibold text-[#475569] mb-1">Password</label>
                <input id="regPassword" type="password" placeholder="Min. 6 characters"
                  class="w-full border-2 border-[#e2e8f0] rounded-lg px-4 py-3 focus:outline-none focus:border-[#3b82f6] transition-colors"/>
              </div>
              <div id="regError" class="hidden text-red-600 text-sm bg-red-50 p-3 rounded-lg"></div>
              <button onclick="doRegister()" class="btn-primary w-full justify-center py-3">
                <i class="fas fa-user-plus"></i> Create Account
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `, `<script>
    function switchTab(tab) {
      document.getElementById('loginForm').classList.toggle('hidden', tab !== 'login');
      document.getElementById('registerForm').classList.toggle('hidden', tab !== 'register');
      document.getElementById('loginTab').className = 'flex-1 py-2 rounded-md font-semibold text-sm transition-all ' + (tab === 'login' ? 'bg-white text-[#1a2b4a] shadow-sm' : 'text-[#94a3b8]');
      document.getElementById('registerTab').className = 'flex-1 py-2 rounded-md font-semibold text-sm transition-all ' + (tab === 'register' ? 'bg-white text-[#1a2b4a] shadow-sm' : 'text-[#94a3b8]');
    }
    function togglePass(id) {
      const el = document.getElementById(id);
      el.type = el.type === 'password' ? 'text' : 'password';
    }
    async function doLogin() {
      const email = document.getElementById('loginEmail').value;
      const password = document.getElementById('loginPassword').value;
      const errEl = document.getElementById('loginError');
      errEl.classList.add('hidden');
      try {
        const res = await fetch('/api/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({email, password}) });
        const data = await res.json();
        if (data.success) {
          window.location.href = data.user.role === 'admin' ? '/admin' : '/dashboard';
        } else {
          errEl.textContent = data.error; errEl.classList.remove('hidden');
        }
      } catch(e) { errEl.textContent = 'Connection error. Please try again.'; errEl.classList.remove('hidden'); }
    }
    async function doRegister() {
      const name = document.getElementById('regName').value;
      const email = document.getElementById('regEmail').value;
      const password = document.getElementById('regPassword').value;
      const errEl = document.getElementById('regError');
      errEl.classList.add('hidden');
      try {
        const res = await fetch('/api/auth/register', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({name, email, password}) });
        const data = await res.json();
        if (data.success) { window.location.href = '/dashboard'; }
        else { errEl.textContent = data.error; errEl.classList.remove('hidden'); }
      } catch(e) { errEl.textContent = 'Connection error. Please try again.'; errEl.classList.remove('hidden'); }
    }
    document.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    // Check if already logged in
    fetch('/api/auth/me').then(r => r.json()).then(d => { if (d.user) window.location.href = d.user.role === 'admin' ? '/admin' : '/dashboard'; });
  </script>`))
})

// Dashboard
app.get('/dashboard', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')

  return c.html(getLayout('Dashboard', `
    <nav class="navbar">
      <a href="/dashboard" class="navbar-brand"><i class="fas fa-graduation-cap text-[#f59e0b]"></i> The Yamen<span class="accent"> Guide</span></a>
      <div class="flex items-center gap-4">
        <button onclick="toggleSidebar()" class="md:hidden text-white text-xl"><i class="fas fa-bars"></i></button>
        <span class="text-[#94a3b8] text-sm hidden sm:block"><i class="fas fa-user-circle mr-1"></i>${user.name}</span>
        <button onclick="logout()" class="btn-secondary text-sm py-2 px-3"><i class="fas fa-sign-out-alt"></i> <span class="hidden sm:inline">Logout</span></button>
      </div>
    </nav>
    <div class="flex">
      <aside class="sidebar" id="sidebar">
        <nav class="py-4">
          <a href="/dashboard" class="active"><i class="fas fa-home w-5"></i> Dashboard</a>
          <a href="/practice"><i class="fas fa-play-circle w-5"></i> Practice Tests</a>
          <a href="/progress"><i class="fas fa-chart-line w-5"></i> My Progress</a>
          <div class="px-6 py-2 mt-4 mb-1 text-xs uppercase tracking-wider text-[#475569] font-semibold">Quick Practice</div>
          <a href="/practice?type=TOEFL&module=reading"><i class="fas fa-book-open w-5"></i> TOEFL Reading</a>
          <a href="/practice?type=TOEFL&module=listening"><i class="fas fa-headphones w-5"></i> TOEFL Listening</a>
          <a href="/practice?type=IELTS&module=reading"><i class="fas fa-file-alt w-5"></i> IELTS Reading</a>
          <a href="/practice?type=IELTS&module=writing"><i class="fas fa-pen w-5"></i> IELTS Writing</a>
        </nav>
      </aside>
      <main class="flex-1 p-6 overflow-y-auto">
        <div class="max-w-5xl mx-auto">
          <div class="mb-6">
            <h1 class="text-2xl font-bold text-[#1a2b4a]">Welcome back, ${user.name.split(' ')[0]}!</h1>
            <p class="text-[#475569] mt-1">Continue your exam preparation journey</p>
          </div>
          
          <!-- Stats Row -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6" id="statsRow">
            <div class="stat-card"><div class="text-2xl font-bold text-[#1a2b4a]" id="statSessions">-</div><div class="text-sm text-[#475569] mt-1">Tests Completed</div></div>
            <div class="stat-card" style="border-color:#f59e0b"><div class="text-2xl font-bold text-[#1a2b4a]" id="statAvg">-</div><div class="text-sm text-[#475569] mt-1">Avg. Score</div></div>
            <div class="stat-card" style="border-color:#10b981"><div class="text-2xl font-bold text-[#1a2b4a]" id="statStreak">-</div><div class="text-sm text-[#475569] mt-1">Day Streak</div></div>
            <div class="stat-card" style="border-color:#8b5cf6"><div class="text-2xl font-bold text-[#1a2b4a]">4</div><div class="text-sm text-[#475569] mt-1">Modules Available</div></div>
          </div>

          <!-- Practice Modules -->
          <h2 class="text-lg font-bold text-[#1a2b4a] mb-4">Practice Modules</h2>
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div class="card module-card reading" onclick="window.location='/practice?type=TOEFL&module=reading'">
              <div class="w-12 h-12 rounded-xl bg-[#fef3c7] flex items-center justify-center mb-3">
                <i class="fas fa-book-open text-[#f59e0b] text-xl"></i>
              </div>
              <h3 class="font-bold text-[#1a2b4a]">Reading</h3>
              <p class="text-xs text-[#94a3b8] mt-1">Comprehension & Analysis</p>
              <div class="mt-3 flex gap-1">
                <span class="badge-toefl">TOEFL</span>
                <span class="badge-ielts">IELTS</span>
              </div>
            </div>
            <div class="card module-card listening" onclick="window.location='/practice?type=TOEFL&module=listening'">
              <div class="w-12 h-12 rounded-xl bg-[#ede9fe] flex items-center justify-center mb-3">
                <i class="fas fa-headphones text-[#8b5cf6] text-xl"></i>
              </div>
              <h3 class="font-bold text-[#1a2b4a]">Listening</h3>
              <p class="text-xs text-[#94a3b8] mt-1">Audio Comprehension</p>
              <div class="mt-3 flex gap-1">
                <span class="badge-toefl">TOEFL</span>
                <span class="badge-ielts">IELTS</span>
              </div>
            </div>
            <div class="card module-card speaking" onclick="window.location='/practice?type=TOEFL&module=speaking'">
              <div class="w-12 h-12 rounded-xl bg-[#fee2e2] flex items-center justify-center mb-3">
                <i class="fas fa-microphone text-[#ef4444] text-xl"></i>
              </div>
              <h3 class="font-bold text-[#1a2b4a]">Speaking</h3>
              <p class="text-xs text-[#94a3b8] mt-1">Oral Production</p>
              <div class="mt-3 flex gap-1">
                <span class="badge-toefl">TOEFL</span>
                <span class="badge-ielts">IELTS</span>
              </div>
            </div>
            <div class="card module-card writing" onclick="window.location='/practice?type=TOEFL&module=writing'">
              <div class="w-12 h-12 rounded-xl bg-[#ecfdf5] flex items-center justify-center mb-3">
                <i class="fas fa-pen-nib text-[#10b981] text-xl"></i>
              </div>
              <h3 class="font-bold text-[#1a2b4a]">Writing</h3>
              <p class="text-xs text-[#94a3b8] mt-1">Essay & Task Writing</p>
              <div class="mt-3 flex gap-1">
                <span class="badge-toefl">TOEFL</span>
                <span class="badge-ielts">IELTS</span>
              </div>
            </div>
          </div>

          <!-- Exam Selection -->
          <h2 class="text-lg font-bold text-[#1a2b4a] mb-4">Choose Your Exam</h2>
          <div class="grid md:grid-cols-2 gap-4 mb-8">
            <div class="card hover:shadow-lg transition-shadow cursor-pointer border-2 hover:border-[#3b82f6]" onclick="window.location='/practice?type=TOEFL'">
              <div class="flex items-start gap-4">
                <div class="w-14 h-14 rounded-xl bg-[#dbeafe] flex items-center justify-center flex-shrink-0">
                  <span class="font-bold text-[#1e40af] text-lg">T</span>
                </div>
                <div>
                  <h3 class="font-bold text-[#1a2b4a] text-lg">TOEFL iBT</h3>
                  <p class="text-sm text-[#475569] mt-1">Internet-Based Test for academic English proficiency. Required for US/Canadian universities.</p>
                  <div class="flex gap-2 mt-2">
                    <span class="badge-reading">Reading</span>
                    <span class="badge-listening">Listening</span>
                    <span class="badge-speaking">Speaking</span>
                    <span class="badge-writing">Writing</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="card hover:shadow-lg transition-shadow cursor-pointer border-2 hover:border-[#10b981]" onclick="window.location='/practice?type=IELTS'">
              <div class="flex items-start gap-4">
                <div class="w-14 h-14 rounded-xl bg-[#d1fae5] flex items-center justify-center flex-shrink-0">
                  <span class="font-bold text-[#065f46] text-lg">I</span>
                </div>
                <div>
                  <h3 class="font-bold text-[#1a2b4a] text-lg">IELTS Academic</h3>
                  <p class="text-sm text-[#475569] mt-1">International English Language Testing System. Accepted by UK, Australia, and global institutions.</p>
                  <div class="flex gap-2 mt-2">
                    <span class="badge-reading">Reading</span>
                    <span class="badge-listening">Listening</span>
                    <span class="badge-speaking">Speaking</span>
                    <span class="badge-writing">Writing</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Recent Activity -->
          <h2 class="text-lg font-bold text-[#1a2b4a] mb-4">Recent Activity</h2>
          <div class="card">
            <div id="recentActivity">
              <div class="text-center py-8 text-[#94a3b8]">
                <i class="fas fa-history text-4xl mb-3"></i>
                <p>No practice sessions yet. Start your first test!</p>
                <a href="/practice" class="btn-primary mt-4 inline-flex"><i class="fas fa-play"></i> Start Practice</a>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  `, `<script>
    function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }
    async function logout() {
      await fetch('/api/auth/logout', {method:'POST'});
      window.location.href = '/login';
    }
    async function loadStats() {
      try {
        const r = await fetch('/api/dashboard/stats');
        const d = await r.json();
        document.getElementById('statSessions').textContent = d.total_sessions || 0;
        document.getElementById('statAvg').textContent = (d.avg_score || 0) + '%';
        document.getElementById('statStreak').textContent = d.streak_days || 0;
        
        if (d.recent_sessions && d.recent_sessions.length > 0) {
          const moduleColors = { reading: 'badge-reading', listening: 'badge-listening', speaking: 'badge-speaking', writing: 'badge-writing' };
          document.getElementById('recentActivity').innerHTML = d.recent_sessions.map(s => {
            const pct = s.max_score > 0 ? Math.round((s.score / s.max_score) * 100) : 0;
            const scoreColor = pct >= 70 ? 'text-green-600' : pct >= 50 ? 'text-yellow-600' : 'text-red-600';
            const date = s.completed_at ? new Date(s.completed_at).toLocaleDateString() : 'N/A';
            return '<div class="flex items-center justify-between py-3 border-b border-[#f1f5f9] last:border-0">' +
              '<div class="flex items-center gap-3">' +
              '<span class="badge-' + (s.exam_type === 'TOEFL' ? 'toefl' : 'ielts') + '">' + s.exam_type + '</span>' +
              '<span class="' + (moduleColors[s.module] || '') + '">' + s.module + '</span>' +
              '<span class="text-sm text-[#475569]">' + date + '</span>' +
              '</div>' +
              '<span class="font-bold ' + scoreColor + '">' + pct + '%</span>' +
              '</div>';
          }).join('');
        }
      } catch(e) { console.error(e); }
    }
    loadStats();
  </script>`))
})

// Practice Selection Page
app.get('/practice', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')

  return c.html(getLayout('Practice', `
    <nav class="navbar">
      <a href="/dashboard" class="navbar-brand"><i class="fas fa-graduation-cap text-[#f59e0b]"></i> The Yamen<span class="accent"> Guide</span></a>
      <div class="flex items-center gap-4">
        <a href="/dashboard" class="text-[#94a3b8] hover:text-white text-sm"><i class="fas fa-home mr-1"></i>Dashboard</a>
        <span class="text-[#94a3b8] text-sm hidden sm:block">${user.name}</span>
        <button onclick="logout()" class="btn-secondary text-sm py-2 px-3"><i class="fas fa-sign-out-alt"></i></button>
      </div>
    </nav>
    <div class="max-w-5xl mx-auto p-6">
      <div class="flex items-center gap-3 mb-6">
        <a href="/dashboard" class="text-[#94a3b8] hover:text-[#1a2b4a]"><i class="fas fa-chevron-left"></i></a>
        <h1 class="text-2xl font-bold text-[#1a2b4a]">Select Practice Test</h1>
      </div>
      
      <!-- Exam Type Tabs -->
      <div class="flex gap-3 mb-6">
        <button id="toeflTab" onclick="selectExam('TOEFL')" class="exam-tab toefl active">
          <i class="fas fa-university mr-2"></i>TOEFL iBT
        </button>
        <button id="ieltsTab" onclick="selectExam('IELTS')" class="exam-tab ielts">
          <i class="fas fa-globe mr-2"></i>IELTS Academic
        </button>
      </div>

      <div id="examInfo" class="card mb-6 bg-[#f0f7ff] border-[#bfdbfe]">
        <div class="flex items-start gap-4">
          <i class="fas fa-info-circle text-[#3b82f6] text-xl mt-0.5"></i>
          <div>
            <h3 class="font-bold text-[#1e40af]" id="examTitle">TOEFL iBT Overview</h3>
            <p class="text-sm text-[#475569] mt-1" id="examDesc">The TOEFL iBT measures academic English skills across four areas. Total score: 0-120. Each section scored 0-30.</p>
            <div class="flex flex-wrap gap-3 mt-2 text-sm text-[#475569]" id="examDetails">
              <span><i class="fas fa-clock mr-1 text-[#3b82f6]"></i>About 3 hours total</span>
              <span><i class="fas fa-star mr-1 text-[#f59e0b]"></i>Score: 0–120</span>
              <span><i class="fas fa-globe mr-1 text-[#10b981]"></i>Accepted globally</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Module Selection -->
      <h2 class="text-lg font-bold text-[#1a2b4a] mb-4">Select Module</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" id="moduleGrid">
        <div class="card module-card reading cursor-pointer" onclick="startPractice('reading')">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-10 h-10 rounded-lg bg-[#fef3c7] flex items-center justify-center">
              <i class="fas fa-book-open text-[#f59e0b]"></i>
            </div>
            <span class="font-bold text-[#1a2b4a]">Reading</span>
          </div>
          <p class="text-xs text-[#94a3b8] mb-3">Read academic passages and answer comprehension questions</p>
          <div class="text-xs text-[#475569]">
            <div><i class="fas fa-clock mr-1"></i>54-72 min</div>
            <div class="mt-1"><i class="fas fa-list mr-1"></i>3-4 passages</div>
          </div>
          <div class="mt-3 pt-3 border-t border-[#f1f5f9]">
            <span class="btn-primary text-xs py-1.5 px-3 w-full justify-center">Start Practice <i class="fas fa-arrow-right"></i></span>
          </div>
        </div>
        
        <div class="card module-card listening cursor-pointer" onclick="startPractice('listening')">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-10 h-10 rounded-lg bg-[#ede9fe] flex items-center justify-center">
              <i class="fas fa-headphones text-[#8b5cf6]"></i>
            </div>
            <span class="font-bold text-[#1a2b4a]">Listening</span>
          </div>
          <p class="text-xs text-[#94a3b8] mb-3">Listen to lectures and conversations, then answer questions</p>
          <div class="text-xs text-[#475569]">
            <div><i class="fas fa-clock mr-1"></i>41-57 min</div>
            <div class="mt-1"><i class="fas fa-list mr-1"></i>4-6 audio clips</div>
          </div>
          <div class="mt-3 pt-3 border-t border-[#f1f5f9]">
            <span class="btn-primary text-xs py-1.5 px-3 w-full justify-center">Start Practice <i class="fas fa-arrow-right"></i></span>
          </div>
        </div>
        
        <div class="card module-card speaking cursor-pointer" onclick="startPractice('speaking')">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-10 h-10 rounded-lg bg-[#fee2e2] flex items-center justify-center">
              <i class="fas fa-microphone text-[#ef4444]"></i>
            </div>
            <span class="font-bold text-[#1a2b4a]">Speaking</span>
          </div>
          <p class="text-xs text-[#94a3b8] mb-3">Respond to prompts and demonstrate spoken English skills</p>
          <div class="text-xs text-[#475569]">
            <div><i class="fas fa-clock mr-1"></i>17 min</div>
            <div class="mt-1"><i class="fas fa-list mr-1"></i>4 tasks</div>
          </div>
          <div class="mt-3 pt-3 border-t border-[#f1f5f9]">
            <span class="btn-primary text-xs py-1.5 px-3 w-full justify-center">Start Practice <i class="fas fa-arrow-right"></i></span>
          </div>
        </div>
        
        <div class="card module-card writing cursor-pointer" onclick="startPractice('writing')">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-10 h-10 rounded-lg bg-[#ecfdf5] flex items-center justify-center">
              <i class="fas fa-pen-nib text-[#10b981]"></i>
            </div>
            <span class="font-bold text-[#1a2b4a]">Writing</span>
          </div>
          <p class="text-xs text-[#94a3b8] mb-3">Write essays and integrated responses demonstrating academic writing</p>
          <div class="text-xs text-[#475569]">
            <div><i class="fas fa-clock mr-1"></i>50 min</div>
            <div class="mt-1"><i class="fas fa-list mr-1"></i>2 tasks</div>
          </div>
          <div class="mt-3 pt-3 border-t border-[#f1f5f9]">
            <span class="btn-primary text-xs py-1.5 px-3 w-full justify-center">Start Practice <i class="fas fa-arrow-right"></i></span>
          </div>
        </div>
      </div>
    </div>
  `, `<script>
    let currentExam = 'TOEFL';
    const params = new URLSearchParams(window.location.search);
    if (params.get('type')) currentExam = params.get('type');
    
    const examInfo = {
      TOEFL: { title: 'TOEFL iBT Overview', desc: 'The TOEFL iBT measures academic English skills across four areas. Total score: 0-120. Each section scored 0-30.', details: '<span><i class="fas fa-clock mr-1 text-[#3b82f6]"></i>About 3 hours total</span><span><i class="fas fa-star mr-1 text-[#f59e0b]"></i>Score: 0–120</span><span><i class="fas fa-globe mr-1 text-[#10b981]"></i>Accepted globally</span>' },
      IELTS: { title: 'IELTS Academic Overview', desc: 'IELTS Academic measures English proficiency for academic purposes. Band scores from 1-9. Most universities require 6.5+.', details: '<span><i class="fas fa-clock mr-1 text-[#3b82f6]"></i>About 2 hrs 45 min</span><span><i class="fas fa-star mr-1 text-[#f59e0b]"></i>Band: 1–9</span><span><i class="fas fa-globe mr-1 text-[#10b981]"></i>160+ countries</span>' }
    };
    
    function selectExam(type) {
      currentExam = type;
      document.getElementById('toeflTab').className = 'exam-tab toefl ' + (type === 'TOEFL' ? 'active' : '');
      document.getElementById('ieltsTab').className = 'exam-tab ielts ' + (type === 'IELTS' ? 'active' : '');
      const info = examInfo[type];
      document.getElementById('examTitle').textContent = info.title;
      document.getElementById('examDesc').textContent = info.desc;
      document.getElementById('examDetails').innerHTML = info.details;
    }
    
    function startPractice(module) {
      window.location.href = '/exam?type=' + currentExam + '&module=' + module;
    }
    
    function logout() { fetch('/api/auth/logout', {method:'POST'}).then(() => window.location.href = '/login'); }
    
    // Set initial tab from URL params
    if (params.get('type') === 'IELTS') selectExam('IELTS');
    if (params.get('module')) startPractice(params.get('module'));
  </script>`))
})

// Exam/Practice Page
app.get('/exam', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')

  return c.html(getLayout('Practice Exam', `
    <nav class="navbar">
      <a href="/dashboard" class="navbar-brand"><i class="fas fa-graduation-cap text-[#f59e0b]"></i> The Yamen<span class="accent"> Guide</span></a>
      <div class="flex items-center gap-4">
        <div id="timerDisplay" class="flex items-center gap-2 bg-[#0f1e35] px-4 py-2 rounded-lg">
          <i class="fas fa-clock text-[#f59e0b]"></i>
          <span class="text-white font-mono font-bold text-lg" id="timerText">--:--</span>
        </div>
        <button onclick="confirmExit()" class="btn-danger text-sm py-2 px-3"><i class="fas fa-times mr-1"></i>Exit</button>
      </div>
    </nav>
    <div id="timerBarContainer" class="w-full bg-[#e2e8f0]"><div id="timerBar" class="timer-bar" style="width:100%;height:4px"></div></div>
    
    <div class="max-w-4xl mx-auto p-4 md:p-6">
      <!-- Loading State -->
      <div id="loadingState" class="text-center py-20">
        <div class="inline-block w-12 h-12 border-4 border-[#3b82f6] border-t-transparent rounded-full animate-spin mb-4"></div>
        <p class="text-[#475569]">Loading your practice questions...</p>
      </div>

      <!-- Question Area -->
      <div id="questionArea" class="hidden">
        <!-- Progress Header -->
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-3">
            <span id="examBadge" class="badge-toefl">TOEFL</span>
            <span id="moduleBadge" class="badge-reading">Reading</span>
            <span class="text-sm text-[#475569]">Question <span id="qNum">1</span> of <span id="qTotal">-</span></span>
          </div>
          <div class="flex gap-1" id="progressDots"></div>
        </div>

        <!-- Passage (if applicable) -->
        <div id="passageArea" class="card mb-4 hidden">
          <h3 class="font-bold text-[#1a2b4a] mb-2 flex items-center gap-2">
            <i class="fas fa-file-alt text-[#f59e0b]"></i> Reading Passage
          </h3>
          <div id="passageText" class="text-sm leading-relaxed text-[#475569] max-h-64 overflow-y-auto pr-2"></div>
        </div>

        <!-- Question -->
        <div class="card mb-4">
          <div class="flex items-start gap-3 mb-4">
            <div class="w-8 h-8 rounded-full bg-[#1a2b4a] text-white flex items-center justify-center flex-shrink-0 font-bold text-sm" id="qNumCircle">1</div>
            <div>
              <p class="text-xs text-[#94a3b8] uppercase tracking-wider mb-1" id="qType">Multiple Choice</p>
              <p class="font-semibold text-[#1a2b4a] text-base leading-snug" id="qTitle">Loading...</p>
            </div>
          </div>
          <div class="ml-11">
            <p class="text-[#475569] mb-4 text-sm leading-relaxed" id="qContent"></p>
            
            <!-- Multiple Choice Options -->
            <div id="optionsArea" class="space-y-2"></div>
            
            <!-- Writing/Speaking Text Area -->
            <div id="textareaArea" class="hidden">
              <div class="flex items-center justify-between mb-2">
                <label class="text-sm font-semibold text-[#475569]">Your Response</label>
                <span class="text-xs text-[#94a3b8]" id="wordCount">0 words</span>
              </div>
              <textarea id="userResponse" class="answer-area" placeholder="Begin typing your response here..."></textarea>
              <div class="flex items-center gap-4 mt-2 text-xs text-[#94a3b8]">
                <span><i class="fas fa-keyboard mr-1"></i>Auto-saved</span>
                <span id="minWordGuide"></span>
              </div>
            </div>

            <!-- Speaking Area -->
            <div id="speakingArea" class="hidden">
              <div class="bg-[#f8fafc] rounded-xl p-6 text-center">
                <div id="speakingPrepTimer" class="mb-4">
                  <p class="text-sm text-[#475569] mb-2">Preparation Time</p>
                  <div class="text-4xl font-mono font-bold text-[#1a2b4a]" id="prepTimerText">0:15</div>
                </div>
                <div id="recordingState" class="hidden">
                  <div class="w-20 h-20 rounded-full bg-[#fee2e2] flex items-center justify-center mx-auto mb-4 cursor-pointer" id="micButton" onclick="toggleRecording()">
                    <i class="fas fa-microphone text-[#ef4444] text-3xl recording-dot" id="micIcon"></i>
                  </div>
                  <p class="font-semibold text-[#1a2b4a]" id="recordingStatus">Click to Start Recording</p>
                  <p class="text-sm text-[#94a3b8] mt-1" id="recordingTime">Response time: <span id="respTimeLeft">0:45</span></p>
                </div>
                <textarea id="speakingNotes" class="answer-area mt-4" style="min-height:80px" placeholder="Optional: Write key points for your speaking response..."></textarea>
              </div>
            </div>
          </div>
        </div>

        <!-- Feedback Area -->
        <div id="feedbackArea" class="hidden card mb-4 border-l-4">
          <div class="flex items-start gap-3">
            <i id="feedbackIcon" class="fas fa-check-circle text-2xl mt-0.5"></i>
            <div>
              <h4 id="feedbackTitle" class="font-bold"></h4>
              <p id="feedbackText" class="text-sm mt-1 text-[#475569]"></p>
              <p id="feedbackExplanation" class="text-sm mt-2 text-[#475569]"></p>
            </div>
          </div>
        </div>

        <!-- Navigation -->
        <div class="flex justify-between items-center">
          <button onclick="prevQuestion()" id="prevBtn" class="btn-secondary" style="visibility:hidden"><i class="fas fa-arrow-left"></i> Previous</button>
          <button onclick="nextQuestion()" id="nextBtn" class="btn-primary">Next <i class="fas fa-arrow-right"></i></button>
          <button onclick="submitExam()" id="submitBtn" class="btn-primary hidden" style="background:#10b981"><i class="fas fa-check"></i> Submit Test</button>
        </div>
      </div>

      <!-- Results Screen -->
      <div id="resultsArea" class="hidden">
        <div class="text-center py-8">
          <div class="w-24 h-24 rounded-full bg-[#dbeafe] flex items-center justify-center mx-auto mb-6">
            <i class="fas fa-trophy text-[#f59e0b] text-4xl"></i>
          </div>
          <h1 class="text-3xl font-bold text-[#1a2b4a] mb-2">Practice Complete!</h1>
          <p class="text-[#475569]">Here's how you performed</p>
        </div>
        
        <div class="grid md:grid-cols-3 gap-4 mb-8">
          <div class="stat-card text-center" style="border-color:#f59e0b">
            <div class="text-3xl font-bold text-[#1a2b4a]" id="finalScore">-</div>
            <div class="text-sm text-[#475569] mt-1">Final Score</div>
          </div>
          <div class="stat-card text-center" style="border-color:#10b981">
            <div class="text-3xl font-bold text-[#1a2b4a]" id="finalPct">-</div>
            <div class="text-sm text-[#475569] mt-1">Percentage</div>
          </div>
          <div class="stat-card text-center" style="border-color:#8b5cf6">
            <div class="text-3xl font-bold text-[#1a2b4a]" id="finalTime">-</div>
            <div class="text-sm text-[#475569] mt-1">Time Taken</div>
          </div>
        </div>

        <div class="card mb-6" id="reviewArea"></div>

        <div class="flex gap-3 justify-center">
          <a href="/practice" class="btn-secondary"><i class="fas fa-redo"></i> Try Another</a>
          <a href="/dashboard" class="btn-primary"><i class="fas fa-home"></i> Dashboard</a>
          <a href="/progress" class="btn-primary" style="background:#10b981"><i class="fas fa-chart-line"></i> View Progress</a>
        </div>
      </div>
    </div>
  `, `<script>
    const params = new URLSearchParams(window.location.search);
    const examType = params.get('type') || 'TOEFL';
    const module = params.get('module') || 'reading';
    
    let questions = [], currentQ = 0, sessionId = null;
    let timerInterval = null, timeLeft = 0, totalTime = 0;
    let startTime = Date.now(), answers = {};
    let speakingPrepTimer = null, speakingRespTimer = null;
    let isRecording = false;

    const moduleTimeLimits = { reading: 1200, listening: 600, speaking: 90, writing: 1800 };
    const moduleColors = { reading: 'badge-reading', listening: 'badge-listening', speaking: 'badge-speaking', writing: 'badge-writing' };
    const moduleIcons = { reading: 'fa-book-open', listening: 'fa-headphones', speaking: 'fa-microphone', writing: 'fa-pen-nib' };

    async function init() {
      // Set badges
      document.getElementById('examBadge').textContent = examType;
      document.getElementById('examBadge').className = examType === 'TOEFL' ? 'badge-toefl' : 'badge-ielts';
      document.getElementById('moduleBadge').textContent = module.charAt(0).toUpperCase() + module.slice(1);
      document.getElementById('moduleBadge').className = moduleColors[module] || 'badge-reading';

      try {
        // Start session
        const sRes = await fetch('/api/sessions/start', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ exam_type: examType, module })
        });
        const sData = await sRes.json();
        sessionId = sData.session_id;

        // Fetch questions
        const qRes = await fetch('/api/questions?exam_type=' + examType + '&module=' + module + '&limit=5');
        const qData = await qRes.json();
        questions = qData.questions || [];

        if (questions.length === 0) {
          document.getElementById('loadingState').innerHTML = '<div class="text-center py-20"><i class="fas fa-exclamation-circle text-4xl text-[#94a3b8] mb-4"></i><p class="text-[#475569]">No questions available for this module yet.</p><a href="/practice" class="btn-primary mt-4 inline-flex">Go Back</a></div>';
          return;
        }

        document.getElementById('qTotal').textContent = questions.length;
        buildProgressDots();
        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('questionArea').classList.remove('hidden');
        
        showQuestion(0);
        startTimer();
      } catch(e) {
        document.getElementById('loadingState').innerHTML = '<div class="text-center py-20"><i class="fas fa-exclamation-circle text-4xl text-red-400 mb-4"></i><p class="text-red-500">Failed to load questions. Please try again.</p><a href="/practice" class="btn-primary mt-4 inline-flex">Go Back</a></div>';
      }
    }

    function buildProgressDots() {
      const container = document.getElementById('progressDots');
      container.innerHTML = questions.map((_, i) => 
        '<div class="w-2 h-2 rounded-full bg-[#e2e8f0] dot-' + i + '"></div>'
      ).join('');
    }

    function updateProgressDot(i, status) {
      const dot = document.querySelector('.dot-' + i);
      if (!dot) return;
      dot.className = 'w-2 h-2 rounded-full ' + 
        (status === 'current' ? 'bg-[#3b82f6]' : status === 'correct' ? 'bg-[#10b981]' : status === 'incorrect' ? 'bg-[#ef4444]' : status === 'answered' ? 'bg-[#f59e0b]' : 'bg-[#e2e8f0]') + ' dot-' + i;
    }

    function startTimer() {
      totalTime = moduleTimeLimits[module] * questions.length;
      timeLeft = totalTime;
      timerInterval = setInterval(tick, 1000);
    }

    function tick() {
      timeLeft--;
      const mins = Math.floor(timeLeft / 60);
      const secs = timeLeft % 60;
      document.getElementById('timerText').textContent = mins + ':' + String(secs).padStart(2,'0');
      const pct = (timeLeft / totalTime) * 100;
      const bar = document.getElementById('timerBar');
      bar.style.width = pct + '%';
      if (pct < 20) bar.className = 'timer-bar timer-warning';
      if (pct < 10) document.getElementById('timerText').classList.add('text-red-400');
      if (timeLeft <= 0) { clearInterval(timerInterval); submitExam(); }
    }

    function showQuestion(idx) {
      currentQ = idx;
      const q = questions[idx];
      updateProgressDot(idx, 'current');
      
      document.getElementById('qNum').textContent = idx + 1;
      document.getElementById('qNumCircle').textContent = idx + 1;
      document.getElementById('qTitle').textContent = q.title;
      document.getElementById('qType').textContent = q.question_type ? q.question_type.replace(/_/g,' ').toUpperCase() : 'QUESTION';
      document.getElementById('qContent').textContent = q.content;
      
      // Show/hide passage
      if (q.passage) {
        document.getElementById('passageArea').classList.remove('hidden');
        document.getElementById('passageText').textContent = q.passage;
      } else { document.getElementById('passageArea').classList.add('hidden'); }

      // Clear feedback
      document.getElementById('feedbackArea').classList.add('hidden');

      // Show appropriate input area
      document.getElementById('optionsArea').classList.add('hidden');
      document.getElementById('textareaArea').classList.add('hidden');
      document.getElementById('speakingArea').classList.add('hidden');

      if (module === 'speaking') {
        document.getElementById('speakingArea').classList.remove('hidden');
        startSpeakingSession(q);
      } else if (module === 'writing') {
        document.getElementById('textareaArea').classList.remove('hidden');
        const ta = document.getElementById('userResponse');
        ta.value = answers[idx] || '';
        ta.addEventListener('input', () => {
          answers[idx] = ta.value;
          const words = ta.value.trim().split(/\\s+/).filter(w => w.length > 0).length;
          document.getElementById('wordCount').textContent = words + ' words';
        });
        document.getElementById('minWordGuide').textContent = q.content.includes('250') ? 'Minimum: 250 words' : 'Minimum: 150 words';
      } else if (q.options) {
        document.getElementById('optionsArea').classList.remove('hidden');
        const opts = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
        const labels = ['A', 'B', 'C', 'D', 'E'];
        document.getElementById('optionsArea').innerHTML = opts.map((opt, i) =>
          '<button class="option-btn ' + (answers[idx] === opt ? 'selected' : '') + '" onclick="selectOption(this, \'' + opt.replace(/'/g, "\\'") + '\')" data-value="' + opt.replace(/"/g, '&quot;') + '">' +
          '<span class="w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center text-xs font-bold border-current">' + labels[i] + '</span>' +
          '<span>' + opt + '</span></button>'
        ).join('');
      }

      // Navigation buttons
      document.getElementById('prevBtn').style.visibility = idx > 0 ? 'visible' : 'hidden';
      document.getElementById('nextBtn').classList.toggle('hidden', idx >= questions.length - 1);
      document.getElementById('submitBtn').classList.toggle('hidden', idx < questions.length - 1);
    }

    function selectOption(btn, value) {
      document.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      answers[currentQ] = value;
    }

    async function nextQuestion() {
      await submitCurrentAnswer();
      if (currentQ < questions.length - 1) showQuestion(currentQ + 1);
    }

    function prevQuestion() {
      if (currentQ > 0) showQuestion(currentQ - 1);
    }

    async function submitCurrentAnswer() {
      if (!sessionId) return;
      const q = questions[currentQ];
      const answer = answers[currentQ] || (module === 'writing' ? document.getElementById('userResponse')?.value : null) || (module === 'speaking' ? document.getElementById('speakingNotes')?.value : null);
      if (!answer) return;

      const timeTaken = Math.round((Date.now() - startTime) / 1000);
      try {
        const res = await fetch('/api/sessions/' + sessionId + '/answer', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ question_id: q.id, answer, time_spent: timeTaken })
        });
        const data = await res.json();
        
        if (data.is_correct !== null) {
          const fb = document.getElementById('feedbackArea');
          fb.classList.remove('hidden');
          if (data.is_correct) {
            fb.className = 'card mb-4 border-l-4 border-green-500 bg-green-50';
            fb.querySelector('#feedbackIcon').className = 'fas fa-check-circle text-2xl mt-0.5 text-green-500';
            document.getElementById('feedbackTitle').textContent = 'Correct! Well done!';
            document.getElementById('feedbackTitle').className = 'font-bold text-green-700';
          } else {
            fb.className = 'card mb-4 border-l-4 border-red-500 bg-red-50';
            fb.querySelector('#feedbackIcon').className = 'fas fa-times-circle text-2xl mt-0.5 text-red-500';
            document.getElementById('feedbackTitle').textContent = 'Incorrect';
            document.getElementById('feedbackTitle').className = 'font-bold text-red-700';
            document.getElementById('feedbackText').textContent = 'Correct answer: ' + data.correct_answer;
          }
          document.getElementById('feedbackExplanation').textContent = data.explanation || '';
          
          // Update option styles
          document.querySelectorAll('.option-btn').forEach(btn => {
            if (btn.dataset.value === data.correct_answer) btn.className = 'option-btn correct';
            else if (btn.classList.contains('selected')) btn.className = 'option-btn incorrect';
          });
          updateProgressDot(currentQ, data.is_correct ? 'correct' : 'incorrect');
        } else {
          updateProgressDot(currentQ, 'answered');
        }
      } catch(e) { console.error(e); }
    }

    async function submitExam() {
      clearInterval(timerInterval);
      if (speakingPrepTimer) clearInterval(speakingPrepTimer);
      if (speakingRespTimer) clearInterval(speakingRespTimer);
      
      await submitCurrentAnswer();
      
      const timeTaken = Math.round((Date.now() - startTime) / 1000);
      try {
        const res = await fetch('/api/sessions/' + sessionId + '/complete', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ time_taken: timeTaken })
        });
        const data = await res.json();
        showResults(data, timeTaken);
      } catch(e) { showResults({ score: 0, max_score: 0 }, timeTaken); }
    }

    function showResults(data, timeTaken) {
      document.getElementById('questionArea').classList.add('hidden');
      document.getElementById('resultsArea').classList.remove('hidden');
      
      const score = data.score || 0;
      const maxScore = data.max_score || 0;
      const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : (module === 'writing' || module === 'speaking' ? 'N/A' : 0);
      const mins = Math.floor(timeTaken / 60), secs = timeTaken % 60;
      
      document.getElementById('finalScore').textContent = maxScore > 0 ? score.toFixed(1) + ' / ' + maxScore.toFixed(1) : 'Submitted';
      document.getElementById('finalPct').textContent = typeof pct === 'number' ? pct + '%' : pct;
      document.getElementById('finalTime').textContent = mins + 'm ' + secs + 's';

      // Performance message
      let perfMsg = '', perfClass = '';
      if (typeof pct === 'number') {
        if (pct >= 80) { perfMsg = 'Excellent! You\'re well-prepared.'; perfClass = 'text-green-600'; }
        else if (pct >= 60) { perfMsg = 'Good job! Keep practicing to improve.'; perfClass = 'text-yellow-600'; }
        else { perfMsg = 'Keep studying! Review the explanations above.'; perfClass = 'text-red-600'; }
      } else { perfMsg = 'Response submitted for review.'; perfClass = 'text-blue-600'; }

      document.getElementById('reviewArea').innerHTML = 
        '<h3 class="font-bold text-[#1a2b4a] mb-3">Performance Analysis</h3>' +
        '<p class="' + perfClass + ' font-semibold mb-3">' + perfMsg + '</p>' +
        '<div class="grid grid-cols-2 gap-3 text-sm">' +
        '<div class="p-3 bg-[#f8fafc] rounded-lg"><span class="text-[#94a3b8]">Exam:</span> <span class="font-semibold">' + examType + '</span></div>' +
        '<div class="p-3 bg-[#f8fafc] rounded-lg"><span class="text-[#94a3b8]">Module:</span> <span class="font-semibold capitalize">' + module + '</span></div>' +
        '<div class="p-3 bg-[#f8fafc] rounded-lg"><span class="text-[#94a3b8]">Questions:</span> <span class="font-semibold">' + questions.length + '</span></div>' +
        '<div class="p-3 bg-[#f8fafc] rounded-lg"><span class="text-[#94a3b8]">Time:</span> <span class="font-semibold">' + mins + 'm ' + secs + 's</span></div>' +
        '</div>';
    }

    function startSpeakingSession(q) {
      const prepTime = q.content.includes('15') ? 15 : q.content.includes('30') ? 30 : 60;
      const respTime = q.time_limit || 60;
      let prepLeft = prepTime;

      document.getElementById('speakingPrepTimer').classList.remove('hidden');
      document.getElementById('recordingState').classList.add('hidden');
      document.getElementById('prepTimerText').textContent = '0:' + String(prepLeft).padStart(2,'0');

      speakingPrepTimer = setInterval(() => {
        prepLeft--;
        document.getElementById('prepTimerText').textContent = '0:' + String(prepLeft).padStart(2,'0');
        if (prepLeft <= 0) {
          clearInterval(speakingPrepTimer);
          document.getElementById('speakingPrepTimer').classList.add('hidden');
          document.getElementById('recordingState').classList.remove('hidden');
          startResponseTimer(respTime);
        }
      }, 1000);
    }

    function startResponseTimer(total) {
      let left = total;
      document.getElementById('respTimeLeft').textContent = '0:' + String(left).padStart(2,'0');
      speakingRespTimer = setInterval(() => {
        left--;
        const m = Math.floor(left/60), s = left % 60;
        document.getElementById('respTimeLeft').textContent = m + ':' + String(s).padStart(2,'0');
        if (left <= 0) { clearInterval(speakingRespTimer); document.getElementById('recordingStatus').textContent = 'Time up!'; }
      }, 1000);
    }

    function toggleRecording() {
      isRecording = !isRecording;
      const icon = document.getElementById('micIcon');
      const status = document.getElementById('recordingStatus');
      if (isRecording) {
        icon.className = 'fas fa-stop text-[#ef4444] text-3xl';
        status.textContent = 'Recording... Click to stop';
        status.className = 'font-semibold text-red-600';
      } else {
        icon.className = 'fas fa-microphone text-[#ef4444] text-3xl recording-dot';
        status.textContent = 'Recording stopped. Click to re-record.';
        status.className = 'font-semibold text-[#475569]';
        answers[currentQ] = document.getElementById('speakingNotes').value || 'Speaking response recorded';
      }
    }

    function confirmExit() {
      if (confirm('Are you sure you want to exit? Your progress will be lost.')) {
        clearInterval(timerInterval);
        window.location.href = '/practice';
      }
    }

    init();
  </script>`))
})

// Progress Page
app.get('/progress', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')

  return c.html(getLayout('My Progress', `
    <nav class="navbar">
      <a href="/dashboard" class="navbar-brand"><i class="fas fa-graduation-cap text-[#f59e0b]"></i> The Yamen<span class="accent"> Guide</span></a>
      <div class="flex items-center gap-4">
        <a href="/dashboard" class="text-[#94a3b8] hover:text-white text-sm"><i class="fas fa-home mr-1"></i>Dashboard</a>
        <span class="text-[#94a3b8] text-sm hidden sm:block">${user.name}</span>
        <button onclick="fetch('/api/auth/logout',{method:'POST'}).then(()=>location.href='/login')" class="btn-secondary text-sm py-2 px-3"><i class="fas fa-sign-out-alt"></i></button>
      </div>
    </nav>
    <div class="max-w-5xl mx-auto p-6">
      <div class="flex items-center gap-3 mb-6">
        <a href="/dashboard" class="text-[#94a3b8] hover:text-[#1a2b4a]"><i class="fas fa-chevron-left"></i></a>
        <h1 class="text-2xl font-bold text-[#1a2b4a]">My Progress</h1>
      </div>

      <!-- Overall Stats -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6" id="overallStats">
        <div class="stat-card"><div class="text-2xl font-bold" id="pTotalSessions">-</div><div class="text-sm text-[#475569] mt-1">Total Tests</div></div>
        <div class="stat-card" style="border-color:#f59e0b"><div class="text-2xl font-bold" id="pAvgScore">-</div><div class="text-sm text-[#475569] mt-1">Avg Score</div></div>
        <div class="stat-card" style="border-color:#10b981"><div class="text-2xl font-bold" id="pStreak">-</div><div class="text-sm text-[#475569] mt-1">Day Streak</div></div>
        <div class="stat-card" style="border-color:#8b5cf6"><div class="text-2xl font-bold" id="pModules">-</div><div class="text-sm text-[#475569] mt-1">Modules Practiced</div></div>
      </div>

      <!-- Module Breakdown -->
      <div class="grid md:grid-cols-2 gap-6 mb-6">
        <div class="card">
          <h3 class="font-bold text-[#1a2b4a] mb-4"><i class="fas fa-chart-bar mr-2 text-[#3b82f6]"></i>Performance by Module</h3>
          <div id="moduleBreakdown">
            <div class="text-center py-8 text-[#94a3b8]"><i class="fas fa-chart-bar text-4xl mb-3"></i><p>Complete practice sessions to see your breakdown</p></div>
          </div>
        </div>
        <div class="card">
          <h3 class="font-bold text-[#1a2b4a] mb-4"><i class="fas fa-history mr-2 text-[#10b981]"></i>Recent Sessions</h3>
          <div id="recentSessions">
            <div class="text-center py-8 text-[#94a3b8]"><i class="fas fa-history text-4xl mb-3"></i><p>No sessions yet</p></div>
          </div>
        </div>
      </div>

      <!-- Tips -->
      <div class="card bg-gradient-to-r from-[#0f1e35] to-[#1a2b4a] text-white">
        <h3 class="font-bold text-lg mb-4"><i class="fas fa-lightbulb text-[#f59e0b] mr-2"></i>Study Tips</h3>
        <div class="grid md:grid-cols-2 gap-4 text-sm">
          <div class="flex gap-3"><i class="fas fa-check-circle text-[#10b981] mt-0.5"></i><div><strong>Practice Daily</strong><p class="text-[#94a3b8] mt-0.5">Even 30 minutes of daily practice is more effective than long irregular sessions.</p></div></div>
          <div class="flex gap-3"><i class="fas fa-check-circle text-[#10b981] mt-0.5"></i><div><strong>Review Mistakes</strong><p class="text-[#94a3b8] mt-0.5">Always read explanations for incorrect answers to understand the reasoning.</p></div></div>
          <div class="flex gap-3"><i class="fas fa-check-circle text-[#10b981] mt-0.5"></i><div><strong>Simulate Real Conditions</strong><p class="text-[#94a3b8] mt-0.5">Practice with the timer to build speed and reduce exam anxiety.</p></div></div>
          <div class="flex gap-3"><i class="fas fa-check-circle text-[#10b981] mt-0.5"></i><div><strong>Focus on Weak Areas</strong><p class="text-[#94a3b8] mt-0.5">Spend more time on modules where your score is below 70%.</p></div></div>
        </div>
      </div>
    </div>
  `, `<script>
    async function loadProgress() {
      const r = await fetch('/api/dashboard/stats');
      const d = await r.json();
      
      document.getElementById('pTotalSessions').textContent = d.total_sessions || 0;
      document.getElementById('pAvgScore').textContent = (d.avg_score || 0) + '%';
      document.getElementById('pStreak').textContent = d.streak_days || 0;
      document.getElementById('pModules').textContent = d.module_stats ? d.module_stats.length : 0;

      if (d.module_stats && d.module_stats.length > 0) {
        const mbColors = { reading: '#f59e0b', listening: '#8b5cf6', speaking: '#ef4444', writing: '#10b981' };
        document.getElementById('moduleBreakdown').innerHTML = d.module_stats.map(s => {
          const pct = Math.round(s.avg_score || 0);
          const color = mbColors[s.module] || '#3b82f6';
          return '<div class="mb-4">' +
            '<div class="flex justify-between text-sm mb-1">' +
            '<span class="font-semibold capitalize">' + s.exam_type + ' - ' + s.module + '</span>' +
            '<span class="font-bold" style="color:' + color + '">' + pct + '%</span></div>' +
            '<div class="w-full bg-[#f1f5f9] rounded-full h-3">' +
            '<div class="h-3 rounded-full transition-all duration-500" style="width:' + pct + '%;background:' + color + '"></div></div>' +
            '<div class="text-xs text-[#94a3b8] mt-0.5">' + s.sessions + ' session(s) completed</div></div>';
        }).join('');
      }

      if (d.recent_sessions && d.recent_sessions.length > 0) {
        document.getElementById('recentSessions').innerHTML = d.recent_sessions.map(s => {
          const pct = s.max_score > 0 ? Math.round((s.score / s.max_score) * 100) : null;
          const scoreText = pct !== null ? pct + '%' : 'Submitted';
          const color = pct >= 70 ? 'text-green-600' : pct >= 50 ? 'text-yellow-600' : 'text-red-600';
          const date = s.completed_at ? new Date(s.completed_at).toLocaleDateString() : '';
          return '<div class="flex items-center justify-between py-2 border-b border-[#f1f5f9] last:border-0">' +
            '<div><span class="' + (s.exam_type === 'TOEFL' ? 'badge-toefl' : 'badge-ielts') + ' mr-2">' + s.exam_type + '</span>' +
            '<span class="text-sm font-semibold capitalize">' + s.module + '</span>' +
            '<span class="text-xs text-[#94a3b8] ml-2">' + date + '</span></div>' +
            '<span class="font-bold ' + color + '">' + scoreText + '</span></div>';
        }).join('');
      }
    }
    loadProgress();
  </script>`))
})

// Admin Panel
app.get('/admin', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  if (user.role !== 'admin') return c.redirect('/dashboard')

  return c.html(getLayout('Admin Panel', `
    <nav class="navbar">
      <a href="/admin" class="navbar-brand"><i class="fas fa-graduation-cap text-[#f59e0b]"></i> The Yamen<span class="accent"> Guide</span> <span class="text-xs text-[#94a3b8] ml-2 font-normal">Admin</span></a>
      <div class="flex items-center gap-4">
        <span class="text-[#94a3b8] text-sm hidden sm:block"><i class="fas fa-shield-alt mr-1 text-[#f59e0b]"></i>${user.name}</span>
        <button onclick="fetch('/api/auth/logout',{method:'POST'}).then(()=>location.href='/login')" class="btn-secondary text-sm py-2 px-3"><i class="fas fa-sign-out-alt"></i> Logout</button>
      </div>
    </nav>
    <div class="flex">
      <aside class="sidebar">
        <nav class="py-4">
          <a href="#" onclick="showTab('overview')" id="nav-overview" class="active"><i class="fas fa-tachometer-alt w-5"></i> Overview</a>
          <a href="#" onclick="showTab('questions')" id="nav-questions"><i class="fas fa-question-circle w-5"></i> Questions</a>
          <a href="#" onclick="showTab('users')" id="nav-users"><i class="fas fa-users w-5"></i> Students</a>
          <a href="#" onclick="showTab('add-question')" id="nav-add-question"><i class="fas fa-plus-circle w-5"></i> Add Question</a>
        </nav>
      </aside>
      <main class="flex-1 p-6 overflow-y-auto">
        <!-- Overview Tab -->
        <div id="tab-overview">
          <h1 class="text-2xl font-bold text-[#1a2b4a] mb-6">Platform Overview</h1>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div class="stat-card"><div class="text-2xl font-bold text-[#1a2b4a]" id="aStudents">-</div><div class="text-sm text-[#475569] mt-1">Total Students</div></div>
            <div class="stat-card" style="border-color:#f59e0b"><div class="text-2xl font-bold text-[#1a2b4a]" id="aSessions">-</div><div class="text-sm text-[#475569] mt-1">Total Sessions</div></div>
            <div class="stat-card" style="border-color:#10b981"><div class="text-2xl font-bold text-[#1a2b4a]" id="aQuestions">-</div><div class="text-sm text-[#475569] mt-1">Active Questions</div></div>
            <div class="stat-card" style="border-color:#8b5cf6"><div class="text-2xl font-bold text-[#1a2b4a]">2</div><div class="text-sm text-[#475569] mt-1">Exam Types</div></div>
          </div>

          <div class="card mb-4">
            <h3 class="font-bold text-[#1a2b4a] mb-4"><i class="fas fa-chart-pie mr-2 text-[#3b82f6]"></i>Session Distribution</h3>
            <div id="examBreakdown" class="grid grid-cols-2 md:grid-cols-4 gap-3"></div>
          </div>

          <div class="card bg-[#f0fdf4] border-green-200">
            <h3 class="font-bold text-green-800 mb-3"><i class="fas fa-cogs mr-2"></i>Quick Setup</h3>
            <div class="flex flex-wrap gap-3">
              <button onclick="setupDB()" class="btn-primary text-sm"><i class="fas fa-database mr-1"></i>Initialize Database</button>
              <button onclick="seedData()" class="btn-secondary text-sm"><i class="fas fa-seedling mr-1"></i>Seed Sample Questions</button>
            </div>
            <p class="text-xs text-green-700 mt-2">Use these buttons to set up the database for first-time use.</p>
            <div id="setupMsg" class="mt-2 text-sm hidden"></div>
          </div>
        </div>

        <!-- Questions Tab -->
        <div id="tab-questions" class="hidden">
          <div class="flex items-center justify-between mb-6">
            <h1 class="text-2xl font-bold text-[#1a2b4a]">Manage Questions</h1>
            <button onclick="showTab('add-question')" class="btn-primary text-sm"><i class="fas fa-plus"></i> Add Question</button>
          </div>
          <div class="card">
            <div class="flex gap-3 mb-4">
              <select id="filterExam" onchange="loadQuestions()" class="border border-[#e2e8f0] rounded-lg px-3 py-2 text-sm">
                <option value="">All Exams</option>
                <option value="TOEFL">TOEFL</option>
                <option value="IELTS">IELTS</option>
              </select>
              <select id="filterModule" onchange="loadQuestions()" class="border border-[#e2e8f0] rounded-lg px-3 py-2 text-sm">
                <option value="">All Modules</option>
                <option value="reading">Reading</option>
                <option value="listening">Listening</option>
                <option value="speaking">Speaking</option>
                <option value="writing">Writing</option>
              </select>
            </div>
            <div id="questionsList" class="overflow-x-auto">
              <p class="text-[#94a3b8] text-center py-8">Loading questions...</p>
            </div>
          </div>
        </div>

        <!-- Users Tab -->
        <div id="tab-users" class="hidden">
          <h1 class="text-2xl font-bold text-[#1a2b4a] mb-6">Student Management</h1>
          <div class="card">
            <div id="usersList">
              <p class="text-[#94a3b8] text-center py-8">Loading students...</p>
            </div>
          </div>
        </div>

        <!-- Add Question Tab -->
        <div id="tab-add-question" class="hidden">
          <div class="flex items-center gap-3 mb-6">
            <button onclick="showTab('questions')" class="text-[#94a3b8] hover:text-[#1a2b4a]"><i class="fas fa-chevron-left"></i></button>
            <h1 class="text-2xl font-bold text-[#1a2b4a]">Add New Question</h1>
          </div>
          <div class="card max-w-3xl">
            <div class="grid md:grid-cols-2 gap-4 mb-4">
              <div>
                <label class="block text-sm font-semibold text-[#475569] mb-1">Exam Type *</label>
                <select id="aqExam" class="w-full border-2 border-[#e2e8f0] rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#3b82f6]">
                  <option value="TOEFL">TOEFL iBT</option>
                  <option value="IELTS">IELTS Academic</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-semibold text-[#475569] mb-1">Module *</label>
                <select id="aqModule" class="w-full border-2 border-[#e2e8f0] rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#3b82f6]">
                  <option value="reading">Reading</option>
                  <option value="listening">Listening</option>
                  <option value="speaking">Speaking</option>
                  <option value="writing">Writing</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-semibold text-[#475569] mb-1">Question Type *</label>
                <select id="aqType" class="w-full border-2 border-[#e2e8f0] rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#3b82f6]">
                  <option value="multiple_choice">Multiple Choice</option>
                  <option value="true_false">True/False/Not Given</option>
                  <option value="fill_blank">Fill in the Blank</option>
                  <option value="independent">Independent Task</option>
                  <option value="integrated">Integrated Task</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-semibold text-[#475569] mb-1">Difficulty *</label>
                <select id="aqDiff" class="w-full border-2 border-[#e2e8f0] rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#3b82f6]">
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </div>
            </div>
            <div class="mb-4">
              <label class="block text-sm font-semibold text-[#475569] mb-1">Question Title *</label>
              <input id="aqTitle" type="text" placeholder="Brief title for the question" class="w-full border-2 border-[#e2e8f0] rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#3b82f6]"/>
            </div>
            <div class="mb-4">
              <label class="block text-sm font-semibold text-[#475569] mb-1">Question Content / Prompt *</label>
              <textarea id="aqContent" rows="4" placeholder="The full question text or prompt" class="answer-area"></textarea>
            </div>
            <div class="mb-4">
              <label class="block text-sm font-semibold text-[#475569] mb-1">Reading Passage (optional)</label>
              <textarea id="aqPassage" rows="5" placeholder="Paste the reading or listening transcript here (optional)" class="answer-area"></textarea>
            </div>
            <div class="mb-4">
              <label class="block text-sm font-semibold text-[#475569] mb-1">Answer Options (one per line, for multiple choice)</label>
              <textarea id="aqOptions" rows="4" placeholder="Option A&#10;Option B&#10;Option C&#10;Option D" class="answer-area" style="min-height:100px"></textarea>
            </div>
            <div class="grid md:grid-cols-2 gap-4 mb-4">
              <div>
                <label class="block text-sm font-semibold text-[#475569] mb-1">Correct Answer</label>
                <input id="aqAnswer" type="text" placeholder="Exact text of correct option" class="w-full border-2 border-[#e2e8f0] rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#3b82f6]"/>
              </div>
              <div>
                <label class="block text-sm font-semibold text-[#475569] mb-1">Points</label>
                <input id="aqPoints" type="number" value="1" min="0.5" step="0.5" class="w-full border-2 border-[#e2e8f0] rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#3b82f6]"/>
              </div>
            </div>
            <div class="mb-4">
              <label class="block text-sm font-semibold text-[#475569] mb-1">Explanation</label>
              <textarea id="aqExplanation" rows="2" placeholder="Brief explanation of the correct answer" class="answer-area" style="min-height:80px"></textarea>
            </div>
            <div class="mb-4">
              <label class="block text-sm font-semibold text-[#475569] mb-1">Time Limit (seconds)</label>
              <input id="aqTime" type="number" value="600" min="30" class="w-full border-2 border-[#e2e8f0] rounded-lg px-3 py-2.5 focus:outline-none focus:border-[#3b82f6]"/>
            </div>
            <div id="aqError" class="hidden text-red-600 text-sm bg-red-50 p-3 rounded-lg mb-4"></div>
            <div id="aqSuccess" class="hidden text-green-600 text-sm bg-green-50 p-3 rounded-lg mb-4"></div>
            <div class="flex gap-3">
              <button onclick="addQuestion()" class="btn-primary"><i class="fas fa-save mr-1"></i>Save Question</button>
              <button onclick="resetForm()" class="btn-secondary"><i class="fas fa-redo mr-1"></i>Reset</button>
            </div>
          </div>
        </div>
      </main>
    </div>
  `, `<script>
    function showTab(tab) {
      ['overview','questions','users','add-question'].forEach(t => {
        document.getElementById('tab-' + t)?.classList.add('hidden');
        document.getElementById('nav-' + t)?.classList.remove('active');
      });
      document.getElementById('tab-' + tab)?.classList.remove('hidden');
      document.getElementById('nav-' + tab)?.classList.add('active');
      if (tab === 'questions') loadQuestions();
      if (tab === 'users') loadUsers();
      if (tab === 'overview') loadAdminStats();
    }

    async function loadAdminStats() {
      const r = await fetch('/api/admin/stats');
      const d = await r.json();
      document.getElementById('aStudents').textContent = d.total_users || 0;
      document.getElementById('aSessions').textContent = d.total_sessions || 0;
      document.getElementById('aQuestions').textContent = d.total_questions || 0;
      
      if (d.exam_breakdown && d.exam_breakdown.length > 0) {
        const colors = { reading: '#f59e0b', listening: '#8b5cf6', speaking: '#ef4444', writing: '#10b981' };
        document.getElementById('examBreakdown').innerHTML = d.exam_breakdown.map(e => 
          '<div class="p-3 bg-[#f8fafc] rounded-lg text-center">' +
          '<div class="text-lg font-bold text-[#1a2b4a]">' + e.count + '</div>' +
          '<div class="text-xs font-semibold" style="color:' + (colors[e.module] || '#3b82f6') + '">' + e.exam_type + ' ' + e.module.toUpperCase() + '</div>' +
          '</div>'
        ).join('');
      }
    }

    async function loadQuestions() {
      const exam = document.getElementById('filterExam')?.value || '';
      const mod = document.getElementById('filterModule')?.value || '';
      let url = '/api/admin/questions';
      const res = await fetch(url);
      const data = await res.json();
      const qs = data.questions || [];
      
      const filtered = qs.filter(q => (!exam || q.exam_type === exam) && (!mod || q.module === mod));
      
      if (filtered.length === 0) {
        document.getElementById('questionsList').innerHTML = '<p class="text-center py-8 text-[#94a3b8]">No questions found</p>';
        return;
      }
      
      document.getElementById('questionsList').innerHTML = 
        '<table class="w-full text-sm">' +
        '<thead><tr class="border-b border-[#f1f5f9]">' +
        '<th class="text-left py-3 px-2 font-semibold text-[#475569]">Title</th>' +
        '<th class="text-left py-3 px-2 font-semibold text-[#475569]">Exam</th>' +
        '<th class="text-left py-3 px-2 font-semibold text-[#475569]">Module</th>' +
        '<th class="text-left py-3 px-2 font-semibold text-[#475569]">Type</th>' +
        '<th class="text-left py-3 px-2 font-semibold text-[#475569]">Difficulty</th>' +
        '<th class="text-left py-3 px-2 font-semibold text-[#475569]">Status</th>' +
        '<th class="py-3 px-2"></th></tr></thead><tbody>' +
        filtered.map(q => 
          '<tr class="border-b border-[#f1f5f9] hover:bg-[#f8fafc]">' +
          '<td class="py-3 px-2 font-medium">' + q.title.substring(0,40) + (q.title.length > 40 ? '...' : '') + '</td>' +
          '<td class="py-3 px-2"><span class="' + (q.exam_type === 'TOEFL' ? 'badge-toefl' : 'badge-ielts') + '">' + q.exam_type + '</span></td>' +
          '<td class="py-3 px-2 capitalize">' + q.module + '</td>' +
          '<td class="py-3 px-2 capitalize text-xs text-[#94a3b8]">' + (q.question_type || '').replace(/_/g,' ') + '</td>' +
          '<td class="py-3 px-2 capitalize">' + (q.difficulty || '') + '</td>' +
          '<td class="py-3 px-2"><span class="' + (q.is_active ? 'text-green-600' : 'text-red-500') + ' text-xs font-semibold">' + (q.is_active ? 'Active' : 'Inactive') + '</span></td>' +
          '<td class="py-3 px-2"><button onclick="deleteQ(' + q.id + ')" class="text-red-400 hover:text-red-600 text-xs"><i class="fas fa-trash"></i></button></td>' +
          '</tr>'
        ).join('') + '</tbody></table>';
    }

    async function deleteQ(id) {
      if (!confirm('Deactivate this question?')) return;
      await fetch('/api/admin/questions/' + id, {method:'DELETE'});
      loadQuestions();
    }

    async function loadUsers() {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      const users = data.users || [];
      
      if (users.length === 0) {
        document.getElementById('usersList').innerHTML = '<p class="text-center py-8 text-[#94a3b8]">No students found</p>';
        return;
      }
      
      document.getElementById('usersList').innerHTML =
        '<table class="w-full text-sm">' +
        '<thead><tr class="border-b border-[#f1f5f9]">' +
        '<th class="text-left py-3 px-2 font-semibold text-[#475569]">Name</th>' +
        '<th class="text-left py-3 px-2 font-semibold text-[#475569]">Email</th>' +
        '<th class="text-left py-3 px-2 font-semibold text-[#475569]">Role</th>' +
        '<th class="text-left py-3 px-2 font-semibold text-[#475569]">Sessions</th>' +
        '<th class="text-left py-3 px-2 font-semibold text-[#475569]">Joined</th>' +
        '<th class="text-left py-3 px-2 font-semibold text-[#475569]">Last Active</th></tr></thead><tbody>' +
        users.map(u =>
          '<tr class="border-b border-[#f1f5f9] hover:bg-[#f8fafc]">' +
          '<td class="py-3 px-2 font-medium">' + u.name + '</td>' +
          '<td class="py-3 px-2 text-[#475569]">' + u.email + '</td>' +
          '<td class="py-3 px-2"><span class="' + (u.role === 'admin' ? 'badge-toefl' : 'badge-ielts') + '">' + u.role + '</span></td>' +
          '<td class="py-3 px-2">' + (u.total_sessions || 0) + '</td>' +
          '<td class="py-3 px-2 text-xs text-[#94a3b8]">' + (u.created_at ? new Date(u.created_at).toLocaleDateString() : '-') + '</td>' +
          '<td class="py-3 px-2 text-xs text-[#94a3b8]">' + (u.last_login ? new Date(u.last_login).toLocaleDateString() : 'Never') + '</td>' +
          '</tr>'
        ).join('') + '</tbody></table>';
    }

    async function addQuestion() {
      const errEl = document.getElementById('aqError');
      const sucEl = document.getElementById('aqSuccess');
      errEl.classList.add('hidden'); sucEl.classList.add('hidden');
      
      const optText = document.getElementById('aqOptions').value.trim();
      const options = optText ? optText.split('\\n').map(o => o.trim()).filter(o => o) : null;
      
      const body = {
        exam_type: document.getElementById('aqExam').value,
        module: document.getElementById('aqModule').value,
        question_type: document.getElementById('aqType').value,
        difficulty: document.getElementById('aqDiff').value,
        title: document.getElementById('aqTitle').value,
        content: document.getElementById('aqContent').value,
        passage: document.getElementById('aqPassage').value || null,
        options: options,
        correct_answer: document.getElementById('aqAnswer').value || null,
        explanation: document.getElementById('aqExplanation').value || null,
        time_limit: parseInt(document.getElementById('aqTime').value),
        points: parseFloat(document.getElementById('aqPoints').value)
      };
      
      if (!body.title || !body.content) {
        errEl.textContent = 'Title and content are required.'; errEl.classList.remove('hidden'); return;
      }
      
      const res = await fetch('/api/admin/questions', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.success) { sucEl.textContent = 'Question added successfully! ID: ' + data.id; sucEl.classList.remove('hidden'); resetForm(); }
      else { errEl.textContent = data.error || 'Failed to add question'; errEl.classList.remove('hidden'); }
    }

    function resetForm() {
      ['aqTitle','aqContent','aqPassage','aqOptions','aqAnswer','aqExplanation'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('aqPoints').value = '1';
      document.getElementById('aqTime').value = '600';
    }

    async function setupDB() {
      const btn = event.target; btn.disabled = true; btn.textContent = 'Setting up...';
      const msg = document.getElementById('setupMsg');
      try {
        const r = await fetch('/api/setup'); const d = await r.json();
        msg.textContent = d.success ? 'Database initialized!' : 'Error: ' + d.error;
        msg.className = 'mt-2 text-sm ' + (d.success ? 'text-green-700' : 'text-red-600');
        msg.classList.remove('hidden');
        loadAdminStats();
      } finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-database mr-1"></i>Initialize Database'; }
    }

    async function seedData() {
      const btn = event.target; btn.disabled = true; btn.textContent = 'Seeding...';
      const msg = document.getElementById('setupMsg');
      try {
        const r = await fetch('/api/setup/seed'); const d = await r.json();
        msg.textContent = d.success ? d.message : 'Error: ' + d.error;
        msg.className = 'mt-2 text-sm ' + (d.success ? 'text-green-700' : 'text-red-600');
        msg.classList.remove('hidden');
        loadAdminStats();
      } finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-seedling mr-1"></i>Seed Sample Questions'; }
    }

    loadAdminStats();
  </script>`))
})

// Root redirect
app.get('/', async (c) => {
  const user = await getUser(c)
  if (user) return c.redirect(user.role === 'admin' ? '/admin' : '/dashboard')
  return c.redirect('/login')
})

export default app
