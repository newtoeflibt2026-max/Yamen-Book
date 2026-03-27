import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = { DB: D1Database }
const app = new Hono<{ Bindings: Bindings }>()
app.use('/api/*', cors())

// ==================== HELPERS ====================
async function hashPassword(p: string) {
  const d = new TextEncoder().encode(p + 'prepmaster_salt_2024')
  const h = await crypto.subtle.digest('SHA-256', d)
  return btoa(String.fromCharCode(...new Uint8Array(h)))
}
async function genId() {
  const a = new Uint8Array(32); crypto.getRandomValues(a)
  return Array.from(a).map(b => b.toString(16).padStart(2,'0')).join('')
}
async function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const a = new Uint8Array(8); crypto.getRandomValues(a)
  return Array.from(a).map(b => chars[b % chars.length]).join('').replace(/(.{4})/g,'$1-').slice(0,-1)
}
async function getUser(c: any) {
  const sid = getCookie(c, 'session_id'); if (!sid) return null
  return c.env.DB.prepare(`SELECT s.user_id,u.name,u.email,u.role FROM auth_sessions s JOIN users u ON s.user_id=u.id WHERE s.id=? AND s.expires_at>datetime('now')`).bind(sid).first()
}

// ==================== COURSES DATA ====================
const COURSES = [
  { code:'IELTS_FULL',    name:'IELTS Academic – Full Course',    name_ar:'أيلتس أكاديمي – الكورس الكامل',   exam_type:'IELTS',       module:null,        price:150, icon:'fa-globe',       color:'#0ea5e9', desc_ar:'تدريب شامل على جميع أقسام الأيلتس: Reading، Writing، Listening، Speaking مع محاكاة كاملة للاختبار الحقيقي.' },
  { code:'IELTS_READ',    name:'IELTS Reading',                   name_ar:'أيلتس – قسم القراءة',              exam_type:'IELTS',       module:'reading',   price:50,  icon:'fa-book-open',   color:'#0ea5e9', desc_ar:'تدريب متخصص على استراتيجيات القراءة والفهم للأيلتس.' },
  { code:'IELTS_WRITE',   name:'IELTS Writing',                   name_ar:'أيلتس – قسم الكتابة',             exam_type:'IELTS',       module:'writing',   price:50,  icon:'fa-pen-nib',     color:'#0ea5e9', desc_ar:'Task 1 و Task 2 مع نماذج احترافية وتصحيح مفصّل.' },
  { code:'IELTS_LISTEN',  name:'IELTS Listening',                 name_ar:'أيلتس – قسم الاستماع',            exam_type:'IELTS',       module:'listening', price:50,  icon:'fa-headphones',  color:'#0ea5e9', desc_ar:'تدريب على الأقسام الأربعة مع استراتيجيات ملء الفراغات والإجابات.' },
  { code:'IELTS_SPEAK',   name:'IELTS Speaking',                  name_ar:'أيلتس – قسم التحدث',              exam_type:'IELTS',       module:'speaking',  price:50,  icon:'fa-microphone',  color:'#0ea5e9', desc_ar:'محادثات فردية وتدريب على الأجزاء الثلاثة مع تغذية راجعة فورية.' },
  { code:'TOEFL_FULL',   name:'TOEFL iBT – Full Course',         name_ar:'تويفل iBT – الكورس الكامل',       exam_type:'TOEFL',       module:null,        price:180, icon:'fa-university',  color:'#ef4444', desc_ar:'تدريب كامل على جميع أقسام التوفل مع اختبارات محاكاة وتصحيح مفصّل.' },
  { code:'TOEFL_READ',   name:'TOEFL Reading',                   name_ar:'تويفل – قسم القراءة',             exam_type:'TOEFL',       module:'reading',   price:70,  icon:'fa-book-open',   color:'#ef4444', desc_ar:'استراتيجيات متقدمة للنصوص الأكاديمية وأنواع الأسئلة الـ 10.' },
  { code:'TOEFL_WRITE',  name:'TOEFL Writing',                   name_ar:'تويفل – قسم الكتابة',            exam_type:'TOEFL',       module:'writing',   price:70,  icon:'fa-pen-nib',     color:'#ef4444', desc_ar:'Integrated Task و Independent Task بنماذج عالية الدرجات.' },
  { code:'TOEFL_LISTEN', name:'TOEFL Listening',                 name_ar:'تويفل – قسم الاستماع',           exam_type:'TOEFL',       module:'listening', price:70,  icon:'fa-headphones',  color:'#ef4444', desc_ar:'محاضرات وحوارات أكاديمية مع تدريب على جميع أنواع الأسئلة.' },
  { code:'TOEFL_SPEAK',  name:'TOEFL Speaking',                  name_ar:'تويفل – قسم التحدث',             exam_type:'TOEFL',       module:'speaking',  price:70,  icon:'fa-microphone',  color:'#ef4444', desc_ar:'4 مهام تحدث مع تدريب على الوقت والتفصيل والنطق الصحيح.' },
  { code:'FOUNDATIONS',  name:'English Foundations',             name_ar:'مسار التأسيس اللغوي',             exam_type:'FOUNDATIONS', module:null,        price:150, icon:'fa-layer-group',  color:'#8b5cf6', desc_ar:'برنامج شامل لبناء قواعد اللغة الإنجليزية من الصفر للوصول لمستوى B2+.' },
  { code:'PRIVATE_VIP',  name:'Private VIP – 20 Hours',         name_ar:'المسار الخاص VIP – 20 ساعة',      exam_type:'PRIVATE',     module:null,        price:400, icon:'fa-crown',        color:'#f59e0b', desc_ar:'20 ساعة تدريب خاص مع المدرب مباشرة، مرونة في الجدول، تدريس مخصص 100% لاحتياجاتك.' },
]

// ==================== LAYOUT ====================
const L = (title: string, body: string, scripts = '') => `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title} - The Yamen Guide</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg"/>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet"/>
<style>
:root{--navy:#1a2b4a;--navy-dark:#0f1e35;--accent:#3b82f6;--gold:#f59e0b;--ielts:#0ea5e9;--toefl:#ef4444;--found:#8b5cf6;--vip:#f59e0b}
*{box-sizing:border-box}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#f8fafc;color:#1e293b}
.navbar{background:var(--navy);padding:0 1.5rem;display:flex;align-items:center;justify-content:space-between;height:64px;position:sticky;top:0;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,.2)}
.brand{color:#fff;font-size:1.2rem;font-weight:700;text-decoration:none;display:flex;align-items:center;gap:.5rem}
.brand .g{color:var(--gold)}
.card{background:#fff;border-radius:.75rem;padding:1.5rem;box-shadow:0 1px 3px rgba(0,0,0,.08);border:1px solid #e2e8f0}
.btn{padding:.6rem 1.4rem;border-radius:.5rem;font-weight:600;cursor:pointer;transition:all .2s;border:none;display:inline-flex;align-items:center;gap:.5rem;font-size:.9rem}
.btn-primary{background:var(--accent);color:#fff}.btn-primary:hover{background:#2563eb;transform:translateY(-1px);box-shadow:0 4px 12px rgba(59,130,246,.4)}
.btn-gold{background:var(--gold);color:#fff}.btn-gold:hover{background:#d97706}
.btn-success{background:#10b981;color:#fff}.btn-success:hover{background:#059669}
.btn-outline{background:#fff;color:var(--navy);border:2px solid #e2e8f0}.btn-outline:hover{border-color:var(--accent);color:var(--accent)}
.btn-wa{background:#25d366;color:#fff}.btn-wa:hover{background:#128c7e}
.sidebar{background:var(--navy);width:240px;min-height:calc(100vh - 64px);flex-shrink:0}
.sidebar a{display:flex;align-items:center;gap:.75rem;padding:.75rem 1.5rem;color:#94a3b8;text-decoration:none;transition:all .2s;font-size:.9rem}
.sidebar a:hover,.sidebar a.active{background:rgba(255,255,255,.1);color:#fff}
.sidebar a.active{border-right:3px solid var(--gold)}
.course-card{border:2px solid transparent;transition:all .25s;cursor:pointer;position:relative}
.course-card:hover{transform:translateY(-3px);box-shadow:0 8px 24px rgba(0,0,0,.12)}
.course-card.locked{opacity:.7;filter:grayscale(.6)}
.course-card.unlocked{border-color:currentColor}
.lock-badge{position:absolute;top:.75rem;left:.75rem;background:rgba(0,0,0,.5);color:#fff;border-radius:9999px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:.75rem}
.unlock-badge{position:absolute;top:.75rem;left:.75rem;background:#10b981;color:#fff;border-radius:9999px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:.75rem}
.hours-ring{position:relative;display:inline-flex;align-items:center;justify-content:center}
.price-tag{font-size:1.5rem;font-weight:800}
.badge{padding:.2rem .6rem;border-radius:9999px;font-size:.72rem;font-weight:700}
.badge-ielts{background:#dbeafe;color:#1e40af}
.badge-toefl{background:#fee2e2;color:#991b1b}
.badge-found{background:#ede9fe;color:#5b21b6}
.badge-vip{background:#fef3c7;color:#92400e}
.qr-box{border:3px solid;border-radius:.75rem;padding:1rem;text-align:center}
.input{width:100%;border:2px solid #e2e8f0;border-radius:.5rem;padding:.75rem 1rem;font-size:1rem;transition:border-color .2s;background:#fff}
.input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(59,130,246,.1)}
.tab-btn{padding:.5rem 1.25rem;border-radius:.5rem;font-weight:600;cursor:pointer;transition:all .2s;border:none;background:transparent;color:#64748b}
.tab-btn.active{background:var(--navy);color:#fff}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
.pulse{animation:pulse 2s infinite}
@media(max-width:768px){.sidebar{display:none}.sidebar.open{display:block;position:fixed;top:64px;left:0;bottom:0;z-index:99;width:240px}}
</style>
</head>
<body>${body}${scripts}</body>
</html>`

// ==================== AUTH ROUTES ====================
app.post('/api/auth/register', async (c) => {
  const { name, email, password } = await c.req.json()
  if (!name || !email || !password) return c.json({ error: 'جميع الحقول مطلوبة' }, 400)
  if (password.length < 6) return c.json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' }, 400)
  const ex = await c.env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first()
  if (ex) return c.json({ error: 'الإيميل مسجّل مسبقاً' }, 409)
  const hash = await hashPassword(password)
  const r = await c.env.DB.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)').bind(name, email, hash, 'student').run()
  const sid = await genId()
  const exp = new Date(Date.now() + 7*24*60*60*1000).toISOString()
  await c.env.DB.prepare('INSERT INTO auth_sessions (id,user_id,expires_at) VALUES (?,?,?)').bind(sid, r.meta.last_row_id, exp).run()
  setCookie(c, 'session_id', sid, { httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 604800, path: '/' })
  return c.json({ success: true, user: { name, email, role: 'student' } })
})

app.post('/api/auth/login', async (c) => {
  const { email, password } = await c.req.json()
  if (!email || !password) return c.json({ error: 'الإيميل وكلمة المرور مطلوبان' }, 400)
  const user: any = await c.env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first()
  if (!user) return c.json({ error: 'بيانات غير صحيحة' }, 401)
  const hash = await hashPassword(password)
  if (hash !== user.password_hash) return c.json({ error: 'بيانات غير صحيحة' }, 401)
  await c.env.DB.prepare("UPDATE users SET last_login=datetime('now') WHERE id=?").bind(user.id).run()
  const sid = await genId()
  const exp = new Date(Date.now() + 7*24*60*60*1000).toISOString()
  await c.env.DB.prepare('INSERT INTO auth_sessions (id,user_id,expires_at) VALUES (?,?,?)').bind(sid, user.id, exp).run()
  setCookie(c, 'session_id', sid, { httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 604800, path: '/' })
  return c.json({ success: true, user: { name: user.name, email: user.email, role: user.role } })
})

app.post('/api/auth/logout', async (c) => {
  const sid = getCookie(c, 'session_id')
  if (sid) await c.env.DB.prepare('DELETE FROM auth_sessions WHERE id=?').bind(sid).run()
  deleteCookie(c, 'session_id', { path: '/' })
  return c.json({ success: true })
})

app.get('/api/auth/me', async (c) => {
  const user = await getUser(c)
  return c.json({ user })
})

// ==================== COURSES API ====================
app.get('/api/courses', async (c) => {
  const courses = await c.env.DB.prepare('SELECT * FROM courses WHERE is_active=1 ORDER BY id').all()
  return c.json({ courses: courses.results })
})

// ==================== ENROLLMENTS API ====================
app.get('/api/my-courses', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  const enrollments = await c.env.DB.prepare(
    `SELECT e.*,co.code,co.name,co.name_ar,co.exam_type,co.module,co.color,co.icon,co.price,
     ph.total_hours,ph.used_hours,ph.remaining_hours
     FROM enrollments e
     JOIN courses co ON e.course_id=co.id
     LEFT JOIN private_hours ph ON ph.enrollment_id=e.id
     WHERE e.user_id=? AND e.is_active=1`
  ).bind(user.user_id).all()
  return c.json({ enrollments: enrollments.results })
})

// ==================== ACTIVATION API ====================
app.post('/api/activate', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  const { code } = await c.req.json()
  if (!code) return c.json({ error: 'الكود مطلوب' }, 400)

  const activation: any = await c.env.DB.prepare(
    `SELECT ac.*,co.name_ar,co.exam_type,co.module,co.id as cid,co.code as course_code
     FROM activation_codes ac JOIN courses co ON ac.course_id=co.id
     WHERE ac.code=? AND ac.is_used=0`
  ).bind(code.trim().toUpperCase()).first()

  if (!activation) return c.json({ error: 'الكود غير صحيح أو تم استخدامه مسبقاً' }, 404)

  // Check if already enrolled
  const existing = await c.env.DB.prepare(
    'SELECT id FROM enrollments WHERE user_id=? AND course_id=?'
  ).bind(user.user_id, activation.cid).first()
  if (existing) return c.json({ error: 'أنت مسجّل في هذا المسار مسبقاً' }, 409)

  // Mark code as used
  await c.env.DB.prepare(
    "UPDATE activation_codes SET is_used=1,used_by=?,used_at=datetime('now') WHERE id=?"
  ).bind(user.user_id, activation.id).run()

  // Create enrollment
  const exp = new Date(Date.now() + 365*24*60*60*1000).toISOString()
  const enr = await c.env.DB.prepare(
    'INSERT INTO enrollments (user_id,course_id,activation_code_id,expires_at) VALUES (?,?,?,?)'
  ).bind(user.user_id, activation.cid, activation.id, exp).run()

  // If private VIP, create hours record
  if (activation.course_code === 'PRIVATE_VIP') {
    await c.env.DB.prepare(
      'INSERT INTO private_hours (user_id,enrollment_id,total_hours,used_hours,remaining_hours) VALUES (?,?,20,0,20)'
    ).bind(user.user_id, enr.meta.last_row_id).run()
  }

  return c.json({
    success: true,
    course_name: activation.name_ar,
    welcome_message: getWelcomeMessage(activation.course_code || '', activation.name_ar)
  })
})

function getWelcomeMessage(courseCode: string, courseName: string): string {
  const msgs: Record<string, string> = {
    IELTS_FULL: `🎉 أهلاً بك في مسار الأيلتس الكامل!\n\nلقد تم تفعيل وصولك إلى جميع أقسام الأيلتس.\n\n📌 كيف تبدأ:\n1️⃣ اذهب إلى لوحة التحكم وستجد جميع الأقسام مفتوحة\n2️⃣ ابدأ بقسم Reading ثم Listening\n3️⃣ لكل قسم اختبارات تدريبية مع تغذية راجعة فورية\n4️⃣ تواصل مع المدرب عبر الواتساب للجدولة\n\n🎯 هدفنا معك: Band 7+`,
    IELTS_READ: `🎉 تم تفعيل مسار IELTS Reading!\n\n📌 ابدأ الآن:\n1️⃣ افتح قسم Reading من لوحة التحكم\n2️⃣ حل اختبارات تدريبية مع التوقيت\n3️⃣ راجع الأخطاء وتعلم من الشرح`,
    IELTS_WRITE: `🎉 تم تفعيل مسار IELTS Writing!\n\n📌 ابدأ الآن:\n1️⃣ Task 1: وصف الرسوم البيانية\n2️⃣ Task 2: كتابة المقالات\n3️⃣ أرسل إجاباتك للمدرب للتصحيح`,
    IELTS_LISTEN: `🎉 تم تفعيل مسار IELTS Listening!\n\n📌 ابدأ الآن:\n1️⃣ تدرب على الأقسام الأربعة بالترتيب\n2️⃣ استخدم الاستراتيجيات المُعطاة\n3️⃣ راجع الأخطاء فوراً بعد كل اختبار`,
    IELTS_SPEAK: `🎉 تم تفعيل مسار IELTS Speaking!\n\n📌 ابدأ الآن:\n1️⃣ Part 1: أسئلة شخصية\n2️⃣ Part 2: Long Turn\n3️⃣ Part 3: نقاش\n4️⃣ سجّل نفسك وأرسل للمدرب للتقييم`,
    TOEFL_FULL: `🎉 أهلاً بك في مسار التوفل الكامل!\n\n📌 كيف تبدأ:\n1️⃣ ابدأ بقسم Reading لبناء الأساس\n2️⃣ انتقل لـ Listening ثم Speaking ثم Writing\n3️⃣ حل اختبارات كاملة محاكاة للاختبار الحقيقي\n\n🎯 هدفنا معك: Score 100+`,
    TOEFL_READ: `🎉 تم تفعيل TOEFL Reading!\n\n📌 ابدأ بـ:\n1️⃣ استراتيجيات القراءة السريعة\n2️⃣ أنواع الأسئلة الـ 10\n3️⃣ تدرّب على نصوص أكاديمية حقيقية`,
    TOEFL_WRITE: `🎉 تم تفعيل TOEFL Writing!\n\n📌 ابدأ بـ:\n1️⃣ Integrated Task: ربط القراءة بالمحاضرة\n2️⃣ Independent Task: الكتابة الحرة\n3️⃣ نماذج بدرجات 4/5 مع الشرح`,
    TOEFL_LISTEN: `🎉 تم تفعيل TOEFL Listening!\n\n📌 ابدأ بـ:\n1️⃣ محاضرات أكاديمية\n2️⃣ حوارات مكتبية وصفية\n3️⃣ تدرب على أخذ الملاحظات`,
    TOEFL_SPEAK: `🎉 تم تفعيل TOEFL Speaking!\n\n📌 المهام الـ 4:\n1️⃣ Task 1: Independent\n2️⃣ Tasks 2-4: Integrated\n3️⃣ تدرب على الـ Template لكل مهمة`,
    FOUNDATIONS: `🎉 أهلاً بك في مسار التأسيس اللغوي!\n\n📌 مسارك:\n1️⃣ Grammar & Vocabulary الأساسية\n2️⃣ Reading & Comprehension\n3️⃣ Basic Writing Skills\n4️⃣ Conversation Basics\n\n🎯 من المستوى A2 إلى B2+`,
    PRIVATE_VIP: `👑 أهلاً بك في المسار الخاص VIP!\n\n✅ لديك 20 ساعة تدريب خاص مع المدرب\n\n📌 الخطوات التالية:\n1️⃣ تواصل مع المدرب على الواتساب لتحديد الجدول\n2️⃣ ستظهر لك ساعاتك في لوحة التحكم\n3️⃣ يتم خصم كل حصة بعد انتهائها\n\n📞 واتساب المدرب: 0798919150`,
  }
  return msgs[courseCode] || `🎉 تم تفعيل ${courseName} بنجاح! اذهب إلى لوحة التحكم لتبدأ.`
}

