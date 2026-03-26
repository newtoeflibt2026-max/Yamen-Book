# PrepMaster - TOEFL & IELTS Preparation Platform

## Project Overview
- **Name**: PrepMaster
- **Goal**: A professional educational platform helping students prepare for TOEFL iBT and IELTS Academic exams
- **Tech Stack**: Hono + TypeScript + Cloudflare D1 + TailwindCSS (CDN)

## Live URL
- **Local Development**: http://localhost:3000
- **Production**: Deploy to Cloudflare Pages

## Features Implemented

### Student Features
- ✅ **Authentication** - Secure register/login with session cookies (SHA-256 hashed passwords)
- ✅ **Student Dashboard** - Overview with stats, quick access to modules, recent activity
- ✅ **Practice Module Selection** - Choose TOEFL or IELTS, then any of 4 modules
- ✅ **Reading Module** - Passage + comprehension questions with instant feedback
- ✅ **Listening Module** - Transcript-based questions simulating audio tasks
- ✅ **Speaking Module** - Timed preparation + response timer with notes field
- ✅ **Writing Module** - Full-text essay editor with word counter
- ✅ **Exam Timer** - Countdown timer with color-coded warning bar
- ✅ **Progress Tracking** - Session history, scores, module performance breakdown
- ✅ **Results Screen** - Score, percentage, time taken, performance message

### Admin Features
- ✅ **Admin Panel** - Dedicated panel with sidebar navigation
- ✅ **Overview Dashboard** - Platform stats (users, sessions, questions)
- ✅ **Question Management** - List all questions with filtering by exam/module
- ✅ **Add Questions** - Full form for adding new practice questions
- ✅ **Student Management** - View all registered students with session counts
- ✅ **Database Setup** - One-click DB initialization and seed button

## Demo Accounts

| Role    | Email                       | Password     |
|---------|-----------------------------|--------------|
| Student | student@prepmaster.edu      | Student@123  |
| Admin   | admin@prepmaster.edu        | Admin@123    |

## Navigation
| Path              | Description                  | Auth Required |
|-------------------|------------------------------|---------------|
| `/`               | Redirects to dashboard/login | -             |
| `/login`          | Login & Register             | No            |
| `/dashboard`      | Student Home                 | Student       |
| `/practice`       | Module & Exam selection      | Student       |
| `/exam?type=TOEFL&module=reading` | Practice exam    | Student       |
| `/progress`       | Score history & analytics    | Student       |
| `/admin`          | Admin panel                  | Admin only    |

## API Endpoints
| Method | Endpoint                    | Description              |
|--------|-----------------------------|--------------------------|
| POST   | `/api/auth/login`           | Login                    |
| POST   | `/api/auth/register`        | Register                 |
| POST   | `/api/auth/logout`          | Logout                   |
| GET    | `/api/auth/me`              | Get current user         |
| GET    | `/api/questions`            | Get questions (filtered) |
| POST   | `/api/sessions/start`       | Start practice session   |
| POST   | `/api/sessions/:id/answer`  | Submit answer            |
| POST   | `/api/sessions/:id/complete`| Complete session         |
| GET    | `/api/dashboard/stats`      | User stats               |
| GET    | `/api/admin/users`          | All users (admin)        |
| GET    | `/api/admin/questions`      | All questions (admin)    |
| POST   | `/api/admin/questions`      | Add question (admin)     |
| DELETE | `/api/admin/questions/:id`  | Deactivate question      |
| GET    | `/api/setup`                | Initialize database      |
| GET    | `/api/setup/seed`           | Seed sample questions    |

## Data Architecture
- **Storage**: Cloudflare D1 (SQLite)
- **Tables**: users, practice_sessions, questions, session_answers, auth_sessions

## Deployment to Cloudflare Pages
```bash
# 1. Create D1 database
npx wrangler d1 create toefl-ielts-production

# 2. Update wrangler.jsonc with the database_id

# 3. Apply migrations
npx wrangler d1 migrations apply toefl-ielts-production

# 4. Build and deploy
npm run build
npx wrangler pages deploy dist --project-name toefl-ielts-prep

# 5. Initialize DB via browser
# Visit: https://your-app.pages.dev/api/setup
# Visit: https://your-app.pages.dev/api/setup/seed
```

## Design System
- **Primary**: Navy Blue (#1a2b4a)
- **Accent**: Blue (#3b82f6)
- **Gold**: (#f59e0b) - used for branding highlights
- **Success**: Green (#10b981)
- **Danger**: Red (#ef4444)
- **Background**: Soft Grey (#f8fafc)
- **Responsive**: Works on mobile and desktop

## Last Updated
2026-03-26