// ==================== PAYMENT REQUEST API ====================
app.post('/api/payment-request', async (c) => {
  const user = await getUser(c)
  const { course_code, payment_method } = await c.req.json()
  const course: any = await c.env.DB.prepare('SELECT * FROM courses WHERE code=?').bind(course_code).first()
  if (!course) return c.json({ error: 'Course not found' }, 404)
  const uid = user ? user.user_id : null
  await c.env.DB.prepare('INSERT INTO payment_requests (user_id,course_id,amount,payment_method) VALUES (?,?,?,?)').bind(uid, course.id, course.price, payment_method).run()
  return c.json({ success: true })
})

// ==================== ADMIN: GENERATE CODE ====================
app.post('/api/admin/generate-code', async (c) => {
  const user = await getUser(c)
  if (!user || user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403)
  const { course_code, notes } = await c.req.json()
  const course: any = await c.env.DB.prepare('SELECT id FROM courses WHERE code=?').bind(course_code).first()
  if (!course) return c.json({ error: 'Course not found' }, 404)
  const code = await genCode()
  await c.env.DB.prepare('INSERT INTO activation_codes (code,course_id,created_by,notes) VALUES (?,?,?,?)').bind(code, course.id, user.user_id, notes || '').run()
  return c.json({ success: true, code })
})

app.get('/api/admin/codes', async (c) => {
  const user = await getUser(c)
  if (!user || user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403)
  const codes = await c.env.DB.prepare(
    `SELECT ac.*,co.name_ar,co.price,u.name as used_by_name FROM activation_codes ac
     JOIN courses co ON ac.course_id=co.id
     LEFT JOIN users u ON ac.used_by=u.id
     ORDER BY ac.created_at DESC LIMIT 100`
  ).all()
  return c.json({ codes: codes.results })
})

app.get('/api/admin/enrollments', async (c) => {
  const user = await getUser(c)
  if (!user || user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403)
  const data = await c.env.DB.prepare(
    `SELECT e.*,u.name as student_name,u.email,co.name_ar,co.price,
     ph.total_hours,ph.used_hours,ph.remaining_hours
     FROM enrollments e JOIN users u ON e.user_id=u.id
     JOIN courses co ON e.course_id=co.id
     LEFT JOIN private_hours ph ON ph.enrollment_id=e.id
     ORDER BY e.activated_at DESC`
  ).all()
  return c.json({ enrollments: data.results })
})

app.post('/api/admin/log-hours', async (c) => {
  const user = await getUser(c)
  if (!user || user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403)
  const { user_id, hours, notes } = await c.req.json()
  const ph: any = await c.env.DB.prepare('SELECT * FROM private_hours WHERE user_id=?').bind(user_id).first()
  if (!ph) return c.json({ error: 'No private hours record found' }, 404)
  const newUsed = ph.used_hours + hours
  const newRemaining = Math.max(0, ph.remaining_hours - hours)
  await c.env.DB.prepare("UPDATE private_hours SET used_hours=?,remaining_hours=?,last_session_at=datetime('now') WHERE id=?").bind(newUsed, newRemaining, ph.id).run()
  await c.env.DB.prepare("INSERT INTO hours_sessions (user_id,private_hours_id,hours_used,notes,logged_by) VALUES (?,?,?,?,?)").bind(user_id, ph.id, hours, notes || '', user.user_id).run()
  return c.json({ success: true, remaining: newRemaining })
})

app.get('/api/admin/stats', async (c) => {
  const user = await getUser(c)
  if (!user || user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403)
  const [students, enrollments, codes, payments] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as n FROM users WHERE role='student'").first() as any,
    c.env.DB.prepare("SELECT COUNT(*) as n FROM enrollments WHERE is_active=1").first() as any,
    c.env.DB.prepare("SELECT COUNT(*) as n FROM activation_codes WHERE is_used=0").first() as any,
    c.env.DB.prepare("SELECT COUNT(*) as n FROM payment_requests").first() as any,
  ])
  const breakdown = await c.env.DB.prepare("SELECT co.name_ar,COUNT(e.id) as cnt FROM enrollments e JOIN courses co ON e.course_id=co.id GROUP BY co.id ORDER BY cnt DESC").all()
  return c.json({ students: students?.n||0, enrollments: enrollments?.n||0, unused_codes: codes?.n||0, payment_requests: payments?.n||0, breakdown: breakdown.results })
})

app.get('/api/admin/users', async (c) => {
  const user = await getUser(c)
  if (!user || user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403)
  const users = await c.env.DB.prepare(
    `SELECT u.*,COUNT(e.id) as enrollments FROM users u LEFT JOIN enrollments e ON u.id=e.user_id GROUP BY u.id ORDER BY u.created_at DESC`
  ).all()
  return c.json({ users: users.results })
})

// ==================== SETUP ====================
app.get('/api/setup', async (c) => {
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'student', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_login DATETIME)"),
      c.env.DB.prepare("CREATE TABLE IF NOT EXISTS practice_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, exam_type TEXT NOT NULL, module TEXT NOT NULL, score REAL, max_score REAL, time_taken INTEGER, completed INTEGER DEFAULT 0, started_at DATETIME DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME)"),
      c.env.DB.prepare("CREATE TABLE IF NOT EXISTS questions (id INTEGER PRIMARY KEY AUTOINCREMENT, exam_type TEXT NOT NULL, module TEXT NOT NULL, question_type TEXT NOT NULL, difficulty TEXT NOT NULL DEFAULT 'medium', title TEXT NOT NULL, content TEXT NOT NULL, passage TEXT, options TEXT, correct_answer TEXT, explanation TEXT, time_limit INTEGER, points REAL DEFAULT 1.0, is_active INTEGER DEFAULT 1, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"),
      c.env.DB.prepare("CREATE TABLE IF NOT EXISTS session_answers (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL, question_id INTEGER NOT NULL, user_answer TEXT, is_correct INTEGER, points_earned REAL DEFAULT 0, time_spent INTEGER, answered_at DATETIME DEFAULT CURRENT_TIMESTAMP)"),
      c.env.DB.prepare("CREATE TABLE IF NOT EXISTS auth_sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at DATETIME NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"),
      c.env.DB.prepare("CREATE TABLE IF NOT EXISTS courses (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, name_ar TEXT NOT NULL, exam_type TEXT, module TEXT, price REAL NOT NULL, original_price REAL, description TEXT, description_ar TEXT, hours INTEGER, is_active INTEGER DEFAULT 1, color TEXT DEFAULT '#3b82f6', icon TEXT DEFAULT 'fa-graduation-cap', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"),
      c.env.DB.prepare("CREATE TABLE IF NOT EXISTS activation_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, course_id INTEGER NOT NULL, created_by INTEGER, used_by INTEGER, used_at DATETIME, expires_at DATETIME, is_used INTEGER DEFAULT 0, notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"),
      c.env.DB.prepare("CREATE TABLE IF NOT EXISTS enrollments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, course_id INTEGER NOT NULL, activation_code_id INTEGER, activated_at DATETIME DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME, is_active INTEGER DEFAULT 1, welcome_shown INTEGER DEFAULT 0)"),
      c.env.DB.prepare("CREATE TABLE IF NOT EXISTS private_hours (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, enrollment_id INTEGER NOT NULL, total_hours INTEGER DEFAULT 20, used_hours REAL DEFAULT 0, remaining_hours REAL DEFAULT 20, last_session_at DATETIME)"),
      c.env.DB.prepare("CREATE TABLE IF NOT EXISTS hours_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, private_hours_id INTEGER NOT NULL, hours_used REAL NOT NULL, session_date DATETIME DEFAULT CURRENT_TIMESTAMP, notes TEXT, logged_by INTEGER)"),
      c.env.DB.prepare("CREATE TABLE IF NOT EXISTS payment_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, course_id INTEGER NOT NULL, amount REAL NOT NULL, payment_method TEXT, status TEXT DEFAULT 'pending', whatsapp_sent INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"),
    ])
    // Seed admin (only if no admin exists)
    const existAdmin: any = await c.env.DB.prepare("SELECT COUNT(*) as n FROM users WHERE role='admin'").first()
    if (!existAdmin || existAdmin.n === 0) {
      const ah = await hashPassword('Admin@123')
      await c.env.DB.prepare("INSERT OR IGNORE INTO users (email,name,password_hash,role) VALUES (?,?,?,'admin')").bind('admin@prepmaster.edu','Admin User',ah).run()
    }
    // Seed courses
    for (const course of COURSES) {
      await c.env.DB.prepare("INSERT OR IGNORE INTO courses (code,name,name_ar,exam_type,module,price,description_ar,icon,color) VALUES (?,?,?,?,?,?,?,?,?)").bind(course.code, course.name, course.name_ar, course.exam_type, course.module, course.price, course.desc_ar, course.icon, course.color).run()
    }
    return c.json({ success: true, message: 'Database initialized!' })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// Questions routes (kept from original)
app.get('/api/questions', async (c) => {
  const user = await getUser(c); if (!user) return c.json({ error: 'Unauthorized' }, 401)
  const { exam_type, module } = c.req.query()
  const qs = await c.env.DB.prepare('SELECT id,title,content,passage,options,question_type,difficulty,time_limit,points FROM questions WHERE exam_type=? AND module=? AND is_active=1 LIMIT 10').bind(exam_type||'TOEFL', module||'reading').all()
  return c.json({ questions: qs.results })
})
app.post('/api/sessions/start', async (c) => {
  const user = await getUser(c); if (!user) return c.json({ error: 'Unauthorized' }, 401)
  const { exam_type, module } = await c.req.json()
  const r = await c.env.DB.prepare("INSERT INTO practice_sessions (user_id,exam_type,module) VALUES (?,?,?)").bind(user.user_id, exam_type, module).run()
  return c.json({ session_id: r.meta.last_row_id })
})
app.post('/api/sessions/:id/answer', async (c) => {
  const user = await getUser(c); if (!user) return c.json({ error: 'Unauthorized' }, 401)
  const { question_id, answer, time_spent } = await c.req.json()
  const q: any = await c.env.DB.prepare('SELECT * FROM questions WHERE id=?').bind(question_id).first()
  if (!q) return c.json({ error: 'Not found' }, 404)
  const isCorrect = q.correct_answer ? (answer === q.correct_answer ? 1 : 0) : null
  const pts = isCorrect ? (q.points||1) : 0
  await c.env.DB.prepare('INSERT INTO session_answers (session_id,question_id,user_answer,is_correct,points_earned,time_spent) VALUES (?,?,?,?,?,?)').bind(c.req.param('id'), question_id, answer, isCorrect, pts, time_spent).run()
  return c.json({ is_correct: isCorrect, points_earned: pts, correct_answer: q.correct_answer, explanation: q.explanation })
})
app.post('/api/sessions/:id/complete', async (c) => {
  const user = await getUser(c); if (!user) return c.json({ error: 'Unauthorized' }, 401)
  const { time_taken } = await c.req.json()
  const ans: any = await c.env.DB.prepare('SELECT SUM(points_earned) as s FROM session_answers WHERE session_id=?').bind(c.req.param('id')).first()
  const mx: any = await c.env.DB.prepare('SELECT SUM(q.points) as s FROM session_answers sa JOIN questions q ON sa.question_id=q.id WHERE sa.session_id=?').bind(c.req.param('id')).first()
  await c.env.DB.prepare("UPDATE practice_sessions SET score=?,max_score=?,time_taken=?,completed=1,completed_at=datetime('now') WHERE id=?").bind(ans?.s||0, mx?.s||0, time_taken, c.req.param('id')).run()
  return c.json({ success: true, score: ans?.s||0, max_score: mx?.s||0 })
})
app.get('/api/dashboard/stats', async (c) => {
  const user = await getUser(c); if (!user) return c.json({ error: 'Unauthorized' }, 401)
  const [tot, avg, rec] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as n FROM practice_sessions WHERE user_id=? AND completed=1").bind(user.user_id).first() as any,
    c.env.DB.prepare("SELECT AVG(CASE WHEN max_score>0 THEN (score/max_score)*100 ELSE 0 END) as a FROM practice_sessions WHERE user_id=? AND completed=1").bind(user.user_id).first() as any,
    c.env.DB.prepare("SELECT exam_type,module,score,max_score,completed_at FROM practice_sessions WHERE user_id=? AND completed=1 ORDER BY completed_at DESC LIMIT 5").bind(user.user_id).all(),
  ])
  return c.json({ total_sessions: tot?.n||0, avg_score: Math.round(avg?.a||0), recent_sessions: rec.results })
})

// ==================== ADMIN: CREATE REAL ADMIN ====================
app.post('/api/admin/create-admin', async (c) => {
  const user = await getUser(c)
  if (!user || user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403)
  const { name, email, password } = await c.req.json()
  if (!name || !email || !password) return c.json({ error: 'جميع الحقول مطلوبة' }, 400)
  if (password.length < 8) return c.json({ error: 'كلمة المرور 8 أحرف على الأقل' }, 400)
  const ex = await c.env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first()
  if (ex) return c.json({ error: 'الإيميل مسجّل مسبقاً' }, 409)
  const hash = await hashPassword(password)
  await c.env.DB.prepare("INSERT INTO users (email,name,password_hash,role) VALUES (?,?,?,'admin')").bind(email, name, hash).run()
  return c.json({ success: true, message: 'تم إنشاء حساب الأدمن بنجاح' })
})

// ==================== ADMIN: CHANGE PASSWORD ====================
app.post('/api/admin/change-password', async (c) => {
  const user = await getUser(c)
  if (!user || user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403)
  const { target_user_id, new_password } = await c.req.json()
  if (!target_user_id || !new_password) return c.json({ error: 'البيانات مطلوبة' }, 400)
  if (new_password.length < 6) return c.json({ error: 'كلمة المرور 6 أحرف على الأقل' }, 400)
  const hash = await hashPassword(new_password)
  await c.env.DB.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(hash, target_user_id).run()
  return c.json({ success: true })
})

// ==================== ADMIN: PAYMENT REQUESTS ====================
app.get('/api/admin/payment-requests', async (c) => {
  const user = await getUser(c)
  if (!user || user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403)
  const data = await c.env.DB.prepare(
    `SELECT pr.*,u.name as student_name,u.email,co.name_ar,co.price
     FROM payment_requests pr
     LEFT JOIN users u ON pr.user_id=u.id
     JOIN courses co ON pr.course_id=co.id
     ORDER BY pr.created_at DESC LIMIT 50`
  ).all()
  return c.json({ requests: data.results })
})

app.post('/api/admin/payment-requests/:id/approve', async (c) => {
  const user = await getUser(c)
  if (!user || user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403)
  await c.env.DB.prepare("UPDATE payment_requests SET status='approved' WHERE id=?").bind(c.req.param('id')).run()
  return c.json({ success: true })
})

// Admin questions
app.post('/api/admin/questions', async (c) => {
  const user = await getUser(c); if (!user||user.role!=='admin') return c.json({ error: 'Forbidden' }, 403)
  const b = await c.req.json()
  const r = await c.env.DB.prepare("INSERT INTO questions (exam_type,module,question_type,difficulty,title,content,passage,options,correct_answer,explanation,time_limit,points,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(b.exam_type,b.module,b.question_type||'multiple_choice',b.difficulty||'medium',b.title,b.content,b.passage||null,b.options?JSON.stringify(b.options):null,b.correct_answer||null,b.explanation||null,b.time_limit||600,b.points||1.0,user.user_id).run()
  return c.json({ success: true, id: r.meta.last_row_id })
})
app.get('/api/admin/questions', async (c) => {
  const user = await getUser(c); if (!user||user.role!=='admin') return c.json({ error: 'Forbidden' }, 403)
  const qs = await c.env.DB.prepare('SELECT id,exam_type,module,question_type,difficulty,title,is_active,created_at FROM questions ORDER BY created_at DESC').all()
  return c.json({ questions: qs.results })
})
app.delete('/api/admin/questions/:id', async (c) => {
  const user = await getUser(c); if (!user||user.role!=='admin') return c.json({ error: 'Forbidden' }, 403)
  await c.env.DB.prepare('UPDATE questions SET is_active=0 WHERE id=?').bind(c.req.param('id')).run()
  return c.json({ success: true })
})

// ==================== FAVICON ====================
app.get('/favicon.svg', (c) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#1a2b4a"/><text x="16" y="22" font-size="18" text-anchor="middle" fill="#f59e0b" font-family="Arial" font-weight="bold">Y</text></svg>'
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public,max-age=86400' } })
})

// ==================== PAGES ====================

// LOGIN
app.get('/login', (c) => c.html(L('تسجيل الدخول', `
<div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0f1e35] to-[#1a2b4a] p-4">
  <div class="w-full max-w-md">
    <div class="text-center mb-8">
      <div class="inline-flex items-center justify-center w-16 h-16 bg-[#f59e0b] rounded-2xl mb-4 shadow-lg">
        <i class="fas fa-graduation-cap text-white text-2xl"></i>
      </div>
      <h1 class="text-3xl font-bold text-white">The Yamen Guide</h1>
      <p class="text-[#94a3b8] mt-1">منصة التحضير لـ IELTS & TOEFL iBT</p>
    </div>
    <div class="card">
      <div class="flex mb-6 bg-[#f1f5f9] rounded-lg p-1">
        <button id="loginTab" onclick="switchTab('login')" class="flex-1 py-2 rounded-md font-semibold text-sm transition-all bg-white text-[#1a2b4a] shadow-sm">تسجيل الدخول</button>
        <button id="regTab" onclick="switchTab('reg')" class="flex-1 py-2 rounded-md font-semibold text-sm transition-all text-[#94a3b8]">حساب جديد</button>
      </div>
      <div id="loginForm" class="space-y-4">
        <div><label class="block text-sm font-semibold text-[#475569] mb-1">البريد الإلكتروني</label>
          <input id="lEmail" type="email" class="input" placeholder="example@email.com"/></div>
        <div><label class="block text-sm font-semibold text-[#475569] mb-1">كلمة المرور</label>
          <div class="relative"><input id="lPass" type="password" class="input" placeholder="••••••••"/>
          <button onclick="tp('lPass')" class="absolute left-3 top-3.5 text-[#94a3b8]"><i class="fas fa-eye text-sm"></i></button></div></div>
        <div id="lErr" class="hidden text-red-600 text-sm bg-red-50 p-3 rounded-lg"></div>
        <button onclick="doLogin()" class="btn btn-primary w-full justify-center py-3 text-base"><i class="fas fa-sign-in-alt"></i> دخول</button>
      </div>
      <div id="regForm" class="hidden space-y-4">
        <div><label class="block text-sm font-semibold text-[#475569] mb-1">الاسم الكامل</label>
          <input id="rName" type="text" class="input" placeholder="محمد أحمد"/></div>
        <div><label class="block text-sm font-semibold text-[#475569] mb-1">البريد الإلكتروني</label>
          <input id="rEmail" type="email" class="input" placeholder="example@email.com"/></div>
        <div><label class="block text-sm font-semibold text-[#475569] mb-1">كلمة المرور</label>
          <input id="rPass" type="password" class="input" placeholder="6 أحرف على الأقل"/></div>
        <div id="rErr" class="hidden text-red-600 text-sm bg-red-50 p-3 rounded-lg"></div>
        <button onclick="doReg()" class="btn btn-primary w-full justify-center py-3 text-base"><i class="fas fa-user-plus"></i> إنشاء الحساب</button>
      </div>
      <div class="mt-4 p-3 bg-[#fff8f0] border border-[#fde68a] rounded-lg text-sm text-[#475569]">
        <p class="text-[#92400e]">هل تواجه مشكلة بالدخول؟ تواصل مع الدعم الفني</p>
        <a href="https://wa.me/962798919150" target="_blank" class="flex items-center gap-2 mt-2 font-bold text-[#25d366] hover:underline">
          <i class="fab fa-whatsapp text-lg"></i> واتساب: 0798919150
        </a>
      </div>
    </div>
  </div>
</div>`, `<script>
function switchTab(t){
  document.getElementById('loginForm').classList.toggle('hidden',t!=='login');
  document.getElementById('regForm').classList.toggle('hidden',t!=='reg');
  document.getElementById('loginTab').className='flex-1 py-2 rounded-md font-semibold text-sm transition-all '+(t==='login'?'bg-white text-[#1a2b4a] shadow-sm':'text-[#94a3b8]');
  document.getElementById('regTab').className='flex-1 py-2 rounded-md font-semibold text-sm transition-all '+(t==='reg'?'bg-white text-[#1a2b4a] shadow-sm':'text-[#94a3b8]');
}
function tp(id){const e=document.getElementById(id);e.type=e.type==='password'?'text':'password'}
async function doLogin(){
  const email=document.getElementById('lEmail').value,password=document.getElementById('lPass').value,err=document.getElementById('lErr');
  err.classList.add('hidden');
  try{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  const d=await r.json();
  if(d.success){window.location.href=d.user.role==='admin'?'/admin':'/dashboard';}
  else{err.textContent=d.error;err.classList.remove('hidden');}}catch(e){err.textContent='خطأ في الاتصال';err.classList.remove('hidden');}
}
async function doReg(){
  const name=document.getElementById('rName').value,email=document.getElementById('rEmail').value,password=document.getElementById('rPass').value,err=document.getElementById('rErr');
  err.classList.add('hidden');
  try{const r=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email,password})});
  const d=await r.json();
  if(d.success){window.location.href='/dashboard';}
  else{err.textContent=d.error;err.classList.remove('hidden');}}catch(e){err.textContent='خطأ في الاتصال';err.classList.remove('hidden');}
}
document.addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
fetch('/api/auth/me').then(r=>r.json()).then(d=>{if(d.user)window.location.href=d.user.role==='admin'?'/admin':'/dashboard';});
</script>`)))

// DASHBOARD
app.get('/dashboard', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  return c.html(L('لوحة التحكم', `
<nav class="navbar">
  <a href="/dashboard" class="brand"><i class="fas fa-graduation-cap text-[#f59e0b]"></i> The Yamen <span class="g">Guide</span></a>
  <div class="flex items-center gap-3">
    <button onclick="document.getElementById('sidebar').classList.toggle('open')" class="md:hidden text-white text-xl"><i class="fas fa-bars"></i></button>
    <span class="text-[#94a3b8] text-sm hidden sm:block"><i class="fas fa-user-circle mr-1"></i>${user.name}</span>
    <button onclick="logout()" class="btn btn-outline text-sm py-2 px-3"><i class="fas fa-sign-out-alt"></i></button>
  </div>
</nav>
<div class="flex">
  <aside class="sidebar" id="sidebar">
    <nav class="py-4">
      <a href="/dashboard" class="active"><i class="fas fa-home w-5"></i> الرئيسية</a>
      <a href="/courses"><i class="fas fa-layer-group w-5"></i> المسارات والأسعار</a>
      <a href="/books"><i class="fas fa-book w-5 text-[#f59e0b]"></i> الكتب المعتمدة</a>
      <a href="/practice"><i class="fas fa-play-circle w-5"></i> الاختبارات التدريبية</a>
      <a href="/activate"><i class="fas fa-key w-5"></i> تفعيل مسار</a>
      <div class="px-6 py-2 mt-3 mb-1 text-xs uppercase tracking-wider text-[#475569] font-semibold">دعم</div>
      <a href="https://wa.me/962798919150" target="_blank"><i class="fab fa-whatsapp w-5 text-[#25d366]"></i> تواصل معنا</a>
    </nav>
  </aside>
  <main class="flex-1 p-4 md:p-6 overflow-y-auto">
    <div class="max-w-5xl mx-auto">
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-[#1a2b4a]">أهلاً، ${user.name.split(' ')[0]}! 👋</h1>
        <p class="text-[#475569] mt-1">مرحباً بك في منصة The Yamen Guide</p>
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div class="card border-r-4 border-[#3b82f6]"><div class="text-2xl font-bold text-[#1a2b4a]" id="dSessions">-</div><div class="text-sm text-[#475569] mt-1">اختبارات مكتملة</div></div>
        <div class="card border-r-4 border-[#f59e0b]"><div class="text-2xl font-bold text-[#1a2b4a]" id="dAvg">-</div><div class="text-sm text-[#475569] mt-1">متوسط الدرجات</div></div>
        <div class="card border-r-4 border-[#10b981]"><div class="text-2xl font-bold text-[#1a2b4a]" id="dCourses">-</div><div class="text-sm text-[#475569] mt-1">مساراتي المفعّلة</div></div>
        <div class="card border-r-4 border-[#8b5cf6]"><div class="text-2xl font-bold text-[#1a2b4a]" id="dHours">—</div><div class="text-sm text-[#475569] mt-1">ساعات VIP</div></div>
      </div>

      <!-- My Courses -->
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold text-[#1a2b4a]">مساراتي</h2>
        <a href="/activate" class="btn btn-primary text-sm"><i class="fas fa-key"></i> تفعيل مسار جديد</a>
      </div>
      <div id="myCoursesGrid" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
        <div class="col-span-full text-center py-10 text-[#94a3b8]">
          <div class="w-12 h-12 border-4 border-[#3b82f6] border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p>جارٍ التحميل...</p>
        </div>
      </div>

      <!-- All Tracks Preview -->
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold text-[#1a2b4a]">جميع المسارات المتاحة</h2>
        <a href="/courses" class="btn btn-outline text-sm">عرض الأسعار <i class="fas fa-arrow-left"></i></a>
      </div>
      <div id="allCoursesGrid" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8"></div>

      <!-- Quick Actions -->
      <div class="grid md:grid-cols-2 gap-4">
        <div class="card bg-gradient-to-l from-[#0ea5e9] to-[#0284c7] text-white cursor-pointer hover:shadow-lg transition-shadow" onclick="window.location='/practice?type=IELTS'">
          <div class="flex items-center gap-4">
            <div class="w-14 h-14 rounded-xl bg-white/20 flex items-center justify-center text-2xl">🎯</div>
            <div><h3 class="font-bold text-lg">تدريب IELTS</h3><p class="text-blue-100 text-sm mt-1">ابدأ اختباراً تدريبياً الآن</p></div>
          </div>
        </div>
        <div class="card bg-gradient-to-l from-[#ef4444] to-[#dc2626] text-white cursor-pointer hover:shadow-lg transition-shadow" onclick="window.location='/practice?type=TOEFL'">
          <div class="flex items-center gap-4">
            <div class="w-14 h-14 rounded-xl bg-white/20 flex items-center justify-center text-2xl">📝</div>
            <div><h3 class="font-bold text-lg">تدريب TOEFL</h3><p class="text-red-100 text-sm mt-1">ابدأ اختباراً تدريبياً الآن</p></div>
          </div>
        </div>
      </div>
    </div>
  </main>
</div>
<!-- Welcome Modal -->
<div id="welcomeModal" class="hidden fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
  <div class="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
    <div class="text-center mb-4"><div class="text-5xl mb-3" id="welcomeEmoji">🎉</div>
      <h2 class="text-xl font-bold text-[#1a2b4a]" id="welcomeTitle">تم التفعيل!</h2></div>
    <div class="bg-[#f8fafc] rounded-xl p-4 text-sm text-[#475569] whitespace-pre-line leading-relaxed" id="welcomeMsg"></div>
    <button onclick="closeWelcome()" class="btn btn-primary w-full justify-center mt-4 py-3">ابدأ الآن <i class="fas fa-arrow-left"></i></button>
  </div>
</div>`, `<script>
async function logout(){await fetch('/api/auth/logout',{method:'POST'});window.location.href='/login';}

const courseColors={IELTS_FULL:'#0ea5e9',IELTS_READ:'#0ea5e9',IELTS_WRITE:'#0ea5e9',IELTS_LISTEN:'#0ea5e9',IELTS_SPEAK:'#0ea5e9',TOEFL_FULL:'#ef4444',TOEFL_READ:'#ef4444',TOEFL_WRITE:'#ef4444',TOEFL_LISTEN:'#ef4444',TOEFL_SPEAK:'#ef4444',FOUNDATIONS:'#8b5cf6',PRIVATE_VIP:'#f59e0b'};
const examLabels={IELTS:'IELTS',TOEFL:'TOEFL iBT',FOUNDATIONS:'تأسيس',PRIVATE:'VIP'};

async function loadDashboard(){
  const [statsR, myCoursesR, allCoursesR] = await Promise.all([
    fetch('/api/dashboard/stats'),fetch('/api/my-courses'),fetch('/api/courses')
  ]);
  const stats=await statsR.json(), myCourses=await myCoursesR.json(), allCourses=await allCoursesR.json();

  document.getElementById('dSessions').textContent=stats.total_sessions||0;
  document.getElementById('dAvg').textContent=(stats.avg_score||0)+'%';
  document.getElementById('dCourses').textContent=(myCourses.enrollments||[]).length;

  // Private hours
  const vip=(myCourses.enrollments||[]).find(e=>e.code==='PRIVATE_VIP');
  document.getElementById('dHours').textContent=vip?vip.remaining_hours+'h':'—';

  // My Courses Grid
  const enrolled=myCourses.enrollments||[];
  const enrolledCodes=new Set(enrolled.map(e=>e.code));
  const grid=document.getElementById('myCoursesGrid');

  if(enrolled.length===0){
    grid.innerHTML='<div class="col-span-full card text-center py-10"><i class="fas fa-lock text-4xl text-[#94a3b8] mb-3"></i><p class="text-[#475569] font-semibold">لا توجد مسارات مفعّلة بعد</p><p class="text-sm text-[#94a3b8] mt-1">اشترِ كوداً وفعّل مسارك</p><div class="flex gap-3 justify-center mt-4"><a href="/courses" class="btn btn-outline text-sm">عرض الأسعار</a><a href="/activate" class="btn btn-primary text-sm"><i class="fas fa-key"></i> تفعيل</a></div></div>';
  } else {
    grid.innerHTML=enrolled.map(e=>{
      const col=e.color||'#3b82f6';
      const hoursHtml=e.total_hours?'<div class="mt-3 pt-3 border-t border-gray-100"><div class="flex justify-between text-xs mb-1"><span class="text-[#94a3b8]">الساعات المتبقية</span><span class="font-bold" style="color:'+col+'">'+e.remaining_hours+'/'+e.total_hours+'</span></div><div class="w-full bg-gray-100 rounded-full h-2"><div class="h-2 rounded-full" style="width:'+(e.remaining_hours/e.total_hours*100)+'%;background:'+col+'"></div></div></div>':'';
      return '<div class="card course-card unlocked" style="border-color:'+col+';color:'+col+'"><div class="unlock-badge"><i class="fas fa-check text-xs"></i></div><div class="w-10 h-10 rounded-lg flex items-center justify-center mb-3" style="background:'+col+'20"><i class="fas '+e.icon+'" style="color:'+col+'"></i></div><h3 class="font-bold text-[#1a2b4a] text-sm leading-tight">'+e.name_ar+'</h3>'+hoursHtml+'<button onclick="goToModule(\''+e.exam_type+'\',\''+e.module+'\')" class="mt-3 btn btn-primary text-xs w-full justify-center py-1.5" style="background:'+col+'">ابدأ <i class="fas fa-arrow-left"></i></button></div>';
    }).join('');
  }

  // All Courses Grid (locked state)
  const all=allCourses.courses||[];
  document.getElementById('allCoursesGrid').innerHTML=all.map(co=>{
    const locked=!enrolledCodes.has(co.code);
    const col=co.color||'#3b82f6';
    return '<div class="card course-card '+(locked?'locked':'unlocked')+'" style="'+(locked?'':'border-color:'+col+';')+'" onclick="'+(locked?'window.location=\'/courses#'+co.code+'\'':'goToModule(\''+co.exam_type+'\',\''+co.module+'\')')+'">'+(locked?'<div class="lock-badge"><i class="fas fa-lock text-xs"></i></div>':'<div class="unlock-badge"><i class="fas fa-check text-xs"></i></div>')+'<div class="w-10 h-10 rounded-lg flex items-center justify-center mb-2" style="background:'+col+(locked?'40':'20')+'"><i class="fas '+co.icon+'" style="color:'+col+(locked?';opacity:.6':'')+'"></i></div><h3 class="font-bold text-[#1a2b4a] text-xs leading-tight">'+co.name_ar+'</h3><p class="text-xs font-bold mt-1" style="color:'+col+(locked?';opacity:.7':'')+'">'+co.price+' د.أ</p></div>';
  }).join('');

  // Welcome modal
  const wm=sessionStorage.getItem('welcome_msg');
  if(wm){const d=JSON.parse(wm);document.getElementById('welcomeMsg').textContent=d.msg;document.getElementById('welcomeTitle').textContent=d.title;document.getElementById('welcomeModal').classList.remove('hidden');sessionStorage.removeItem('welcome_msg');}
}
function goToModule(exam,module){if(!module||module==='null')window.location='/practice?type='+exam;else window.location='/practice?type='+exam+'&module='+module;}
function closeWelcome(){document.getElementById('welcomeModal').classList.add('hidden');}
loadDashboard();
</script>`))
})

// COURSES PAGE
app.get('/courses', async (c) => {
  const user = await getUser(c)
  const loginBtn = user
    ? '<a href="/dashboard" class="text-[#94a3b8] hover:text-white text-sm"><i class="fas fa-home mr-1"></i>لوحتي</a><button onclick="fetch(\'/api/auth/logout\',{method:\'POST\'}).then(()=>location.href=\'/login\')" class="btn btn-outline text-sm py-2 px-3"><i class="fas fa-sign-out-alt"></i></button>'
    : '<a href="/login" class="btn btn-primary text-sm">دخول / تسجيل</a>'
  const codeBtn = user
    ? '<button onclick="window.location=\'/activate\'" class="btn btn-outline w-full justify-center mt-2 text-sm"><i class="fas fa-key"></i> لديّ كود تفعيل</button>'
    : '<a href="/login" class="btn btn-outline w-full justify-center mt-2 text-sm"><i class="fas fa-key"></i> لديّ كود تفعيل</a>'
  const moduleBtns = (code: string, label: string, price: number, color: string) =>
    '<button onclick="buyNow(\'' + code + '\',\'' + label + '\',' + price + ')" class="btn text-xs w-full justify-center mt-2 py-1.5" style="background:' + color + ';color:white"><i class="fas fa-shopping-cart"></i> شراء</button>' +
    (user
      ? '<button onclick="window.location=\'/activate\'" class="btn btn-outline text-xs w-full justify-center mt-1 py-1"><i class="fas fa-key"></i> لديّ كود</button>'
      : '<a href="/login" class="btn btn-outline text-xs w-full justify-center mt-1 py-1" style="display:inline-flex"><i class="fas fa-key"></i> لديّ كود</a>')

  return c.html(L('المسارات والأسعار', `
<nav class="navbar">
  <a href="/" class="brand"><i class="fas fa-graduation-cap text-[#f59e0b]"></i> The Yamen <span class="g">Guide</span></a>
  <div class="flex items-center gap-3">
    <a href="/books" class="text-[#94a3b8] hover:text-white text-sm hidden sm:block"><i class="fas fa-book mr-1"></i>الكتب</a>
    ${loginBtn}
  </div>
</nav>
<div class="max-w-6xl mx-auto p-4 md:p-6">
  <div class="text-center mb-10">
    <h1 class="text-3xl font-bold text-[#1a2b4a] mb-2">المسارات والأسعار</h1>
    <p class="text-[#475569]">اختر المسار المناسب لك وابدأ رحلتك نحو الدرجة المطلوبة</p>
  </div>

  <!-- Quick Nav Tabs -->
  <div class="flex flex-wrap gap-2 mb-8 justify-center">
    <a href="#ielts" class="tab-btn active" onclick="setTab(this)"><i class="fas fa-globe mr-1"></i>IELTS</a>
    <a href="#toefl" class="tab-btn" onclick="setTab(this)"><i class="fas fa-university mr-1"></i>TOEFL</a>
    <a href="#found" class="tab-btn" onclick="setTab(this)"><i class="fas fa-layer-group mr-1"></i>تأسيس</a>
    <a href="#vip" class="tab-btn" onclick="setTab(this)"><i class="fas fa-crown mr-1"></i>VIP</a>
    <a href="#payment" class="tab-btn" onclick="setTab(this)"><i class="fas fa-credit-card mr-1"></i>الدفع</a>
    <a href="/books" class="tab-btn"><i class="fas fa-book mr-1"></i>الكتب</a>
  </div>

  <!-- IELTS Section -->
  <div id="ielts" class="mb-12 scroll-mt-20">
    <div class="flex items-center gap-3 mb-5">
      <div class="w-12 h-12 rounded-xl bg-[#dbeafe] flex items-center justify-center shadow-sm"><i class="fas fa-globe text-[#0ea5e9] text-xl"></i></div>
      <div><h2 class="text-2xl font-bold text-[#1a2b4a]">IELTS Academic</h2><p class="text-sm text-[#475569]">الامتحان الأكثر قبولاً حول العالم للدراسة والهجرة</p></div>
      <span class="badge badge-ielts mr-auto">أيلتس</span>
    </div>
    <div class="grid md:grid-cols-5 gap-4">
      <div class="md:col-span-2 card border-2 border-[#0ea5e9] relative overflow-hidden shadow-md">
        <div class="absolute top-3 left-3 bg-[#0ea5e9] text-white text-xs font-bold px-2 py-1 rounded-full">الأفضل قيمةً</div>
        <div class="w-12 h-12 rounded-xl bg-[#dbeafe] flex items-center justify-center mb-3"><i class="fas fa-globe text-[#0ea5e9] text-xl"></i></div>
        <h3 class="font-bold text-[#1a2b4a] text-lg">الكورس الكامل</h3>
        <p class="text-sm text-[#475569] mt-1 mb-3">Reading + Writing + Listening + Speaking</p>
        <div class="price-tag text-[#0ea5e9]">150 <span class="text-base font-semibold">د.أ</span></div>
        <p class="text-xs text-[#94a3b8] mt-1 mb-4">وفّر 50 د.أ مقارنة بالشراء منفرداً</p>
        <button onclick="buyNow('IELTS_FULL','IELTS الكامل',150)" class="btn w-full justify-center mb-2" style="background:#0ea5e9;color:white"><i class="fas fa-shopping-cart"></i> شراء الآن</button>
        ${codeBtn}
      </div>
      <div class="md:col-span-3 grid grid-cols-2 gap-3">
        ` + [['IELTS_READ','fa-book-open','Reading','قراءة',50],['IELTS_WRITE','fa-pen-nib','Writing','كتابة',50],['IELTS_LISTEN','fa-headphones','Listening','استماع',50],['IELTS_SPEAK','fa-microphone','Speaking','تحدث',50]].map(([code,icon,en,ar,price]) =>
        '<div class="card hover:shadow-md transition-all border-t-4 border-t-[#0ea5e9]" id="' + code + '">' +
        '<div class="w-9 h-9 rounded-lg bg-[#dbeafe] flex items-center justify-center mb-2"><i class="fas ' + icon + ' text-[#0ea5e9]"></i></div>' +
        '<h4 class="font-bold text-[#1a2b4a] text-sm">' + en + '</h4><p class="text-xs text-[#475569]">' + ar + '</p>' +
        '<div class="text-[#0ea5e9] font-bold text-xl mt-2 mb-3">' + price + ' <span class="text-xs font-normal text-[#475569]">د.أ</span></div>' +
        moduleBtns(String(code), 'IELTS ' + String(en), Number(price), '#0ea5e9') +
        '</div>').join('') + `
      </div>
    </div>
  </div>

  <!-- TOEFL Section -->
  <div id="toefl" class="mb-12 scroll-mt-20">
    <div class="flex items-center gap-3 mb-5">
      <div class="w-12 h-12 rounded-xl bg-[#fee2e2] flex items-center justify-center shadow-sm"><i class="fas fa-university text-[#ef4444] text-xl"></i></div>
      <div><h2 class="text-2xl font-bold text-[#1a2b4a]">TOEFL iBT</h2><p class="text-sm text-[#475569]">المطلوب للجامعات الأمريكية والكندية</p></div>
      <span class="badge badge-toefl mr-auto">تويفل</span>
    </div>
    <div class="grid md:grid-cols-5 gap-4">
      <div class="md:col-span-2 card border-2 border-[#ef4444] relative overflow-hidden shadow-md">
        <div class="absolute top-3 left-3 bg-[#ef4444] text-white text-xs font-bold px-2 py-1 rounded-full">الأفضل قيمةً</div>
        <div class="w-12 h-12 rounded-xl bg-[#fee2e2] flex items-center justify-center mb-3"><i class="fas fa-university text-[#ef4444] text-xl"></i></div>
        <h3 class="font-bold text-[#1a2b4a] text-lg">الكورس الكامل</h3>
        <p class="text-sm text-[#475569] mt-1 mb-3">Reading + Writing + Listening + Speaking</p>
        <div class="price-tag text-[#ef4444]">180 <span class="text-base font-semibold">د.أ</span></div>
        <p class="text-xs text-[#94a3b8] mt-1 mb-4">وفّر 100 د.أ مقارنة بالشراء منفرداً</p>
        <button onclick="buyNow('TOEFL_FULL','TOEFL الكامل',180)" class="btn w-full justify-center mb-2" style="background:#ef4444;color:white"><i class="fas fa-shopping-cart"></i> شراء الآن</button>
        ${codeBtn}
      </div>
      <div class="md:col-span-3 grid grid-cols-2 gap-3">
        ` + [['TOEFL_READ','fa-book-open','Reading','قراءة',70],['TOEFL_WRITE','fa-pen-nib','Writing','كتابة',70],['TOEFL_LISTEN','fa-headphones','Listening','استماع',70],['TOEFL_SPEAK','fa-microphone','Speaking','تحدث',70]].map(([code,icon,en,ar,price]) =>
        '<div class="card hover:shadow-md transition-all border-t-4 border-t-[#ef4444]" id="' + code + '">' +
        '<div class="w-9 h-9 rounded-lg bg-[#fee2e2] flex items-center justify-center mb-2"><i class="fas ' + icon + ' text-[#ef4444]"></i></div>' +
        '<h4 class="font-bold text-[#1a2b4a] text-sm">' + en + '</h4><p class="text-xs text-[#475569]">' + ar + '</p>' +
        '<div class="text-[#ef4444] font-bold text-xl mt-2 mb-3">' + price + ' <span class="text-xs font-normal text-[#475569]">د.أ</span></div>' +
        moduleBtns(String(code), 'TOEFL ' + String(en), Number(price), '#ef4444') +
        '</div>').join('') + `
      </div>
    </div>
  </div>

  <!-- Foundations + VIP -->
  <div class="grid md:grid-cols-2 gap-6 mb-12">
    <div class="card border-2 border-[#8b5cf6] shadow-md" id="found">
      <div class="flex items-start gap-4">
        <div class="w-14 h-14 rounded-xl bg-[#ede9fe] flex items-center justify-center flex-shrink-0 shadow-sm"><i class="fas fa-layer-group text-[#8b5cf6] text-2xl"></i></div>
        <div class="flex-1">
          <span class="badge badge-found mb-2">تأسيس لغوي</span>
          <h3 class="font-bold text-[#1a2b4a] text-lg">مسار التأسيس اللغوي</h3>
          <p class="text-sm text-[#475569] mt-1 mb-3">برنامج شامل لبناء قواعد اللغة الإنجليزية من الصفر للوصول لمستوى B2+. يشمل: Grammar, Vocabulary, Reading, Writing, Conversation.</p>
          <div class="price-tag text-[#8b5cf6] mb-4">150 <span class="text-base font-semibold">د.أ</span></div>
          <button onclick="buyNow('FOUNDATIONS','مسار التأسيس',150)" class="btn w-full justify-center mb-2" style="background:#8b5cf6;color:white"><i class="fas fa-shopping-cart"></i> شراء الآن</button>
          ${codeBtn}
        </div>
      </div>
    </div>
    <div class="card border-2 border-[#f59e0b] relative overflow-hidden shadow-md" id="vip">
      <div class="absolute top-0 right-0 bg-[#f59e0b] text-white text-xs font-bold px-3 py-1 rounded-bl-lg">👑 VIP حصري</div>
      <div class="flex items-start gap-4">
        <div class="w-14 h-14 rounded-xl bg-[#fef3c7] flex items-center justify-center flex-shrink-0 shadow-sm"><i class="fas fa-crown text-[#f59e0b] text-2xl"></i></div>
        <div class="flex-1">
          <span class="badge badge-vip mb-2">خاص – 20 ساعة</span>
          <h3 class="font-bold text-[#1a2b4a] text-lg">المسار الخاص VIP</h3>
          <p class="text-sm text-[#475569] mt-1 mb-3">20 ساعة تدريب خاص مع المدرب. مرونة كاملة في الجدول، تدريس مخصص 100% لاحتياجاتك الفردية.</p>
          <div class="flex items-baseline gap-3 mb-4">
            <div class="price-tag text-[#f59e0b]">400 <span class="text-base font-semibold">د.أ</span></div>
            <div class="text-[#475569] text-sm">أو <strong>25 د.أ</strong> / ساعة</div>
          </div>
          <button onclick="buyNow('PRIVATE_VIP','المسار الخاص VIP',400)" class="btn btn-gold w-full justify-center mb-2"><i class="fas fa-shopping-cart"></i> احجز الآن</button>
          ${codeBtn}
        </div>
      </div>
    </div>
  </div>

  <!-- Payment Methods -->
  <div id="payment" class="card mb-8 scroll-mt-20">
    <h3 class="font-bold text-[#1a2b4a] text-xl mb-2 text-center"><i class="fas fa-shield-alt text-[#10b981] mr-2"></i>طرق الدفع الآمنة</h3>
    <p class="text-center text-sm text-[#475569] mb-6">ادفع بثقة عبر المنافذ المعتمدة في الأردن</p>
    <div class="grid md:grid-cols-2 gap-6">
      <!-- Zain Cash -->
      <div class="border-2 border-[#e2e8f0] hover:border-[#f59e0b] rounded-xl p-5 text-center transition-colors">
        <div class="w-16 h-16 rounded-2xl bg-[#fff8e1] flex items-center justify-center mx-auto mb-3">
          <span class="text-3xl">📱</span>
        </div>
        <h4 class="font-bold text-[#1a2b4a] text-lg mb-1">Zain Cash</h4>
        <p class="text-[#475569] text-sm mb-3">محفظة إلكترونية – تحويل فوري</p>
        <div class="bg-[#fff8e1] border border-[#fde68a] rounded-lg p-3 font-mono font-bold text-2xl text-[#1a2b4a] mb-4 tracking-wider">0798919150</div>
        <div id="qrZain" class="flex justify-center mb-3"></div>
        <p class="text-xs text-[#94a3b8]"><i class="fas fa-user-circle mr-1"></i>اسم الحساب: Yamen Guide</p>
      </div>
      <!-- CliQ -->
      <div class="border-2 border-[#e2e8f0] hover:border-[#0ea5e9] rounded-xl p-5 text-center transition-colors">
        <div class="w-16 h-16 rounded-2xl bg-[#eff6ff] flex items-center justify-center mx-auto mb-3">
          <span class="text-3xl">🏦</span>
        </div>
        <h4 class="font-bold text-[#1a2b4a] text-lg mb-1">CliQ – البنك الإسلامي</h4>
        <p class="text-[#475569] text-sm mb-3">تحويل فوري عبر البنك الإسلامي الأردني</p>
        <div class="bg-[#eff6ff] border border-[#bfdbfe] rounded-lg p-3 font-mono font-bold text-2xl text-[#1a2b4a] mb-4 tracking-wider">0798919150</div>
        <div id="qrCliq" class="flex justify-center mb-3"></div>
        <p class="text-xs text-[#94a3b8]"><i class="fas fa-university mr-1"></i>البنك الإسلامي الأردني – CliQ Alias: TheYamenGuide</p>
      </div>
    </div>
    <div class="mt-5 p-4 bg-gradient-to-l from-[#f0fdf4] to-[#ecfdf5] border border-[#86efac] rounded-xl">
      <div class="flex items-start gap-3">
        <div class="w-9 h-9 rounded-xl bg-[#10b981] flex items-center justify-center flex-shrink-0">
          <i class="fas fa-check-double text-white text-sm"></i>
        </div>
        <div>
          <p class="font-bold text-[#065f46] mb-1">كيف تستلم كود التفعيل؟</p>
          <ol class="text-sm text-[#166534] space-y-1 list-decimal list-inside">
            <li>ادفع المبلغ عبر Zain Cash أو CliQ على الرقم 0798919150</li>
            <li>اضغط "شراء الآن" واختر طريقة الدفع لإرسال الإيصال تلقائياً</li>
            <li>ستحصل على كود التفعيل خلال دقائق عبر الواتساب</li>
            <li>فعّل الكود في صفحة التفعيل وابدأ التدريب فوراً</li>
          </ol>
        </div>
      </div>
    </div>
    <div class="mt-4 text-center">
      <a href="/books" class="btn btn-gold py-3 px-8 text-base"><i class="fas fa-book mr-2"></i>تحقق من كتبنا المعتمدة</a>
    </div>
  </div>
</div>

<!-- Payment Modal -->
<div id="payModal" class="hidden fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
  <div class="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
    <div class="p-1" id="payModalHeader" style="background:#3b82f6"></div>
    <div class="p-6">
      <h2 class="text-xl font-bold text-[#1a2b4a] mb-1" id="payModalTitle">إتمام الشراء</h2>
      <p class="text-[#475569] text-sm mb-4" id="payModalCourse"></p>
      <div class="grid grid-cols-2 gap-4 mb-6">
        <div class="border-2 border-[#e2e8f0] rounded-xl p-4 text-center cursor-pointer hover:border-[#3b82f6] transition-colors" onclick="selectPay('zaincash')">
          <div class="text-3xl mb-1">📱</div><div class="font-bold text-sm">Zain Cash</div>
          <div class="text-xs text-[#94a3b8]">0798919150</div>
        </div>
        <div class="border-2 border-[#e2e8f0] rounded-xl p-4 text-center cursor-pointer hover:border-[#3b82f6] transition-colors" onclick="selectPay('cliq')">
          <div class="text-3xl mb-1">🏦</div><div class="font-bold text-sm">CliQ</div>
          <div class="text-xs text-[#94a3b8]">البنك الإسلامي</div>
        </div>
      </div>
      <div id="payDetails" class="hidden mb-4">
        <div class="bg-[#f8fafc] rounded-xl p-4 text-center mb-3">
          <p class="text-sm text-[#475569] mb-2" id="payMethod"></p>
          <div class="font-mono font-bold text-2xl text-[#1a2b4a] mb-2">0798919150</div>
          <div class="text-2xl font-bold mb-1" id="payAmount"></div>
          <p class="text-xs text-[#94a3b8]">المبلغ المطلوب</p>
        </div>
        <button onclick="sendToWhatsApp()" class="btn btn-wa w-full justify-center py-3 text-base">
          <i class="fab fa-whatsapp text-xl"></i> إرسال الإيصال على الواتساب
        </button>
        <p class="text-xs text-center text-[#94a3b8] mt-2">بعد الدفع، اضغط الزر لإرسال الإيصال وستحصل على كود التفعيل خلال دقائق</p>
      </div>
      <button onclick="closePayModal()" class="btn btn-outline w-full justify-center mt-2">إغلاق</button>
    </div>
  </div>
</div>`, `<script src="https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js"></script>
<script>
let curCourse='',curName='',curPrice=0,curMethod='';

function setTab(el){document.querySelectorAll('.tab-btn').forEach(t=>t.classList.remove('active'));el.classList.add('active');}

// Generate QR codes for payment page
window.addEventListener('load',()=>{
  if(document.getElementById('qrZain')){
    QRCode.toCanvas(document.createElement('canvas'),'zaincash://transfer?number=0798919150&name=YamenGuide&amount=',{width:130,margin:1,color:{dark:'#1a2b4a',light:'#ffffff'}},function(err,canvas){if(!err){canvas.className='rounded-xl mx-auto shadow-sm';document.getElementById('qrZain').appendChild(canvas);}});
  }
  if(document.getElementById('qrCliq')){
    QRCode.toCanvas(document.createElement('canvas'),'cliq://pay?alias=TheYamenGuide&bank=JIB&name=TheYamenGuide',{width:130,margin:1,color:{dark:'#1a2b4a',light:'#ffffff'}},function(err,canvas){if(!err){canvas.className='rounded-xl mx-auto shadow-sm';document.getElementById('qrCliq').appendChild(canvas);}});
  }
});

function buyNow(code,name,price){
  curCourse=code;curName=name;curPrice=price;
  document.getElementById('payModalTitle').textContent='شراء: '+name;
  document.getElementById('payModalCourse').textContent='السعر: '+price+' دينار أردني';
  document.getElementById('payDetails').classList.add('hidden');
  document.getElementById('payModal').classList.remove('hidden');
  const colors={IELTS:'#0ea5e9',TOEFL:'#ef4444',FOUNDATIONS:'#8b5cf6',PRIVATE:'#f59e0b'};
  const ct=code.split('_')[0];
  document.getElementById('payModalHeader').style.background=colors[ct]||'#3b82f6';
}
function selectPay(method){
  curMethod=method;
  document.querySelectorAll('#payModal .border-2').forEach(el=>el.classList.remove('border-[#3b82f6]'));
  event.currentTarget.classList.add('border-[#3b82f6]');
  document.getElementById('payMethod').textContent=method==='zaincash'?'📱 Zain Cash – تحويل مباشر':'🏦 CliQ – البنك الإسلامي الأردني';
  document.getElementById('payAmount').textContent=curPrice+' د.أ';
  document.getElementById('payDetails').classList.remove('hidden');
}
function sendToWhatsApp(){
  const msg=encodeURIComponent('مرحباً 👋\nأريد تفعيل: '+curName+'\nالمبلغ: '+curPrice+' د.أ\nطريقة الدفع: '+(curMethod==='zaincash'?'Zain Cash':'CliQ')+'\n[أرفق صورة الإيصال هنا]');
  window.open('https://wa.me/962798919150?text='+msg,'_blank');
  fetch('/api/payment-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({course_code:curCourse,payment_method:curMethod})}).catch(()=>{});
}
function closePayModal(){document.getElementById('payModal').classList.add('hidden');}
</script>`))
})

// ==================== BOOKS PAGE ====================
app.get('/books', async (c) => {
  const user = await getUser(c)
  const loginBtn = user
    ? '<a href="/dashboard" class="text-[#94a3b8] hover:text-white text-sm"><i class="fas fa-home mr-1"></i>لوحتي</a><button onclick="fetch(\'/api/auth/logout\',{method:\'POST\'}).then(()=>location.href=\'/login\')" class="btn btn-outline text-sm py-2 px-3"><i class="fas fa-sign-out-alt"></i></button>'
    : '<a href="/login" class="btn btn-primary text-sm">دخول / تسجيل</a>'

  // Libraries data by governorate
  const libraries = [
    { gov: 'عمّان', icon: 'fa-city', color: '#f59e0b', libs: [
      { name: 'مكتبة الجامعة', phone: '0798919150' },
      { name: 'مكتبة ABC', phone: '0797310006' },
      { name: 'مكتبة دار المعرفة', phone: '0796500001' },
      { name: 'مكتبة النور', phone: '0795400002' },
    ]},
    { gov: 'الزرقاء', icon: 'fa-industry', color: '#3b82f6', libs: [
      { name: 'مكتبة الفارابي', phone: '0796300003' },
      { name: 'مكتبة العلم والثقافة', phone: '0795200004' },
    ]},
    { gov: 'إربد', icon: 'fa-map-marker-alt', color: '#10b981', libs: [
      { name: 'مكتبة اليرموك', phone: '0794100005' },
      { name: 'مكتبة المستقبل', phone: '0793000006' },
    ]},
    { gov: 'العقبة', icon: 'fa-anchor', color: '#8b5cf6', libs: [
      { name: 'مكتبة البحر', phone: '0791900007' },
      { name: 'مكتبة الخليج', phone: '0790800008' },
    ]},
    { gov: 'البلقاء', icon: 'fa-mountain', color: '#ef4444', libs: [
      { name: 'مكتبة الأمانة', phone: '0789700009' },
    ]},
    { gov: 'مأدبا', icon: 'fa-monument', color: '#0ea5e9', libs: [
      { name: 'مكتبة السلام', phone: '0788600010' },
    ]},
    { gov: 'الكرك', icon: 'fa-chess-rook', color: '#d97706', libs: [
      { name: 'مكتبة القلعة', phone: '0787500011' },
    ]},
    { gov: 'الطفيلة', icon: 'fa-leaf', color: '#6d28d9', libs: [
      { name: 'مكتبة الوفاء', phone: '0786400012' },
    ]},
    { gov: 'معان', icon: 'fa-wind', color: '#be185d', libs: [
      { name: 'مكتبة الوادي', phone: '0785300013' },
    ]},
    { gov: 'عجلون', icon: 'fa-tree', color: '#065f46', libs: [
      { name: 'مكتبة الجبل الأخضر', phone: '0784200014' },
    ]},
    { gov: 'جرش', icon: 'fa-columns', color: '#7c3aed', libs: [
      { name: 'مكتبة جرش للكتاب', phone: '0783100015' },
    ]},
    { gov: 'المفرق', icon: 'fa-road', color: '#1d4ed8', libs: [
      { name: 'مكتبة الشمال', phone: '0782000016' },
    ]},
  ]

  const libsHtml = libraries.map((gov, i) =>
    '<div class="mb-3">' +
    '<button onclick="toggleLib(' + i + ')" class="w-full flex items-center justify-between p-4 bg-white rounded-xl border-2 border-[#e2e8f0] hover:border-[' + gov.color + '] transition-all font-semibold text-[#1a2b4a] shadow-sm" id="libBtn' + i + '">' +
    '<div class="flex items-center gap-3"><div class="w-9 h-9 rounded-lg flex items-center justify-center" style="background:' + gov.color + '20"><i class="fas ' + gov.icon + '" style="color:' + gov.color + '"></i></div><span>' + gov.gov + '</span>' +
    '<span class="text-xs font-normal text-[#94a3b8] mr-2">(' + gov.libs.length + ' مكتبة)</span></div>' +
    '<i class="fas fa-chevron-down text-[#94a3b8] transition-transform" id="libChev' + i + '"></i></button>' +
    '<div id="libList' + i + '" class="hidden mt-2 mr-4 space-y-2">' +
    gov.libs.map(lib =>
      '<div class="flex items-center justify-between p-3 bg-[#f8fafc] rounded-lg border border-[#f1f5f9] hover:bg-white transition-colors">' +
      '<div class="flex items-center gap-2"><i class="fas fa-book-reader text-[#94a3b8] text-sm"></i><span class="text-sm font-medium text-[#1a2b4a]">' + lib.name + '</span></div>' +
      '<a href="tel:' + lib.phone + '" class="flex items-center gap-2 btn text-xs py-1.5 px-3 text-white" style="background:' + gov.color + '">' +
      '<i class="fas fa-phone-alt"></i>' + lib.phone + '</a></div>'
    ).join('') +
    '</div></div>'
  ).join('')

  return c.html(L('الكتب المعتمدة', `
<nav class="navbar">
  <a href="/" class="brand"><i class="fas fa-graduation-cap text-[#f59e0b]"></i> The Yamen <span class="g">Guide</span></a>
  <div class="flex items-center gap-3">
    <a href="/courses" class="text-[#94a3b8] hover:text-white text-sm hidden sm:block"><i class="fas fa-tag mr-1"></i>الأسعار</a>
    ${loginBtn}
  </div>
</nav>
<div class="max-w-5xl mx-auto p-4 md:p-6">
  <div class="text-center mb-10">
    <div class="inline-flex items-center justify-center w-16 h-16 bg-[#fef3c7] rounded-2xl mb-4 shadow-sm">
      <i class="fas fa-book-open text-[#f59e0b] text-2xl"></i>
    </div>
    <h1 class="text-3xl font-bold text-[#1a2b4a] mb-2">الكتب المعتمدة</h1>
    <p class="text-[#475569]">كتب أصلية معتمدة للتحضير لـ IELTS وTOEFL iBT والتأسيس اللغوي</p>
  </div>

  <!-- Books Grid -->
  <div class="grid md:grid-cols-3 gap-6 mb-12">

    <!-- IELTS Book -->
    <div class="card border-2 border-[#0ea5e9] hover:shadow-xl transition-all">
      <div class="relative mb-4">
        <div class="w-full h-48 bg-gradient-to-br from-[#dbeafe] to-[#bfdbfe] rounded-xl flex flex-col items-center justify-center shadow-inner">
          <i class="fas fa-book text-[#0ea5e9] text-5xl mb-3"></i>
          <div class="text-[#1e40af] font-bold text-lg">IELTS</div>
          <div class="text-[#3b82f6] text-sm">Academic Prep Book</div>
        </div>
        <div class="absolute top-3 left-3 badge badge-ielts shadow">أيلتس</div>
      </div>
      <h3 class="font-bold text-[#1a2b4a] text-lg mb-1">كتاب IELTS المعتمد</h3>
      <p class="text-sm text-[#475569] mb-4">الكتاب الأصلي المعتمد للتحضير لامتحان أيلتس الأكاديمي. يشمل تمارين كاملة وأسئلة محاكاة حقيقية مع إجابات نموذجية.</p>
      <div class="flex gap-2 flex-col">
        <a href="https://wa.me/962798919150?text=' + encodeURIComponent('مرحباً، أريد طلب كتاب IELTS المعتمد مع التوصيل') + '" target="_blank" class="btn btn-wa w-full justify-center"><i class="fab fa-whatsapp"></i> 📦 طلب مع توصيل</a>
        <button onclick="toggleBookLibs('ielts')" class="btn btn-outline w-full justify-center text-sm"><i class="fas fa-map-marker-alt"></i> 📍 نقاط البيع</button>
      </div>
      <div id="booksIelts" class="hidden mt-3 p-3 bg-[#f0f9ff] border border-[#bae6fd] rounded-xl text-sm text-[#0369a1]">
        <p class="font-bold mb-2 flex items-center gap-2"><i class="fas fa-store"></i>متوفر في المكتبات أدناه</p>
        <p class="text-xs">ابحث في الدليل أدناه عن المكتبة الأقرب إليك وتواصل معهم مباشرة.</p>
      </div>
    </div>

    <!-- TOEFL Book -->
    <div class="card border-2 border-[#ef4444] hover:shadow-xl transition-all">
      <div class="relative mb-4">
        <div class="w-full h-48 bg-gradient-to-br from-[#fee2e2] to-[#fecaca] rounded-xl flex flex-col items-center justify-center shadow-inner">
          <i class="fas fa-book text-[#ef4444] text-5xl mb-3"></i>
          <div class="text-[#991b1b] font-bold text-lg">TOEFL iBT</div>
          <div class="text-[#dc2626] text-sm">Official Prep Book</div>
        </div>
        <div class="absolute top-3 left-3 badge badge-toefl shadow">تويفل</div>
      </div>
      <h3 class="font-bold text-[#1a2b4a] text-lg mb-1">كتاب TOEFL iBT المعتمد</h3>
      <p class="text-sm text-[#475569] mb-4">الكتاب الرسمي المعتمد لامتحان التوفل. يحتوي على اختبارات كاملة، استراتيجيات مثبتة، وشرح مفصل لكل قسم.</p>
      <div class="flex gap-2 flex-col">
        <a href="https://wa.me/962798919150?text=' + encodeURIComponent('مرحباً، أريد طلب كتاب TOEFL iBT المعتمد مع التوصيل') + '" target="_blank" class="btn btn-wa w-full justify-center"><i class="fab fa-whatsapp"></i> 📦 طلب مع توصيل</a>
        <button onclick="toggleBookLibs('toefl')" class="btn btn-outline w-full justify-center text-sm"><i class="fas fa-map-marker-alt"></i> 📍 نقاط البيع</button>
      </div>
      <div id="booksToefl" class="hidden mt-3 p-3 bg-[#fff1f2] border border-[#fecaca] rounded-xl text-sm text-[#991b1b]">
        <p class="font-bold mb-2 flex items-center gap-2"><i class="fas fa-store"></i>متوفر في المكتبات أدناه</p>
        <p class="text-xs">ابحث في الدليل أدناه عن المكتبة الأقرب إليك وتواصل معهم مباشرة.</p>
      </div>
    </div>

    <!-- Foundation Book -->
    <div class="card border-2 border-[#8b5cf6] hover:shadow-xl transition-all">
      <div class="relative mb-4">
        <div class="w-full h-48 bg-gradient-to-br from-[#ede9fe] to-[#ddd6fe] rounded-xl flex flex-col items-center justify-center shadow-inner">
          <i class="fas fa-book text-[#8b5cf6] text-5xl mb-3"></i>
          <div class="text-[#5b21b6] font-bold text-lg">Foundation</div>
          <div class="text-[#7c3aed] text-sm">English Language</div>
        </div>
        <div class="absolute top-3 left-3 badge badge-found shadow">تأسيس</div>
      </div>
      <h3 class="font-bold text-[#1a2b4a] text-lg mb-1">كتاب التأسيس اللغوي</h3>
      <p class="text-sm text-[#475569] mb-4">كتاب شامل لتأسيس اللغة الإنجليزية من مستوى A1 إلى B2+. Grammar, Vocabulary, Reading وConverstation بأسلوب تدريجي.</p>
      <div class="flex gap-2 flex-col">
        <a href="https://wa.me/962798919150?text=' + encodeURIComponent('مرحباً، أريد طلب كتاب التأسيس اللغوي مع التوصيل') + '" target="_blank" class="btn btn-wa w-full justify-center"><i class="fab fa-whatsapp"></i> 📦 طلب مع توصيل</a>
        <button onclick="toggleBookLibs('found')" class="btn btn-outline w-full justify-center text-sm"><i class="fas fa-map-marker-alt"></i> 📍 نقاط البيع</button>
      </div>
      <div id="booksFound" class="hidden mt-3 p-3 bg-[#f5f3ff] border border-[#ddd6fe] rounded-xl text-sm text-[#5b21b6]">
        <p class="font-bold mb-2 flex items-center gap-2"><i class="fas fa-store"></i>متوفر في المكتبات أدناه</p>
        <p class="text-xs">ابحث في الدليل أدناه عن المكتبة الأقرب إليك وتواصل معهم مباشرة.</p>
      </div>
    </div>
  </div>

  <!-- Delivery Info -->
  <div class="card bg-gradient-to-l from-[#f0fdf4] to-[#ecfdf5] border border-[#86efac] mb-10">
    <div class="flex items-start gap-4">
      <div class="w-14 h-14 rounded-2xl bg-[#10b981] flex items-center justify-center flex-shrink-0 shadow-sm">
        <i class="fas fa-truck text-white text-xl"></i>
      </div>
      <div>
        <h3 class="font-bold text-[#065f46] text-lg mb-2">خدمة التوصيل المنزلي</h3>
        <p class="text-[#047857] text-sm mb-3">نوصّل الكتب لجميع محافظات الأردن. تواصل معنا عبر الواتساب وأخبرنا بعنوانك لترتيب التوصيل.</p>
        <div class="flex flex-wrap gap-3">
          <a href="https://wa.me/962798919150?text=' + encodeURIComponent('مرحباً، أريد طلب كتاب مع التوصيل. اسمي: ... عنواني: ... الكتاب المطلوب: ...') + '" target="_blank" class="btn btn-wa py-2 px-6">
            <i class="fab fa-whatsapp text-lg"></i> 0798919150 – اطلب الآن
          </a>
          <div class="flex items-center gap-2 text-sm text-[#047857]">
            <i class="fas fa-clock"></i> توصيل خلال 24-48 ساعة
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Libraries Directory -->
  <div class="mb-8">
    <div class="flex items-center gap-3 mb-6">
      <div class="w-12 h-12 rounded-xl bg-[#fef3c7] flex items-center justify-center shadow-sm">
        <i class="fas fa-map-marked-alt text-[#f59e0b] text-xl"></i>
      </div>
      <div>
        <h2 class="text-2xl font-bold text-[#1a2b4a]">دليل المكتبات</h2>
        <p class="text-sm text-[#475569]">اعثر على أقرب مكتبة معتمدة في محافظتك</p>
      </div>
      <button onclick="expandAll()" class="btn btn-outline text-sm mr-auto"><i class="fas fa-expand-alt mr-1"></i>فتح الكل</button>
    </div>
    <div id="libsContainer">
      ${libsHtml}
    </div>
  </div>

  <!-- CTA -->
  <div class="card bg-gradient-to-l from-[#1a2b4a] to-[#0f1e35] text-white text-center py-10">
    <h2 class="text-2xl font-bold mb-3">مستعد تبدأ؟</h2>
    <p class="text-[#94a3b8] mb-6">احصل على الكتاب وسجّل في المسار المناسب اليوم</p>
    <div class="flex flex-col sm:flex-row gap-3 justify-center">
      <a href="/courses" class="btn btn-gold py-3 px-8"><i class="fas fa-tag"></i> عرض المسارات والأسعار</a>
      <a href="https://wa.me/962798919150" target="_blank" class="btn btn-wa py-3 px-8"><i class="fab fa-whatsapp"></i> تواصل معنا</a>
    </div>
  </div>
</div>`, `<script>
function toggleLib(i){
  const list=document.getElementById('libList'+i);
  const chev=document.getElementById('libChev'+i);
  const btn=document.getElementById('libBtn'+i);
  const isOpen=!list.classList.contains('hidden');
  list.classList.toggle('hidden');
  chev.style.transform=isOpen?'':'rotate(180deg)';
  btn.style.borderColor=isOpen?'#e2e8f0':'#f59e0b';
}
function expandAll(){
  const n=${libraries.length};
  for(let i=0;i<n;i++){
    document.getElementById('libList'+i).classList.remove('hidden');
    document.getElementById('libChev'+i).style.transform='rotate(180deg)';
    document.getElementById('libBtn'+i).style.borderColor='#f59e0b';
  }
}
function toggleBookLibs(type){
  const map={ielts:'booksIelts',toefl:'booksToefl',found:'booksFound'};
  const el=document.getElementById(map[type]);
  if(el)el.classList.toggle('hidden');
}
</script>`))
})

// ACTIVATE PAGE
app.get('/activate', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  return c.html(L('تفعيل مسار', `
<nav class="navbar">
  <a href="/dashboard" class="brand"><i class="fas fa-graduation-cap text-[#f59e0b]"></i> The Yamen <span class="g">Guide</span></a>
  <div class="flex items-center gap-3">
    <a href="/dashboard" class="text-[#94a3b8] hover:text-white text-sm"><i class="fas fa-home mr-1"></i>لوحتي</a>
    <button onclick="fetch('/api/auth/logout',{method:'POST'}).then(()=>location.href='/login')" class="btn btn-outline text-sm py-2 px-3"><i class="fas fa-sign-out-alt"></i></button>
  </div>
</nav>
<div class="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-[#f8fafc] to-[#e0f2fe]">
  <div class="w-full max-w-md">
    <div class="text-center mb-8">
      <div class="inline-flex items-center justify-center w-20 h-20 bg-[#1a2b4a] rounded-2xl mb-4 shadow-xl">
        <i class="fas fa-key text-[#f59e0b] text-3xl"></i>
      </div>
      <h1 class="text-2xl font-bold text-[#1a2b4a]">تفعيل المسار</h1>
      <p class="text-[#475569] mt-1">أدخل كود التفعيل الخاص بك</p>
    </div>
    <div class="card shadow-xl">
      <div class="mb-6">
        <label class="block text-sm font-semibold text-[#475569] mb-2">كود التفعيل</label>
        <input id="codeInput" type="text" class="input text-center font-mono text-xl tracking-widest uppercase" placeholder="XXXX-XXXX" maxlength="9" oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9-]/g,'')"/>
        <p class="text-xs text-[#94a3b8] mt-2 text-center">الكود مكوّن من 8 أحرف بالصيغة XXXX-XXXX</p>
      </div>
      <div id="actError" class="hidden text-red-600 text-sm bg-red-50 p-3 rounded-lg mb-4"></div>
      <div id="actSuccess" class="hidden text-green-700 text-sm bg-green-50 p-3 rounded-lg mb-4"></div>
      <button onclick="activateCourse()" id="actBtn" class="btn btn-primary w-full justify-center py-3 text-base">
        <i class="fas fa-unlock-alt"></i> تفعيل المسار
      </button>
      <div class="mt-4 pt-4 border-t border-[#f1f5f9] text-center">
        <p class="text-sm text-[#475569] mb-2">لا تملك كود؟</p>
        <a href="/courses" class="btn btn-outline text-sm mr-2"><i class="fas fa-tag"></i> عرض الأسعار</a>
        <a href="https://wa.me/962798919150?text=أريد شراء كود تفعيل" target="_blank" class="btn btn-wa text-sm"><i class="fab fa-whatsapp"></i> شراء الكود</a>
      </div>
    </div>
  </div>
</div>`, `<script>
async function activateCourse(){
  const code=document.getElementById('codeInput').value.trim();
  const err=document.getElementById('actError'),suc=document.getElementById('actSuccess'),btn=document.getElementById('actBtn');
  err.classList.add('hidden');suc.classList.add('hidden');
  if(code.length<8){err.textContent='الرجاء إدخال الكود كاملاً';err.classList.remove('hidden');return;}
  btn.disabled=true;btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> جارٍ التفعيل...';
  try{
    const r=await fetch('/api/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
    const d=await r.json();
    if(d.success){
      suc.textContent='✅ تم تفعيل: '+d.course_name+' بنجاح!';
      suc.classList.remove('hidden');
      sessionStorage.setItem('welcome_msg',JSON.stringify({title:'🎉 تم تفعيل '+d.course_name,msg:d.welcome_message}));
      setTimeout(()=>window.location.href='/dashboard',1500);
    }else{err.textContent=d.error;err.classList.remove('hidden');}
  }catch(e){err.textContent='خطأ في الاتصال، حاول مجدداً';}
  finally{btn.disabled=false;btn.innerHTML='<i class="fas fa-unlock-alt"></i> تفعيل المسار';}
}
document.getElementById('codeInput').addEventListener('keydown',e=>{if(e.key==='Enter')activateCourse();});
</script>`))
})

// PRACTICE PAGE (kept from original, updated)
app.get('/practice', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  return c.html(L('الاختبارات التدريبية', `
<nav class="navbar">
  <a href="/dashboard" class="brand"><i class="fas fa-graduation-cap text-[#f59e0b]"></i> The Yamen <span class="g">Guide</span></a>
  <div class="flex items-center gap-3">
    <a href="/dashboard" class="text-[#94a3b8] hover:text-white text-sm"><i class="fas fa-home mr-1"></i>لوحتي</a>
    <button onclick="fetch('/api/auth/logout',{method:'POST'}).then(()=>location.href='/login')" class="btn btn-outline text-sm py-2 px-3"><i class="fas fa-sign-out-alt"></i></button>
  </div>
</nav>
<div class="max-w-5xl mx-auto p-4 md:p-6">
  <div class="flex items-center gap-3 mb-6">
    <a href="/dashboard" class="text-[#94a3b8] hover:text-[#1a2b4a]"><i class="fas fa-chevron-right"></i></a>
    <h1 class="text-2xl font-bold text-[#1a2b4a]">الاختبارات التدريبية</h1>
  </div>
  <div class="flex gap-3 mb-6">
    <button id="tTOEFL" onclick="setExam('TOEFL')" class="tab-btn active">TOEFL iBT</button>
    <button id="tIELTS" onclick="setExam('IELTS')" class="tab-btn">IELTS</button>
  </div>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
    ${[['reading','fa-book-open','#f59e0b','Reading','قراءة'],['listening','fa-headphones','#8b5cf6','Listening','استماع'],['speaking','fa-microphone','#ef4444','Speaking','تحدث'],['writing','fa-pen-nib','#10b981','Writing','كتابة']].map(([m,ic,col,en,ar])=>`
    <div class="card course-card cursor-pointer" onclick="goExam('${m}')" style="--c:${col}">
      <div class="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style="background:${col}20">
        <i class="fas ${ic} text-xl" style="color:${col}"></i>
      </div>
      <h3 class="font-bold text-[#1a2b4a]">${en}</h3>
      <p class="text-xs text-[#94a3b8] mt-1">${ar}</p>
      <div class="mt-3 pt-3 border-t border-[#f1f5f9]">
        <span class="btn text-xs py-1.5 px-3 w-full justify-center" style="background:${col};color:white">ابدأ <i class="fas fa-arrow-left mr-1"></i></span>
      </div>
    </div>`).join('')}
  </div>
</div>`, `<script>
let curExam=new URLSearchParams(location.search).get('type')||'TOEFL';
function setExam(e){curExam=e;document.getElementById('tTOEFL').className='tab-btn'+(e==='TOEFL'?' active':'');document.getElementById('tIELTS').className='tab-btn'+(e==='IELTS'?' active':'');}
function goExam(m){window.location='/exam?type='+curExam+'&module='+m;}
if(curExam==='IELTS'){setExam('IELTS');}
</script>`))
})

// EXAM PAGE (full timer simulation)
app.get('/exam', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  return c.html(L('اختبار تدريبي', `
<nav class="navbar">
  <a href="/dashboard" class="brand"><i class="fas fa-graduation-cap text-[#f59e0b]"></i> The Yamen <span class="g">Guide</span></a>
  <div class="flex items-center gap-4">
    <div id="timerBox" class="flex items-center gap-2 bg-[#0f1e35] px-4 py-2 rounded-lg">
      <i class="fas fa-clock text-[#f59e0b]"></i>
      <span class="text-white font-mono font-bold text-lg" id="timerTxt">--:--</span>
    </div>
    <button onclick="confirmExit()" class="btn text-sm py-2 px-3" style="background:#ef4444;color:white"><i class="fas fa-times mr-1"></i>خروج</button>
  </div>
</nav>
<div class="w-full bg-[#e2e8f0]"><div id="timerBar" style="height:4px;width:100%;background:linear-gradient(90deg,#10b981,#3b82f6);transition:width 1s linear"></div></div>
<div class="max-w-4xl mx-auto p-4 md:p-6">
  <div id="loadState" class="text-center py-20">
    <div class="w-12 h-12 border-4 border-[#3b82f6] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
    <p class="text-[#475569]">جارٍ تحميل الأسئلة...</p>
  </div>
  <div id="qArea" class="hidden">
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-3">
        <span id="examBadge" class="badge badge-toefl">TOEFL</span>
        <span id="modBadge" class="badge" style="background:#fef3c7;color:#92400e">Reading</span>
        <span class="text-sm text-[#475569]">سؤال <span id="qNum">1</span> من <span id="qTot">-</span></span>
      </div>
      <div class="flex gap-1" id="dots"></div>
    </div>
    <div id="passageBox" class="card mb-4 hidden">
      <h3 class="font-bold text-[#1a2b4a] mb-2 flex items-center gap-2"><i class="fas fa-file-alt text-[#f59e0b]"></i> النص</h3>
      <div id="passageTxt" class="text-sm leading-relaxed text-[#475569] max-h-64 overflow-y-auto pr-2"></div>
    </div>
    <div class="card mb-4">
      <div class="flex items-start gap-3 mb-4">
        <div class="w-8 h-8 rounded-full bg-[#1a2b4a] text-white flex items-center justify-center flex-shrink-0 font-bold text-sm" id="qNumCircle">1</div>
        <div>
          <p class="text-xs text-[#94a3b8] uppercase tracking-wider mb-1" id="qTypeTxt">اختيار من متعدد</p>
          <p class="font-semibold text-[#1a2b4a] text-base leading-snug" id="qTitle">...</p>
        </div>
      </div>
      <div class="mr-11">
        <p class="text-[#475569] mb-4 text-sm leading-relaxed whitespace-pre-line" id="qContent"></p>
        <div id="optsArea" class="space-y-2"></div>
        <div id="taArea" class="hidden">
          <div class="flex justify-between mb-2"><label class="text-sm font-semibold text-[#475569]">إجابتك</label><span class="text-xs text-[#94a3b8]" id="wc">0 كلمة</span></div>
          <textarea id="userResp" class="w-full border-2 border-[#e2e8f0] rounded-lg p-4 text-sm leading-relaxed min-h-48 resize-y focus:outline-none focus:border-[#3b82f6]" placeholder="اكتب إجابتك هنا..."></textarea>
        </div>
        <div id="spkArea" class="hidden text-center">
          <div id="prepDiv" class="mb-4"><p class="text-sm text-[#475569] mb-2">وقت التحضير</p><div class="text-4xl font-mono font-bold text-[#1a2b4a]" id="prepTxt">0:15</div></div>
          <div id="recDiv" class="hidden">
            <div class="w-20 h-20 rounded-full bg-[#fee2e2] flex items-center justify-center mx-auto mb-4 cursor-pointer" onclick="toggleRec()">
              <i class="fas fa-microphone text-[#ef4444] text-3xl pulse" id="micIco"></i>
            </div>
            <p class="font-semibold text-[#1a2b4a]" id="recStatus">اضغط للتسجيل</p>
            <p class="text-sm text-[#94a3b8] mt-1">وقت الإجابة: <span id="respLeft">0:45</span></p>
          </div>
          <textarea id="spkNotes" class="w-full border-2 border-[#e2e8f0] rounded-lg p-3 text-sm mt-4 min-h-20 resize-none focus:outline-none focus:border-[#3b82f6]" placeholder="ملاحظات اختيارية..."></textarea>
        </div>
      </div>
    </div>
    <div id="fbArea" class="hidden card mb-4 border-r-4"></div>
    <div class="flex justify-between items-center">
      <button onclick="prevQ()" id="prevBtn" class="btn btn-outline" style="visibility:hidden"><i class="fas fa-chevron-right"></i> السابق</button>
      <button onclick="nextQ()" id="nextBtn" class="btn btn-primary">التالي <i class="fas fa-chevron-left"></i></button>
      <button onclick="submitExam()" id="subBtn" class="hidden btn" style="background:#10b981;color:white"><i class="fas fa-check"></i> إنهاء الاختبار</button>
    </div>
  </div>
  <div id="resArea" class="hidden">
    <div class="text-center py-8">
      <div class="w-24 h-24 rounded-full bg-[#dbeafe] flex items-center justify-center mx-auto mb-6"><i class="fas fa-trophy text-[#f59e0b] text-4xl"></i></div>
      <h1 class="text-3xl font-bold text-[#1a2b4a] mb-2">انتهى الاختبار!</h1>
    </div>
    <div class="grid md:grid-cols-3 gap-4 mb-6">
      <div class="card text-center border-r-4 border-[#f59e0b]"><div class="text-3xl font-bold text-[#1a2b4a]" id="rScore">-</div><div class="text-sm text-[#475569] mt-1">الدرجة</div></div>
      <div class="card text-center border-r-4 border-[#10b981]"><div class="text-3xl font-bold text-[#1a2b4a]" id="rPct">-</div><div class="text-sm text-[#475569] mt-1">النسبة</div></div>
      <div class="card text-center border-r-4 border-[#8b5cf6]"><div class="text-3xl font-bold text-[#1a2b4a]" id="rTime">-</div><div class="text-sm text-[#475569] mt-1">الوقت</div></div>
    </div>
    <div class="card mb-6" id="rReview"></div>
    <div class="flex gap-3 justify-center flex-wrap">
      <a href="/practice" class="btn btn-outline"><i class="fas fa-redo"></i> محاولة أخرى</a>
      <a href="/dashboard" class="btn btn-primary"><i class="fas fa-home"></i> لوحة التحكم</a>
    </div>
  </div>
</div>`, `<script>
const params=new URLSearchParams(location.search);
const examType=params.get('type')||'TOEFL',module=params.get('module')||'reading';
let questions=[],curQ=0,sessionId=null,timerInt=null,timeLeft=0,totalTime=0,startTime=Date.now(),answers={},spkPrep=null,spkResp=null,isRec=false;
const modColors={reading:'#f59e0b',listening:'#8b5cf6',speaking:'#ef4444',writing:'#10b981'};
async function init(){
  document.getElementById('examBadge').textContent=examType;
  document.getElementById('examBadge').className='badge '+(examType==='TOEFL'?'badge-toefl':'badge-ielts');
  document.getElementById('modBadge').textContent=module.charAt(0).toUpperCase()+module.slice(1);
  document.getElementById('modBadge').style.background=modColors[module]+'20';
  document.getElementById('modBadge').style.color=modColors[module];
  try{
    const sr=await fetch('/api/sessions/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({exam_type:examType,module})});
    sessionId=(await sr.json()).session_id;
    const qr=await fetch('/api/questions?exam_type='+examType+'&module='+module+'&limit=5');
    questions=(await qr.json()).questions||[];
    if(!questions.length){document.getElementById('loadState').innerHTML='<div class="text-center py-20"><i class="fas fa-exclamation-circle text-4xl text-[#94a3b8] mb-4"></i><p class="text-[#475569]">لا توجد أسئلة متاحة لهذا القسم بعد.</p><a href="/practice" class="btn btn-primary mt-4 inline-flex">رجوع</a></div>';return;}
    document.getElementById('qTot').textContent=questions.length;
    buildDots();
    document.getElementById('loadState').classList.add('hidden');
    document.getElementById('qArea').classList.remove('hidden');
    showQ(0);startTimer();
  }catch(e){document.getElementById('loadState').innerHTML='<p class="text-red-500 text-center py-20">خطأ في التحميل</p>';}
}
function buildDots(){const c=document.getElementById('dots');c.innerHTML=questions.map((_,i)=>'<div class="w-2 h-2 rounded-full bg-[#e2e8f0] dot'+i+'"></div>').join('');}
function setDot(i,s){const d=document.querySelector('.dot'+i);if(!d)return;d.className='w-2 h-2 rounded-full '+(s==='cur'?'bg-[#3b82f6]':s==='ok'?'bg-[#10b981]':s==='bad'?'bg-[#ef4444]':s==='ans'?'bg-[#f59e0b]':'bg-[#e2e8f0]')+' dot'+i;}
function startTimer(){totalTime=(({reading:1200,listening:600,speaking:90,writing:1800})[module]||600)*questions.length;timeLeft=totalTime;timerInt=setInterval(tick,1000);}
function tick(){timeLeft--;const m=Math.floor(timeLeft/60),s=timeLeft%60;document.getElementById('timerTxt').textContent=m+':'+String(s).padStart(2,'0');const p=(timeLeft/totalTime)*100;document.getElementById('timerBar').style.width=p+'%';if(p<20)document.getElementById('timerBar').style.background='linear-gradient(90deg,#f59e0b,#ef4444)';if(timeLeft<=0){clearInterval(timerInt);submitExam();}}
function showQ(i){
  curQ=i;const q=questions[i];setDot(i,'cur');
  document.getElementById('qNum').textContent=i+1;document.getElementById('qNumCircle').textContent=i+1;
  document.getElementById('qTitle').textContent=q.title;
  document.getElementById('qTypeTxt').textContent=(q.question_type||'').replace(/_/g,' ').toUpperCase();
  document.getElementById('qContent').textContent=q.content;
  if(q.passage){document.getElementById('passageBox').classList.remove('hidden');document.getElementById('passageTxt').textContent=q.passage;}
  else{document.getElementById('passageBox').classList.add('hidden');}
  document.getElementById('fbArea').classList.add('hidden');
  ['optsArea','taArea','spkArea'].forEach(id=>document.getElementById(id).classList.add('hidden'));
  if(module==='speaking'){document.getElementById('spkArea').classList.remove('hidden');startSpeaking(q);}
  else if(module==='writing'){document.getElementById('taArea').classList.remove('hidden');const ta=document.getElementById('userResp');ta.value=answers[i]||'';ta.oninput=()=>{answers[i]=ta.value;const w=ta.value.trim().split(/\s+/).filter(x=>x).length;document.getElementById('wc').textContent=w+' كلمة';};}
  else if(q.options){
    document.getElementById('optsArea').classList.remove('hidden');
    const opts=typeof q.options==='string'?JSON.parse(q.options):q.options;
    const lbls=['أ','ب','ج','د','هـ'];
    document.getElementById('optsArea').innerHTML=opts.map((o,j)=>'<button class="w-full text-right p-3 border-2 rounded-lg cursor-pointer transition-all text-sm flex items-start gap-3 '+(answers[i]===o?'border-[#3b82f6] bg-[#eff6ff]':'border-[#e2e8f0] bg-white hover:border-[#3b82f6] hover:bg-[#f0f9ff]')+'" onclick="selOpt(this,\''+o.replace(/'/g,"\\'")+'\')" data-val="'+o.replace(/"/g,'&quot;')+'"><span class="w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center text-xs font-bold border-current">'+lbls[j]+'</span><span>'+o+'</span></button>').join('');
  }
  document.getElementById('prevBtn').style.visibility=i>0?'visible':'hidden';
  document.getElementById('nextBtn').classList.toggle('hidden',i>=questions.length-1);
  document.getElementById('subBtn').classList.toggle('hidden',i<questions.length-1);
}
function selOpt(btn,val){document.querySelectorAll('#optsArea button').forEach(b=>{b.className='w-full text-right p-3 border-2 rounded-lg cursor-pointer transition-all text-sm flex items-start gap-3 border-[#e2e8f0] bg-white hover:border-[#3b82f6] hover:bg-[#f0f9ff]';});btn.className='w-full text-right p-3 border-2 rounded-lg cursor-pointer transition-all text-sm flex items-start gap-3 border-[#3b82f6] bg-[#eff6ff]';answers[curQ]=val;}
async function nextQ(){await submitAns();if(curQ<questions.length-1)showQ(curQ+1);}
function prevQ(){if(curQ>0)showQ(curQ-1);}
async function submitAns(){
  if(!sessionId)return;const q=questions[curQ];
  const ans=answers[curQ]||(module==='writing'?document.getElementById('userResp')?.value:null)||(module==='speaking'?document.getElementById('spkNotes')?.value||'Speaking recorded':null);
  if(!ans)return;
  const res=await fetch('/api/sessions/'+sessionId+'/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question_id:q.id,answer:ans,time_spent:Math.round((Date.now()-startTime)/1000)})});
  const d=await res.json();
  if(d.is_correct!==null){
    const fb=document.getElementById('fbArea');fb.classList.remove('hidden');
    if(d.is_correct){fb.className='card mb-4 border-r-4 border-green-500 bg-green-50';fb.innerHTML='<div class="flex items-start gap-3"><i class="fas fa-check-circle text-2xl text-green-500 mt-0.5"></i><div><p class="font-bold text-green-700">إجابة صحيحة! ✅</p><p class="text-sm text-[#475569] mt-1">'+( d.explanation||'')+'</p></div></div>';}
    else{fb.className='card mb-4 border-r-4 border-red-500 bg-red-50';fb.innerHTML='<div class="flex items-start gap-3"><i class="fas fa-times-circle text-2xl text-red-500 mt-0.5"></i><div><p class="font-bold text-red-700">إجابة خاطئة ❌</p><p class="text-sm text-[#475569] mt-1">الإجابة الصحيحة: <strong>'+d.correct_answer+'</strong></p>'+(d.explanation?'<p class="text-sm text-[#475569] mt-1">'+d.explanation+'</p>':'')+'</div></div>';}
    document.querySelectorAll('#optsArea button').forEach(b=>{if(b.dataset.val===d.correct_answer)b.className='w-full text-right p-3 border-2 rounded-lg text-sm flex items-start gap-3 border-green-500 bg-green-50';else if(b.className.includes('eff6ff'))b.className='w-full text-right p-3 border-2 rounded-lg text-sm flex items-start gap-3 border-red-500 bg-red-50';});
    setDot(curQ,d.is_correct?'ok':'bad');
  }else{setDot(curQ,'ans');}
}
async function submitExam(){
  clearInterval(timerInt);if(spkPrep)clearInterval(spkPrep);if(spkResp)clearInterval(spkResp);
  await submitAns();
  const tt=Math.round((Date.now()-startTime)/1000);
  const res=await fetch('/api/sessions/'+sessionId+'/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({time_taken:tt})});
  const d=await res.json();
  document.getElementById('qArea').classList.add('hidden');document.getElementById('resArea').classList.remove('hidden');
  const pct=d.max_score>0?Math.round((d.score/d.max_score)*100):null;
  document.getElementById('rScore').textContent=d.max_score>0?d.score.toFixed(1)+'/'+d.max_score.toFixed(1):'مُسلَّم';
  document.getElementById('rPct').textContent=pct!==null?pct+'%':'—';
  document.getElementById('rTime').textContent=Math.floor(tt/60)+'د '+tt%60+'ث';
  document.getElementById('rReview').innerHTML='<h3 class="font-bold text-[#1a2b4a] mb-3">تحليل الأداء</h3><p class="'+(pct>=70?'text-green-600':pct>=50?'text-yellow-600':'text-red-600')+' font-semibold">'+(pct>=70?'ممتاز! أنت على المسار الصحيح 🎯':pct>=50?'جيد! استمر في التدريب 💪':'تحتاج مراجعة أكثر. لا تيأس! 📚')+'</p><div class="grid grid-cols-2 gap-3 mt-3 text-sm"><div class="p-3 bg-[#f8fafc] rounded-lg"><span class="text-[#94a3b8]">الاختبار:</span> <span class="font-semibold">'+examType+'</span></div><div class="p-3 bg-[#f8fafc] rounded-lg"><span class="text-[#94a3b8]">القسم:</span> <span class="font-semibold capitalize">'+module+'</span></div></div>';
}
function startSpeaking(q){const pp=q.content.includes('15')?15:q.content.includes('30')?30:60;let pl=pp;document.getElementById('prepDiv').classList.remove('hidden');document.getElementById('recDiv').classList.add('hidden');document.getElementById('prepTxt').textContent='0:'+String(pl).padStart(2,'0');spkPrep=setInterval(()=>{pl--;document.getElementById('prepTxt').textContent='0:'+String(pl).padStart(2,'0');if(pl<=0){clearInterval(spkPrep);document.getElementById('prepDiv').classList.add('hidden');document.getElementById('recDiv').classList.remove('hidden');startRespTimer(q.time_limit||60);}},1000);}
function startRespTimer(t){let l=t;document.getElementById('respLeft').textContent=Math.floor(l/60)+':'+String(l%60).padStart(2,'0');spkResp=setInterval(()=>{l--;document.getElementById('respLeft').textContent=Math.floor(l/60)+':'+String(l%60).padStart(2,'0');if(l<=0){clearInterval(spkResp);document.getElementById('recStatus').textContent='انتهى الوقت!';}},1000);}
function toggleRec(){isRec=!isRec;document.getElementById('micIco').className='fas '+(isRec?'fa-stop':'fa-microphone')+' text-[#ef4444] text-3xl'+(isRec?'':' pulse');document.getElementById('recStatus').textContent=isRec?'جارٍ التسجيل... اضغط للإيقاف':'تم الإيقاف. اضغط للتسجيل مجدداً';if(!isRec)answers[curQ]=document.getElementById('spkNotes').value||'تم التسجيل';}
function confirmExit(){if(confirm('هل تريد الخروج من الاختبار؟ ستضيع إجاباتك.'))window.location.href='/practice';}
init();
</script>`))
})

// ADMIN PANEL
app.get('/admin', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  if (user.role !== 'admin') return c.redirect('/dashboard')
  return c.html(L('لوحة الإدارة', `
<nav class="navbar">
  <a href="/admin" class="brand"><i class="fas fa-graduation-cap text-[#f59e0b]"></i> The Yamen <span class="g">Guide</span> <span class="text-xs text-[#94a3b8] mr-2 font-normal">إدارة</span></a>
  <div class="flex items-center gap-3">
    <span class="text-[#94a3b8] text-sm hidden sm:block"><i class="fas fa-shield-alt mr-1 text-[#f59e0b]"></i>${user.name}</span>
    <button onclick="fetch('/api/auth/logout',{method:'POST'}).then(()=>location.href='/login')" class="btn btn-outline text-sm py-2 px-3"><i class="fas fa-sign-out-alt"></i> خروج</button>
  </div>
</nav>
<div class="flex">
  <aside class="sidebar" id="sidebar">
    <nav class="py-4">
      <a href="#" onclick="showTab('overview')" id="n-overview" class="active"><i class="fas fa-tachometer-alt w-5"></i> نظرة عامة</a>
      <a href="#" onclick="showTab('codes')" id="n-codes"><i class="fas fa-key w-5"></i> أكواد التفعيل</a>
      <a href="#" onclick="showTab('enrollments')" id="n-enrollments"><i class="fas fa-user-check w-5"></i> الطلاب المسجّلون</a>
      <a href="#" onclick="showTab('users')" id="n-users"><i class="fas fa-users w-5"></i> جميع الطلاب</a>
      <a href="#" onclick="showTab('hours')" id="n-hours"><i class="fas fa-clock w-5"></i> ساعات VIP</a>
      <a href="#" onclick="showTab('questions')" id="n-questions"><i class="fas fa-question-circle w-5"></i> الأسئلة</a>
      <a href="#" onclick="showTab('payments')" id="n-payments"><i class="fas fa-money-bill-wave w-5"></i> طلبات الدفع</a>
      <a href="#" onclick="showTab('admins')" id="n-admins"><i class="fas fa-user-shield w-5"></i> إدارة الأدمن</a>
      <a href="#" onclick="showTab('setup')" id="n-setup"><i class="fas fa-cogs w-5"></i> الإعداد</a>
    </nav>
  </aside>
  <main class="flex-1 p-4 md:p-6 overflow-y-auto">

    <!-- Overview -->
    <div id="t-overview">
      <h1 class="text-2xl font-bold text-[#1a2b4a] mb-6">نظرة عامة على المنصة</h1>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div class="card border-r-4 border-[#3b82f6]"><div class="text-2xl font-bold" id="aStudents">-</div><div class="text-sm text-[#475569] mt-1">الطلاب</div></div>
        <div class="card border-r-4 border-[#10b981]"><div class="text-2xl font-bold" id="aEnroll">-</div><div class="text-sm text-[#475569] mt-1">تسجيلات نشطة</div></div>
        <div class="card border-r-4 border-[#f59e0b]"><div class="text-2xl font-bold" id="aCodes">-</div><div class="text-sm text-[#475569] mt-1">أكواد متاحة</div></div>
        <div class="card border-r-4 border-[#8b5cf6]"><div class="text-2xl font-bold" id="aPayReq">-</div><div class="text-sm text-[#475569] mt-1">طلبات دفع</div></div>
      </div>
      <div class="card">
        <h3 class="font-bold text-[#1a2b4a] mb-4">التسجيلات حسب المسار</h3>
        <div id="aBreakdown"></div>
      </div>
    </div>

    <!-- Codes -->
    <div id="t-codes" class="hidden">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-bold text-[#1a2b4a]">أكواد التفعيل</h1>
      </div>
      <div class="card mb-4">
        <h3 class="font-bold text-[#1a2b4a] mb-4">توليد كود جديد</h3>
        <div class="grid md:grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-semibold text-[#475569] mb-1">المسار</label>
            <select id="genCourse" class="input">
              ${COURSES.map(c => `<option value="${c.code}">${c.name_ar} – ${c.price} د.أ</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-sm font-semibold text-[#475569] mb-1">ملاحظات (اختياري)</label>
            <input id="genNotes" type="text" class="input" placeholder="اسم الطالب أو رقم الفاتورة"/>
          </div>
          <div class="flex items-end">
            <button onclick="genCode()" class="btn btn-primary w-full"><i class="fas fa-plus"></i> توليد الكود</button>
          </div>
        </div>
        <div id="genResult" class="hidden mt-4 p-4 bg-[#f0fdf4] border border-[#86efac] rounded-xl">
          <p class="text-sm text-[#166534] mb-2">✅ تم توليد الكود بنجاح:</p>
          <div class="flex items-center gap-3">
            <div class="font-mono font-bold text-2xl text-[#1a2b4a] bg-white border-2 border-[#10b981] rounded-lg px-4 py-2 tracking-widest" id="genCodeTxt"></div>
            <button onclick="copyCode()" class="btn btn-success text-sm"><i class="fas fa-copy"></i> نسخ</button>
            <button onclick="sendCodeWA()" class="btn btn-wa text-sm"><i class="fab fa-whatsapp"></i> إرسال واتساب</button>
          </div>
        </div>
      </div>
      <div class="card">
        <h3 class="font-bold text-[#1a2b4a] mb-4">سجل الأكواد</h3>
        <div id="codesList" class="overflow-x-auto"></div>
      </div>
    </div>

    <!-- Enrollments -->
    <div id="t-enrollments" class="hidden">
      <h1 class="text-2xl font-bold text-[#1a2b4a] mb-6">الطلاب المسجّلون في المسارات</h1>
      <div class="card overflow-x-auto"><div id="enrollList"></div></div>
    </div>

    <!-- Users -->
    <div id="t-users" class="hidden">
      <h1 class="text-2xl font-bold text-[#1a2b4a] mb-6">جميع الطلاب</h1>
      <div class="card overflow-x-auto"><div id="usersList"></div></div>
    </div>

    <!-- VIP Hours -->
    <div id="t-hours" class="hidden">
      <h1 class="text-2xl font-bold text-[#1a2b4a] mb-6">إدارة ساعات VIP</h1>
      <div class="card mb-4">
        <h3 class="font-bold text-[#1a2b4a] mb-4">تسجيل حصة جديدة</h3>
        <div class="grid md:grid-cols-3 gap-4">
          <div><label class="block text-sm font-semibold text-[#475569] mb-1">ID الطالب</label>
            <input id="hUserId" type="number" class="input" placeholder="رقم ID الطالب"/></div>
          <div><label class="block text-sm font-semibold text-[#475569] mb-1">عدد الساعات</label>
            <input id="hHours" type="number" step="0.5" value="1" min="0.5" class="input"/></div>
          <div><label class="block text-sm font-semibold text-[#475569] mb-1">ملاحظات</label>
            <input id="hNotes" type="text" class="input" placeholder="مثال: حصة تحدث"/></div>
        </div>
        <div id="hMsg" class="hidden mt-3 text-sm p-3 rounded-lg"></div>
        <button onclick="logHours()" class="btn btn-primary mt-4"><i class="fas fa-minus-circle"></i> خصم الساعات</button>
      </div>
      <div class="card"><h3 class="font-bold text-[#1a2b4a] mb-4">طلاب VIP</h3><div id="vipList"></div></div>
    </div>

    <!-- Questions -->
    <div id="t-questions" class="hidden">
      <h1 class="text-2xl font-bold text-[#1a2b4a] mb-6">الأسئلة التدريبية</h1>
      <div class="card mb-4">
        <h3 class="font-bold text-[#1a2b4a] mb-4">إضافة سؤال جديد</h3>
        <div class="grid md:grid-cols-2 gap-4 mb-4">
          <div><label class="block text-sm font-semibold text-[#475569] mb-1">الاختبار</label>
            <select id="aqExam" class="input"><option value="TOEFL">TOEFL iBT</option><option value="IELTS">IELTS</option></select></div>
          <div><label class="block text-sm font-semibold text-[#475569] mb-1">القسم</label>
            <select id="aqMod" class="input"><option value="reading">Reading</option><option value="listening">Listening</option><option value="speaking">Speaking</option><option value="writing">Writing</option></select></div>
          <div><label class="block text-sm font-semibold text-[#475569] mb-1">نوع السؤال</label>
            <select id="aqType" class="input"><option value="multiple_choice">اختيار من متعدد</option><option value="true_false">صح/خطأ</option><option value="independent">مقال حر</option><option value="integrated">مدمج</option></select></div>
          <div><label class="block text-sm font-semibold text-[#475569] mb-1">الصعوبة</label>
            <select id="aqDiff" class="input"><option value="easy">سهل</option><option value="medium">متوسط</option><option value="hard">صعب</option></select></div>
        </div>
        <div class="mb-3"><label class="block text-sm font-semibold text-[#475569] mb-1">عنوان السؤال *</label><input id="aqTitle" type="text" class="input" placeholder="عنوان مختصر"/></div>
        <div class="mb-3"><label class="block text-sm font-semibold text-[#475569] mb-1">نص السؤال / التعليمات *</label><textarea id="aqContent" rows="3" class="input resize-y" placeholder="نص السؤال كاملاً..."></textarea></div>
        <div class="mb-3"><label class="block text-sm font-semibold text-[#475569] mb-1">النص المقروء / التفريغ الصوتي (اختياري)</label><textarea id="aqPassage" rows="4" class="input resize-y" placeholder="النص أو التفريغ..."></textarea></div>
        <div class="mb-3"><label class="block text-sm font-semibold text-[#475569] mb-1">خيارات الإجابة (سطر لكل خيار – للاختيار المتعدد)</label><textarea id="aqOpts" rows="4" class="input resize-y" placeholder="الخيار الأول&#10;الخيار الثاني&#10;الخيار الثالث&#10;الخيار الرابع"></textarea></div>
        <div class="grid md:grid-cols-2 gap-4 mb-3">
          <div><label class="block text-sm font-semibold text-[#475569] mb-1">الإجابة الصحيحة</label><input id="aqAns" type="text" class="input" placeholder="نص الإجابة الصحيحة"/></div>
          <div><label class="block text-sm font-semibold text-[#475569] mb-1">الدرجات</label><input id="aqPts" type="number" value="1" class="input"/></div>
        </div>
        <div class="mb-3"><label class="block text-sm font-semibold text-[#475569] mb-1">الشرح</label><textarea id="aqExp" rows="2" class="input resize-y" placeholder="شرح الإجابة الصحيحة..."></textarea></div>
        <div id="aqErr" class="hidden text-red-600 text-sm bg-red-50 p-3 rounded-lg mb-3"></div>
        <div id="aqSuc" class="hidden text-green-600 text-sm bg-green-50 p-3 rounded-lg mb-3"></div>
        <div class="flex gap-3"><button onclick="addQ()" class="btn btn-primary"><i class="fas fa-save"></i> حفظ السؤال</button><button onclick="resetQ()" class="btn btn-outline"><i class="fas fa-redo"></i> مسح</button></div>
      </div>
      <div class="card"><h3 class="font-bold text-[#1a2b4a] mb-4">الأسئلة المتاحة</h3><div id="qList" class="overflow-x-auto"></div></div>
    </div>

    <!-- Payments -->
    <div id="t-payments" class="hidden">
      <h1 class="text-2xl font-bold text-[#1a2b4a] mb-6">طلبات الدفع</h1>
      <div class="card overflow-x-auto"><div id="payList"></div></div>
    </div>

    <!-- Admins Management -->
    <div id="t-admins" class="hidden">
      <h1 class="text-2xl font-bold text-[#1a2b4a] mb-6">إدارة حسابات الأدمن</h1>
      <div class="grid md:grid-cols-2 gap-6">
        <div class="card">
          <h3 class="font-bold text-[#1a2b4a] mb-4"><i class="fas fa-user-plus text-[#3b82f6] mr-2"></i>إنشاء أدمن جديد</h3>
          <div class="space-y-3">
            <div><label class="block text-sm font-semibold text-[#475569] mb-1">الاسم الكامل</label>
              <input id="adName" type="text" class="input" placeholder="اسم المسؤول"/></div>
            <div><label class="block text-sm font-semibold text-[#475569] mb-1">البريد الإلكتروني</label>
              <input id="adEmail" type="email" class="input" placeholder="admin@domain.com"/></div>
            <div><label class="block text-sm font-semibold text-[#475569] mb-1">كلمة المرور (8 أحرف على الأقل)</label>
              <input id="adPass" type="password" class="input" placeholder="••••••••"/></div>
            <div id="adMsg" class="hidden text-sm p-3 rounded-lg"></div>
            <button onclick="createAdmin()" class="btn btn-primary w-full justify-center"><i class="fas fa-user-shield"></i> إنشاء الحساب</button>
          </div>
        </div>
        <div class="card">
          <h3 class="font-bold text-[#1a2b4a] mb-4"><i class="fas fa-key text-[#f59e0b] mr-2"></i>تغيير كلمة مرور طالب</h3>
          <div class="space-y-3">
            <div><label class="block text-sm font-semibold text-[#475569] mb-1">ID الطالب</label>
              <input id="cpUserId" type="number" class="input" placeholder="رقم ID الطالب من جدول الطلاب"/></div>
            <div><label class="block text-sm font-semibold text-[#475569] mb-1">كلمة المرور الجديدة</label>
              <input id="cpPass" type="password" class="input" placeholder="كلمة المرور الجديدة"/></div>
            <div id="cpMsg" class="hidden text-sm p-3 rounded-lg"></div>
            <button onclick="changePass()" class="btn btn-gold w-full justify-center"><i class="fas fa-key"></i> تغيير كلمة المرور</button>
          </div>
          <div class="mt-4 p-3 bg-[#fef3c7] border border-[#fde68a] rounded-lg text-xs text-[#92400e]">
            <i class="fas fa-exclamation-triangle mr-1"></i>
            احرص على إبلاغ الطالب بكلمة المرور الجديدة عبر الواتساب
          </div>
        </div>
      </div>
    </div>

    <!-- Setup -->
    <div id="t-setup" class="hidden">
      <h1 class="text-2xl font-bold text-[#1a2b4a] mb-6">إعداد قاعدة البيانات</h1>
      <div class="card bg-[#f0fdf4] border-green-200">
        <h3 class="font-bold text-green-800 mb-3"><i class="fas fa-database mr-2"></i>أدوات الإعداد</h3>
        <div class="flex flex-wrap gap-3">
          <button onclick="setupDB()" class="btn btn-primary"><i class="fas fa-database mr-1"></i> تهيئة قاعدة البيانات</button>
        </div>
        <div id="setupMsg" class="mt-3 text-sm hidden"></div>
        <div class="mt-4 p-3 bg-white rounded-lg text-sm text-[#475569]">
          <p class="font-semibold mb-1">بيانات الدخول الافتراضية:</p>
          <p>أدمن: admin@prepmaster.edu / Admin@123</p>
        </div>
      </div>
    </div>

  </main>
</div>`, `<script>
function showTab(t){
  ['overview','codes','enrollments','users','hours','questions','payments','admins','setup'].forEach(x=>{
    document.getElementById('t-'+x)?.classList.add('hidden');
    document.getElementById('n-'+x)?.classList.remove('active');
  });
  document.getElementById('t-'+t)?.classList.remove('hidden');
  document.getElementById('n-'+t)?.classList.add('active');
  const loaders={codes:loadCodes,enrollments:loadEnrollments,users:loadUsers,hours:loadVIP,questions:loadQs,overview:loadStats,payments:loadPayments};
  if(loaders[t])loaders[t]();
}

async function loadStats(){
  const d=await(await fetch('/api/admin/stats')).json();
  document.getElementById('aStudents').textContent=d.students||0;
  document.getElementById('aEnroll').textContent=d.enrollments||0;
  document.getElementById('aCodes').textContent=d.unused_codes||0;
  document.getElementById('aPayReq').textContent=d.payment_requests||0;
  document.getElementById('aBreakdown').innerHTML=(d.breakdown||[]).map(b=>'<div class="flex items-center justify-between py-2 border-b border-[#f1f5f9]"><span class="text-sm font-medium">'+b.name_ar+'</span><span class="font-bold text-[#3b82f6]">'+b.cnt+' طالب</span></div>').join('')||'<p class="text-[#94a3b8] text-center py-4">لا توجد تسجيلات بعد</p>';
}

let lastGenCode='',lastGenCourse='';
async function genCode(){
  const course=document.getElementById('genCourse').value,notes=document.getElementById('genNotes').value;
  const d=await(await fetch('/api/admin/generate-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({course_code:course,notes})})).json();
  if(d.success){
    lastGenCode=d.code;lastGenCourse=document.getElementById('genCourse').options[document.getElementById('genCourse').selectedIndex].text;
    document.getElementById('genCodeTxt').textContent=d.code;
    document.getElementById('genResult').classList.remove('hidden');
    loadCodes();
  }else{alert(d.error);}
}
function copyCode(){navigator.clipboard.writeText(lastGenCode);alert('تم نسخ الكود: '+lastGenCode);}
function sendCodeWA(){
  const msg=encodeURIComponent('🎓 كود التفعيل الخاص بك لـ The Yamen Guide\n\n📚 المسار: '+lastGenCourse+'\n🔑 الكود: '+lastGenCode+'\n\nخطوات التفعيل:\n1️⃣ افتح الموقع: the-yamen-guide.pages.dev\n2️⃣ سجّل الدخول أو أنشئ حساباً جديداً\n3️⃣ اضغط "تفعيل مسار" وأدخل الكود\n\nبالتوفيق! 🌟');
  window.open('https://wa.me/?text='+msg,'_blank');
}

async function loadCodes(){
  const d=await(await fetch('/api/admin/codes')).json();
  const codes=d.codes||[];
  if(!codes.length){document.getElementById('codesList').innerHTML='<p class="text-[#94a3b8] text-center py-8">لا توجد أكواد بعد</p>';return;}
  document.getElementById('codesList').innerHTML='<table class="w-full text-sm"><thead><tr class="border-b"><th class="text-right py-2 px-2 font-semibold text-[#475569]">الكود</th><th class="text-right py-2 px-2 font-semibold text-[#475569]">المسار</th><th class="text-right py-2 px-2 font-semibold text-[#475569]">الحالة</th><th class="text-right py-2 px-2 font-semibold text-[#475569]">استُخدم بواسطة</th><th class="text-right py-2 px-2 font-semibold text-[#475569]">التاريخ</th></tr></thead><tbody>'+
  codes.map(c=>'<tr class="border-b hover:bg-[#f8fafc]"><td class="py-2 px-2 font-mono font-bold text-[#1a2b4a]">'+c.code+'</td><td class="py-2 px-2 text-xs">'+c.name_ar+'</td><td class="py-2 px-2"><span class="badge '+(c.is_used?'bg-red-100 text-red-700':'bg-green-100 text-green-700')+'">'+(c.is_used?'مُستخدم':'متاح')+'</span></td><td class="py-2 px-2 text-xs text-[#475569]">'+(c.used_by_name||'—')+'</td><td class="py-2 px-2 text-xs text-[#94a3b8]">'+(c.created_at?new Date(c.created_at).toLocaleDateString('ar'):'')+'</td></tr>'
  ).join('')+'</tbody></table>';
}

async function loadEnrollments(){
  const d=await(await fetch('/api/admin/enrollments')).json();
  const e=d.enrollments||[];
  if(!e.length){document.getElementById('enrollList').innerHTML='<p class="text-[#94a3b8] text-center py-8">لا توجد تسجيلات بعد</p>';return;}
  document.getElementById('enrollList').innerHTML='<table class="w-full text-sm"><thead><tr class="border-b"><th class="text-right py-2 px-2 font-semibold text-[#475569]">الطالب</th><th class="text-right py-2 px-2 font-semibold text-[#475569]">المسار</th><th class="text-right py-2 px-2 font-semibold text-[#475569]">الساعات</th><th class="text-right py-2 px-2 font-semibold text-[#475569]">تاريخ التفعيل</th></tr></thead><tbody>'+
  e.map(x=>'<tr class="border-b hover:bg-[#f8fafc]"><td class="py-2 px-2"><div class="font-medium">'+x.student_name+'</div><div class="text-xs text-[#94a3b8]">'+x.email+'</div></td><td class="py-2 px-2 text-xs">'+x.name_ar+'</td><td class="py-2 px-2 text-xs">'+(x.total_hours?'<div class="font-bold text-[#f59e0b]">'+x.remaining_hours+'/'+x.total_hours+' ساعة</div>':'—')+'</td><td class="py-2 px-2 text-xs text-[#94a3b8]">'+(x.activated_at?new Date(x.activated_at).toLocaleDateString('ar'):'')+'</td></tr>'
  ).join('')+'</tbody></table>';
}

async function loadUsers(){
  const d=await(await fetch('/api/admin/users')).json();
  const u=d.users||[];
  document.getElementById('usersList').innerHTML='<table class="w-full text-sm"><thead><tr class="border-b"><th class="text-right py-2 px-2 font-semibold text-[#475569]">الاسم</th><th class="text-right py-2 px-2 font-semibold text-[#475569]">الإيميل</th><th class="text-right py-2 px-2 font-semibold text-[#475569]">الدور</th><th class="text-right py-2 px-2 font-semibold text-[#475569]">التسجيلات</th><th class="text-right py-2 px-2 font-semibold text-[#475569]">ID</th></tr></thead><tbody>'+
  u.map(x=>'<tr class="border-b hover:bg-[#f8fafc]"><td class="py-2 px-2 font-medium">'+x.name+'</td><td class="py-2 px-2 text-xs text-[#475569]">'+x.email+'</td><td class="py-2 px-2"><span class="badge '+(x.role==='admin'?'bg-purple-100 text-purple-700':'bg-blue-100 text-blue-700')+'">'+x.role+'</span></td><td class="py-2 px-2 font-bold text-[#3b82f6]">'+( x.enrollments||0)+'</td><td class="py-2 px-2 text-xs text-[#94a3b8]">#'+x.id+'</td></tr>'
  ).join('')+'</tbody></table>';
}

async function loadVIP(){
  const d=await(await fetch('/api/admin/enrollments')).json();
  const vips=(d.enrollments||[]).filter(e=>e.total_hours);
  if(!vips.length){document.getElementById('vipList').innerHTML='<p class="text-[#94a3b8] text-center py-8">لا يوجد طلاب VIP بعد</p>';return;}
  document.getElementById('vipList').innerHTML=vips.map(v=>{
    const pct=Math.round((v.remaining_hours/v.total_hours)*100);
    return '<div class="p-4 border border-[#e2e8f0] rounded-xl mb-3"><div class="flex justify-between items-start mb-2"><div><p class="font-bold">'+v.student_name+'</p><p class="text-xs text-[#475569]">'+v.email+' | ID: '+v.user_id+'</p></div><span class="badge badge-vip">'+v.remaining_hours+' / '+v.total_hours+' ساعة</span></div><div class="w-full bg-[#f1f5f9] rounded-full h-3 mb-1"><div class="h-3 rounded-full bg-[#f59e0b]" style="width:'+pct+'%"></div></div><p class="text-xs text-[#94a3b8]">استُخدم '+v.used_hours+' ساعة</p></div>';
  }).join('');
}

async function logHours(){
  const uid=document.getElementById('hUserId').value,hours=parseFloat(document.getElementById('hHours').value),notes=document.getElementById('hNotes').value;
  const msg=document.getElementById('hMsg');
  if(!uid||!hours){msg.textContent='الرجاء إدخال ID الطالب وعدد الساعات';msg.className='text-red-600 text-sm bg-red-50 p-3 rounded-lg mt-3';msg.classList.remove('hidden');return;}
  const d=await(await fetch('/api/admin/log-hours',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:parseInt(uid),hours,notes})})).json();
  if(d.success){msg.textContent='✅ تم خصم '+hours+' ساعة. المتبقي: '+d.remaining+' ساعة';msg.className='text-green-600 text-sm bg-green-50 p-3 rounded-lg mt-3';msg.classList.remove('hidden');loadVIP();}
  else{msg.textContent='❌ '+d.error;msg.className='text-red-600 text-sm bg-red-50 p-3 rounded-lg mt-3';msg.classList.remove('hidden');}
}

async function loadQs(){
  const d=await(await fetch('/api/admin/questions')).json();
  const qs=d.questions||[];
  if(!qs.length){document.getElementById('qList').innerHTML='<p class="text-[#94a3b8] text-center py-8">لا توجد أسئلة بعد</p>';return;}
  document.getElementById('qList').innerHTML='<table class="w-full text-sm"><thead><tr class="border-b"><th class="text-right py-2 px-2 text-[#475569]">العنوان</th><th class="text-right py-2 px-2 text-[#475569]">الاختبار</th><th class="text-right py-2 px-2 text-[#475569]">القسم</th><th class="text-right py-2 px-2 text-[#475569]">الحالة</th><th class="py-2 px-2"></th></tr></thead><tbody>'+
  qs.map(q=>'<tr class="border-b hover:bg-[#f8fafc]"><td class="py-2 px-2 font-medium text-xs">'+q.title.substring(0,35)+'...</td><td class="py-2 px-2"><span class="badge '+(q.exam_type==='TOEFL'?'badge-toefl':'badge-ielts')+'">'+q.exam_type+'</span></td><td class="py-2 px-2 text-xs capitalize">'+q.module+'</td><td class="py-2 px-2"><span class="text-xs font-semibold '+(q.is_active?'text-green-600':'text-red-500')+'">'+(q.is_active?'نشط':'معطّل')+'</span></td><td class="py-2 px-2"><button onclick="delQ('+q.id+')" class="text-red-400 hover:text-red-600 text-xs"><i class="fas fa-trash"></i></button></td></tr>'
  ).join('')+'</tbody></table>';
}
async function delQ(id){if(!confirm('تعطيل هذا السؤال؟'))return;await fetch('/api/admin/questions/'+id,{method:'DELETE'});loadQs();}
async function addQ(){
  const err=document.getElementById('aqErr'),suc=document.getElementById('aqSuc');
  err.classList.add('hidden');suc.classList.add('hidden');
  const opts=document.getElementById('aqOpts').value.trim();
  const b={exam_type:document.getElementById('aqExam').value,module:document.getElementById('aqMod').value,question_type:document.getElementById('aqType').value,difficulty:document.getElementById('aqDiff').value,title:document.getElementById('aqTitle').value,content:document.getElementById('aqContent').value,passage:document.getElementById('aqPassage').value||null,options:opts?opts.split('\n').map(o=>o.trim()).filter(o=>o):null,correct_answer:document.getElementById('aqAns').value||null,explanation:document.getElementById('aqExp').value||null,points:parseFloat(document.getElementById('aqPts').value)||1};
  if(!b.title||!b.content){err.textContent='العنوان والمحتوى مطلوبان';err.classList.remove('hidden');return;}
  const d=await(await fetch('/api/admin/questions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)})).json();
  if(d.success){suc.textContent='✅ تم حفظ السؤال برقم #'+d.id;suc.classList.remove('hidden');resetQ();}
  else{err.textContent=d.error||'خطأ';err.classList.remove('hidden');}
}
function resetQ(){['aqTitle','aqContent','aqPassage','aqOpts','aqAns','aqExp'].forEach(id=>document.getElementById(id).value='');document.getElementById('aqPts').value='1';}
async function loadPayments(){
  const d=await(await fetch('/api/admin/payment-requests')).json();
  const reqs=d.requests||[];
  if(!reqs.length){document.getElementById('payList').innerHTML='<p class="text-[#94a3b8] text-center py-8">لا توجد طلبات دفع بعد</p>';return;}
  document.getElementById('payList').innerHTML='<table class="w-full text-sm"><thead><tr class="border-b"><th class="text-right py-2 px-2 text-[#475569]">الطالب</th><th class="text-right py-2 px-2 text-[#475569]">المسار</th><th class="text-right py-2 px-2 text-[#475569]">المبلغ</th><th class="text-right py-2 px-2 text-[#475569]">طريقة الدفع</th><th class="text-right py-2 px-2 text-[#475569]">الحالة</th><th class="text-right py-2 px-2 text-[#475569]">التاريخ</th><th class="py-2 px-2"></th></tr></thead><tbody>'+
  reqs.map(r=>'<tr class="border-b hover:bg-[#f8fafc]"><td class="py-2 px-2"><div class="font-medium">'+(r.student_name||'زائر')+'</div><div class="text-xs text-[#94a3b8]">'+(r.email||'—')+'</div></td><td class="py-2 px-2 text-xs">'+r.name_ar+'</td><td class="py-2 px-2 font-bold text-[#3b82f6]">'+r.amount+' د.أ</td><td class="py-2 px-2 text-xs">'+(r.payment_method||'—')+'</td><td class="py-2 px-2"><span class="badge '+(r.status==='approved'?'bg-green-100 text-green-700':'bg-yellow-100 text-yellow-700')+'">'+(r.status==='approved'?'موافق عليه':'قيد الانتظار')+'</span></td><td class="py-2 px-2 text-xs text-[#94a3b8]">'+(r.created_at?new Date(r.created_at).toLocaleDateString('ar'):'')+'</td><td class="py-2 px-2">'+(r.status!=='approved'?'<button onclick="approvePayment('+r.id+')" class="btn btn-success text-xs py-1 px-2"><i class="fas fa-check"></i> قبول</button>':'')+'</td></tr>'
  ).join('')+'</tbody></table>';
}
async function approvePayment(id){
  await fetch('/api/admin/payment-requests/'+id+'/approve',{method:'POST'});
  loadPayments();
}

async function createAdmin(){
  const name=document.getElementById('adName').value,email=document.getElementById('adEmail').value,password=document.getElementById('adPass').value;
  const msg=document.getElementById('adMsg');
  msg.classList.add('hidden');
  if(!name||!email||!password){msg.textContent='جميع الحقول مطلوبة';msg.className='text-red-600 text-sm bg-red-50 p-3 rounded-lg';msg.classList.remove('hidden');return;}
  const d=await(await fetch('/api/admin/create-admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email,password})})).json();
  if(d.success){msg.textContent='✅ '+d.message;msg.className='text-green-600 text-sm bg-green-50 p-3 rounded-lg';['adName','adEmail','adPass'].forEach(id=>document.getElementById(id).value='');}
  else{msg.textContent='❌ '+d.error;msg.className='text-red-600 text-sm bg-red-50 p-3 rounded-lg';}
  msg.classList.remove('hidden');
}

async function changePass(){
  const uid=document.getElementById('cpUserId').value,pass=document.getElementById('cpPass').value;
  const msg=document.getElementById('cpMsg');
  msg.classList.add('hidden');
  if(!uid||!pass){msg.textContent='يرجى إدخال ID الطالب وكلمة المرور';msg.className='text-red-600 text-sm bg-red-50 p-3 rounded-lg';msg.classList.remove('hidden');return;}
  const d=await(await fetch('/api/admin/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target_user_id:parseInt(uid),new_password:pass})})).json();
  if(d.success){msg.textContent='✅ تم تغيير كلمة المرور بنجاح';msg.className='text-green-600 text-sm bg-green-50 p-3 rounded-lg';}
  else{msg.textContent='❌ '+d.error;msg.className='text-red-600 text-sm bg-red-50 p-3 rounded-lg';}
  msg.classList.remove('hidden');
}

async function setupDB(){
  const btn=event.target;btn.disabled=true;btn.textContent='جارٍ الإعداد...';
  const msg=document.getElementById('setupMsg');
  const d=await(await fetch('/api/setup')).json();
  msg.textContent=d.success?'✅ '+d.message:'❌ '+d.error;
  msg.className='mt-3 text-sm p-3 rounded-lg '+(d.success?'bg-green-50 text-green-700':'bg-red-50 text-red-600');
  msg.classList.remove('hidden');
  btn.disabled=false;btn.innerHTML='<i class="fas fa-database mr-1"></i> تهيئة قاعدة البيانات';
  loadStats();
}
loadStats();
</script>`))
})

// ==================== LANDING PAGE ====================
app.get('/', async (c) => {
  const user = await getUser(c)
  if (user) return c.redirect(user.role === 'admin' ? '/admin' : '/dashboard')

  const courseCards = [
    {code:'IELTS_FULL',icon:'fa-globe',color:'#0ea5e9',bg:'#dbeafe',name:'IELTS الكامل',price:'150',label:'IELTS'},
    {code:'TOEFL_FULL',icon:'fa-university',color:'#ef4444',bg:'#fee2e2',name:'TOEFL iBT الكامل',price:'180',label:'TOEFL'},
    {code:'FOUNDATIONS',icon:'fa-layer-group',color:'#8b5cf6',bg:'#ede9fe',name:'التأسيس اللغوي',price:'150',label:'أساسيات'},
    {code:'PRIVATE_VIP',icon:'fa-crown',color:'#f59e0b',bg:'#fef3c7',name:'خاص VIP',price:'400',label:'VIP'},
  ].map(co =>
    '<div class="card course-card hover:shadow-lg border-2 transition-all cursor-pointer" onclick="window.location=\'/courses#' + co.code + '\'">' +
    '<div class="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style="background:' + co.bg + '">' +
    '<i class="fas ' + co.icon + ' text-xl" style="color:' + co.color + '"></i></div>' +
    '<span class="badge text-xs font-bold mb-2 inline-block" style="background:' + co.bg + ';color:' + co.color + '">' + co.label + '</span>' +
    '<h3 class="font-bold text-[#1a2b4a] mb-1">' + co.name + '</h3>' +
    '<div class="text-2xl font-bold mt-2" style="color:' + co.color + '">' + co.price + ' <span class="text-sm font-semibold text-[#475569]">د.أ</span></div>' +
    '<button class="btn w-full justify-center mt-3 text-sm py-2" style="background:' + co.color + ';color:white"><i class="fas fa-info-circle"></i> التفاصيل</button></div>'
  ).join('')

  const featureCards = [
    {icon:'fa-chalkboard-teacher',color:'#3b82f6',title:'مدرب متخصص',desc:'تدريب مباشر مع مدرب ذو خبرة في IELTS وTOEFL iBT لسنوات طويلة'},
    {icon:'fa-laptop',color:'#10b981',title:'اختبارات محاكاة',desc:'اختبارات تدريبية تحاكي الامتحان الحقيقي بالتوقيت والأسئلة'},
    {icon:'fa-comments',color:'#f59e0b',title:'متابعة مستمرة',desc:'تواصل مباشر مع المدرب عبر الواتساب وتغذية راجعة فورية'},
    {icon:'fa-lock-open',color:'#8b5cf6',title:'وصول فوري',desc:'فور تفعيل الكود تحصل على وصول فوري لجميع مواد المسار'},
    {icon:'fa-mobile-alt',color:'#ef4444',title:'يعمل على موبايل',desc:'منصة متجاوبة تعمل على الموبايل والكمبيوتر بشكل مثالي'},
    {icon:'fa-shield-alt',color:'#0ea5e9',title:'دفع آمن',desc:'دفع محلي عبر Zain Cash وCliQ مع ضمان استلام الكود'},
  ].map(f =>
    '<div class="card"><div class="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style="background:' + f.color + '20">' +
    '<i class="fas ' + f.icon + ' text-xl" style="color:' + f.color + '"></i></div>' +
    '<h3 class="font-bold text-[#1a2b4a] mb-1">' + f.title + '</h3>' +
    '<p class="text-sm text-[#475569]">' + f.desc + '</p></div>'
  ).join('')

  return c.html(L('منصة The Yamen Guide – IELTS & TOEFL iBT', `
<nav class="navbar">
  <a href="/" class="brand"><i class="fas fa-graduation-cap text-[#f59e0b]"></i> The Yamen <span class="g">Guide</span></a>
  <div class="flex items-center gap-3">
    <a href="/courses" class="text-[#94a3b8] hover:text-white text-sm hidden sm:block">الأسعار</a>
    <a href="/books" class="text-[#94a3b8] hover:text-white text-sm hidden sm:block"><i class="fas fa-book mr-1"></i>الكتب</a>
    <a href="/login" class="btn btn-primary text-sm">دخول / تسجيل</a>
  </div>
</nav>
<section class="bg-gradient-to-br from-[#0f1e35] to-[#1a2b4a] text-white py-16 px-4">
  <div class="max-w-5xl mx-auto text-center">
    <div class="inline-flex items-center gap-2 bg-[#f59e0b]/20 border border-[#f59e0b]/40 rounded-full px-4 py-1.5 mb-6 text-[#f59e0b] text-sm font-semibold">
      <i class="fas fa-star"></i> منصة تدريبية متخصصة في الأردن
    </div>
    <h1 class="text-4xl md:text-5xl font-bold mb-4 leading-tight">حقّق درجتك المطلوبة في<br/><span class="text-[#0ea5e9]">IELTS</span> و <span class="text-[#ef4444]">TOEFL iBT</span></h1>
    <p class="text-[#94a3b8] text-lg mb-8 max-w-2xl mx-auto">تدريب احترافي مع مدرب متخصص، مواد عالية الجودة، ومحاكاة حقيقية للاختبار. المنصة تستهدف الطلاب في الأردن والمنطقة العربية.</p>
    <div class="flex flex-col sm:flex-row gap-4 justify-center">
      <a href="/login" class="btn btn-gold py-3 px-8 text-base"><i class="fas fa-rocket"></i> ابدأ الآن</a>
      <a href="/courses" class="btn btn-outline py-3 px-8 text-base" style="color:white;border-color:rgba(255,255,255,.3)"><i class="fas fa-tag"></i> عرض الأسعار</a>
    </div>
    <div class="grid grid-cols-3 gap-6 mt-12 max-w-xl mx-auto">
      <div><div class="text-3xl font-bold text-[#f59e0b]">100+</div><div class="text-[#94a3b8] text-sm mt-1">طالب مستفيد</div></div>
      <div><div class="text-3xl font-bold text-[#0ea5e9]">4</div><div class="text-[#94a3b8] text-sm mt-1">أقسام تدريبية</div></div>
      <div><div class="text-3xl font-bold text-[#10b981]">7+</div><div class="text-[#94a3b8] text-sm mt-1">Band مضمون IELTS</div></div>
    </div>
  </div>
</section>
<section class="py-12 px-4 bg-white">
  <div class="max-w-5xl mx-auto">
    <h2 class="text-2xl font-bold text-[#1a2b4a] text-center mb-2">المسارات المتاحة</h2>
    <p class="text-[#475569] text-center mb-8">اختر المسار المناسب لهدفك</p>
    <div class="grid md:grid-cols-2 lg:grid-cols-4 gap-4">${courseCards}</div>
    <div class="text-center mt-6">
      <a href="/courses" class="btn btn-primary px-8 py-3"><i class="fas fa-th-list"></i> عرض جميع المسارات والأسعار</a>
    </div>
  </div>
</section>
<section class="py-12 px-4 bg-[#f8fafc]">
  <div class="max-w-5xl mx-auto">
    <h2 class="text-2xl font-bold text-[#1a2b4a] text-center mb-8">لماذا The Yamen Guide؟</h2>
    <div class="grid md:grid-cols-3 gap-6">${featureCards}</div>
  </div>
</section>
<section class="py-12 px-4 bg-gradient-to-r from-[#1a2b4a] to-[#0f1e35] text-white text-center">
  <div class="max-w-2xl mx-auto">
    <h2 class="text-2xl font-bold mb-3">ابدأ رحلتك اليوم</h2>
    <p class="text-[#94a3b8] mb-6">سجّل حسابك مجاناً وابدأ التدريب. كود التفعيل يصلك بعد الدفع عبر الواتساب.</p>
    <div class="flex flex-col sm:flex-row gap-4 justify-center">
      <a href="/login" class="btn btn-gold py-3 px-8 text-base"><i class="fas fa-user-plus"></i> إنشاء حساب مجاني</a>
      <a href="https://wa.me/962798919150?text=%D8%A3%D8%B1%D9%8A%D8%AF%20%D8%A7%D9%84%D8%A7%D8%B3%D8%AA%D9%81%D8%B3%D8%A7%D8%B1" target="_blank" class="btn btn-wa py-3 px-8 text-base"><i class="fab fa-whatsapp"></i> تواصل معنا</a>
    </div>
  </div>
</section>
<footer class="bg-[#0f1e35] text-[#475569] text-center py-6 text-sm">
  <p>© 2026 The Yamen Guide – منصة تدريبية متخصصة في الأردن</p>
  <p class="mt-1">للتواصل: <a href="https://wa.me/962798919150" class="text-[#25d366] hover:underline">0798919150</a></p>
</footer>
`))
})

app.use('/static/*', serveStatic({ root: './' }))

export default app
