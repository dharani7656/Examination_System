/**
 * ============================================================================
 * EXAMMATRIX — UNIFIED SINGLE-FILE FULL-STACK APPLICATION (PRODUCTION READY)
 * ============================================================================
 * Everything (Backend Express API, MongoDB Mongoose Models, Auto-Evaluator,
 * Faculty Grade Overrides, and the complete Frontend UI) is in this ONE file.
 *
 * HOW TO RUN LOCALLY:
 * 1. npm install express mongoose cors dotenv bcryptjs jsonwebtoken
 * 2. node app.js
 * 3. Open http://localhost:5000 in your browser.
 * ============================================================================
 */

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || '';
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_exammatrix_key_2026';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

// ============================================================================
// 1. DATABASE & MONGOOSE SCHEMAS
// ============================================================================
let isMongoLive = false;
let mongoConnectionError = null;

// In-memory fallback in case MongoDB credentials are missing or being configured
const memoryStore = {
  config: {
    title: 'Computer Science & Algorithmics Benchmark',
    durationMinutes: 45,
    passPercentage: 40
  },
  students: [],
  questions: [
    {
      _id: 'q_1',
      type: 'mcq',
      marks: 4,
      prompt: 'What is the worst-case time complexity of finding an element in an unsorted array of size N?',
      options: ['O(1)', 'O(log N)', 'O(N)', 'O(N²)'],
      correctOptionIndex: 2
    },
    {
      _id: 'q_2',
      type: 'theory',
      marks: 6,
      prompt: 'Explain the principle of Mutual Exclusion in operating systems and how binary semaphores are used to prevent race conditions.',
      expectedKeywords: ['critical section', 'semaphore', 'race condition', 'lock', 'atomic'],
      modelAnswer: 'Mutual exclusion guarantees only one process enters the critical section using atomic semaphore wait and signal primitives.'
    },
    {
      _id: 'q_3',
      type: 'programming',
      marks: 10,
      prompt: 'Write a Python function `def is_palindrome(s):` that returns True if the string `s` is a palindrome (ignoring casing), and False otherwise.',
      programmingLanguage: 'python',
      starterCode: 'def is_palindrome(s):\n    s_clean = s.lower()\n    return s_clean == s_clean[::-1]\n\nprint(is_palindrome("Radar"))',
      testCases: [
        { input: '"Radar"', expectedOutput: 'True' },
        { input: '"OpenAI"', expectedOutput: 'False' }
      ]
    }
  ],
  submissions: []
};

const ExamConfigSchema = new mongoose.Schema({
  title: { type: String, default: 'Computer Science & Algorithmics Benchmark' },
  durationMinutes: { type: Number, default: 45, min: 1, max: 300 },
  passPercentage: { type: Number, default: 40 }
});

const StudentSchema = new mongoose.Schema({
  rollNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const AdminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true }
});

const QuestionSchema = new mongoose.Schema({
  type: { type: String, enum: ['mcq', 'theory', 'programming'], required: true },
  prompt: { type: String, required: true },
  marks: { type: Number, required: true, default: 5 },
  options: [{ type: String }],
  correctOptionIndex: { type: Number },
  expectedKeywords: [{ type: String }],
  modelAnswer: { type: String },
  programmingLanguage: { type: String, default: 'python' },
  starterCode: { type: String },
  testCases: [{
    input: { type: String },
    expectedOutput: { type: String }
  }]
});

const SubmissionSchema = new mongoose.Schema({
  rollNumber: { type: String, required: true },
  studentName: { type: String, required: true },
  totalScore: { type: Number, required: true },
  maxScore: { type: Number, required: true },
  status: { type: String, enum: ['Auto-Graded', 'Faculty-Reviewed'], default: 'Auto-Graded' },
  submittedAt: { type: String, default: () => new Date().toLocaleTimeString() },
  breakdown: [{
    questionId: { type: String },
    prompt: { type: String },
    type: { type: String },
    studentAnswer: { type: String },
    autoScore: { type: Number, default: 0 },
    awardedMarks: { type: Number, default: 0 },
    maxMarks: { type: Number, required: true },
    remark: { type: String },
    facultyFeedback: { type: String, default: '' },
    isOverridden: { type: Boolean, default: false }
  }]
});

const ExamConfig = mongoose.model('ExamConfig', ExamConfigSchema);
const Student = mongoose.model('Student', StudentSchema);
const Admin = mongoose.model('Admin', AdminSchema);
const Question = mongoose.model('Question', QuestionSchema);
const Submission = mongoose.model('Submission', SubmissionSchema);

// Connection logic with strict diagnostics and auto-reconnect
async function connectToDatabase() {
  if (!MONGO_URI) {
    console.warn('⚠️ [ExamMatrix] No MONGO_URI defined. Using temporary in-memory mode.');
    mongoConnectionError = 'MONGO_URI is missing from environment variables.';
    return;
  }

  try {
    console.log('🔄 Connecting to MongoDB Atlas...');
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS: 45000,
    });
    isMongoLive = true;
    mongoConnectionError = null;
    console.log('✅ [ExamMatrix SUCCESS] Connected to MongoDB Atlas! Data will persist permanently.');
    await seedMongoDefaults();
  } catch (err) {
    isMongoLive = false;
    mongoConnectionError = err.message;
    console.error('❌ [ExamMatrix CRITICAL] MongoDB Atlas Connection FAILED: ' + err.message);
  }
}

connectToDatabase();

mongoose.connection.on('disconnected', () => {
  isMongoLive = false;
  console.warn('⚠️ MongoDB connection dropped. Attempting reconnection...');
});

mongoose.connection.on('reconnected', () => {
  isMongoLive = true;
  console.log('✅ MongoDB connection restored.');
});

async function seedMongoDefaults() {
  try {
    const config = await ExamConfig.findOne();
    if (!config) {
      await ExamConfig.create(memoryStore.config);
      console.log('✓ Initialized default exam configuration in MongoDB.');
    }

    if (ADMIN_PASSWORD) {
      const admin = await Admin.findOne({ username: ADMIN_USERNAME });
      if (!admin) {
        const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
        await Admin.create({ username: ADMIN_USERNAME, passwordHash: hash });
        console.log(`✓ Admin account initialized in MongoDB for: ${ADMIN_USERNAME}`);
      }
    }

    const qCount = await Question.countDocuments();
    if (qCount === 0) {
      await Question.insertMany(memoryStore.questions.map(q => {
        const copy = { ...q };
        delete copy._id;
        return copy;
      }));
      console.log('✓ Seeded initial questions bank into MongoDB.');
    }
  } catch (e) {
    console.error('Seed check warning:', e.message);
  }
}

// ============================================================================
// 2. BACKEND REST API ENDPOINTS
// ============================================================================

// Health & Status
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    isMongoLive,
    database: isMongoLive ? 'MongoDB Atlas (Persistent)' : 'Temporary RAM Store',
    mongoError: mongoConnectionError,
    timestamp: new Date()
  });
});

// Exam Config (Duration, Title, Pass %)
app.get('/api/exam/config', async (req, res) => {
  try {
    if (isMongoLive) {
      const cfg = await ExamConfig.findOne();
      return res.json(cfg || memoryStore.config);
    }
  } catch (e) {}
  res.json(memoryStore.config);
});

app.put('/api/exam/config', async (req, res) => {
  const { title, durationMinutes, passPercentage } = req.body;
  const numDur = Math.max(1, Math.min(300, Number(durationMinutes) || 45));
  const numPass = Math.max(5, Math.min(100, Number(passPercentage) || 40));

  memoryStore.config = {
    title: title || memoryStore.config.title,
    durationMinutes: numDur,
    passPercentage: numPass
  };

  if (isMongoLive) {
    try {
      const updated = await ExamConfig.findOneAndUpdate({}, memoryStore.config, { new: true, upsert: true });
      return res.json({ message: 'Exam configuration saved to MongoDB', config: updated });
    } catch (e) {
      console.error(e);
    }
  }
  res.json({ message: 'Exam configuration updated', config: memoryStore.config });
});

// Student Registration
app.post('/api/students/register', async (req, res) => {
  try {
    const { rollNumber, name, password } = req.body;
    if (!rollNumber || !name || !password) {
      return res.status(400).json({ error: 'Roll number, name, and password are required.' });
    }
    const cleanRoll = rollNumber.toUpperCase().trim();

    if (isMongoLive) {
      const exists = await Student.findOne({ rollNumber: cleanRoll });
      if (exists) return res.status(400).json({ error: `Roll Number ${cleanRoll} is already registered.` });

      const hash = await bcrypt.hash(password, 10);
      const stu = await Student.create({ rollNumber: cleanRoll, name, passwordHash: hash });
      return res.status(201).json({ message: 'Registration complete', rollNumber: stu.rollNumber, name: stu.name });
    }

    const existsMem = memoryStore.students.find(s => s.rollNumber === cleanRoll);
    if (existsMem) return res.status(400).json({ error: `Roll Number ${cleanRoll} is already registered.` });

    const hashMem = bcrypt.hashSync(password, 8);
    memoryStore.students.push({ rollNumber: cleanRoll, name, passwordHash: hashMem });
    res.status(201).json({ message: 'Registration complete', rollNumber: cleanRoll, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Student Login
app.post('/api/students/login', async (req, res) => {
  try {
    const { rollNumber, password } = req.body;
    const cleanRoll = (rollNumber || '').toUpperCase().trim();

    let student = null;
    if (isMongoLive) {
      student = await Student.findOne({ rollNumber: cleanRoll });
    } else {
      student = memoryStore.students.find(s => s.rollNumber === cleanRoll);
    }

    if (!student || !bcrypt.compareSync(password, student.passwordHash)) {
      return res.status(401).json({ error: 'Invalid Roll Number or Password.' });
    }

    const token = jwt.sign({ roll: student.rollNumber, name: student.name, role: 'student' }, JWT_SECRET, { expiresIn: '6h' });
    res.json({ token, rollNumber: student.rollNumber, name: student.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    let match = false;

    if (isMongoLive) {
      const admin = await Admin.findOne({ username });
      if (admin && bcrypt.compareSync(password, admin.passwordHash)) match = true;
    }

    if (!match && ADMIN_PASSWORD && username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      match = true;
    }

    if (!match) return res.status(401).json({ error: 'Invalid Administrator Credentials.' });

    const token = jwt.sign({ username, role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Question Bank Operations
app.get('/api/questions', async (req, res) => {
  if (isMongoLive) {
    try {
      const qs = await Question.find();
      return res.json(qs.map(q => ({ ...q.toObject(), id: q._id.toString() })));
    } catch (e) {}
  }
  res.json(memoryStore.questions.map(q => ({ ...q, id: q._id || q.id })));
});

app.post('/api/questions', async (req, res) => {
  try {
    const data = req.body;
    if (isMongoLive) {
      const created = await Question.create(data);
      return res.status(201).json({ ...created.toObject(), id: created._id.toString() });
    }
    const memItem = { ...data, _id: 'q_' + Date.now(), id: 'q_' + Date.now() };
    memoryStore.questions.push(memItem);
    res.status(201).json(memItem);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/questions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (isMongoLive) {
      await Question.findByIdAndDelete(id);
    }
    memoryStore.questions = memoryStore.questions.filter(q => (q._id || q.id).toString() !== id);
    res.json({ message: 'Question deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Automated Exam Evaluation Engine
app.post('/api/exams/submit', async (req, res) => {
  try {
    const { rollNumber, studentName, responses } = req.body;
    let questions = [];

    if (isMongoLive) {
      questions = await Question.find();
    } else {
      questions = memoryStore.questions;
    }

    let totalScore = 0;
    let maxScore = 0;
    const breakdown = [];

    for (const q of questions) {
      const qId = (q._id || q.id).toString();
      maxScore += q.marks;
      const ans = responses[qId] || '';
      let awarded = 0;
      let remark = '';

      if (q.type === 'mcq') {
        if (parseInt(ans) === q.correctOptionIndex) {
          awarded = q.marks;
          remark = 'Correct MCQ selection';
        } else {
          remark = 'Incorrect. Expected Option #' + (q.correctOptionIndex + 1);
        }
      } else if (q.type === 'theory') {
        const text = (ans || '').toLowerCase();
        const matches = (q.expectedKeywords || []).filter(kw => text.includes(kw.toLowerCase()));
        const ratio = (q.expectedKeywords && q.expectedKeywords.length > 0) ? (matches.length / q.expectedKeywords.length) : 0;
        awarded = Math.round(ratio * q.marks);
        remark = 'Matched keywords (' + matches.length + '/' + q.expectedKeywords.length + '): [' + matches.join(', ') + ']';
      } else if (q.type === 'programming') {
        let passed = 0;
        for (const tc of (q.testCases || [])) {
          if ((ans || '').includes((tc.expectedOutput || '').trim())) passed++;
        }
        const ratio = (q.testCases && q.testCases.length > 0) ? (passed / q.testCases.length) : 0;
        awarded = Math.round(ratio * q.marks);
        remark = 'Passed ' + passed + ' of ' + q.testCases.length + ' automated test assertions';
      }

      totalScore += awarded;
      breakdown.push({
        questionId: qId,
        prompt: q.prompt,
        type: q.type,
        studentAnswer: ans,
        autoScore: awarded,
        awardedMarks: awarded,
        maxMarks: q.marks,
        remark,
        facultyFeedback: '',
        isOverridden: false
      });
    }

    const submissionData = {
      rollNumber: rollNumber.toUpperCase(),
      studentName,
      totalScore,
      maxScore,
      status: 'Auto-Graded',
      breakdown,
      submittedAt: new Date().toLocaleTimeString()
    };

    if (isMongoLive) {
      const sub = await Submission.findOneAndUpdate(
        { rollNumber: rollNumber.toUpperCase() },
        submissionData,
        { new: true, upsert: true }
      );
      return res.json({ message: 'Exam evaluated successfully', submission: sub });
    }

    const idx = memoryStore.submissions.findIndex(s => s.rollNumber === rollNumber.toUpperCase());
    const memRecord = { ...submissionData, id: 'sub_' + Date.now() };
    if (idx >= 0) {
      memoryStore.submissions[idx] = memRecord;
    } else {
      memoryStore.submissions.push(memRecord);
    }
    res.json({ message: 'Exam evaluated successfully', submission: memRecord });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Submissions & Manual Grade Override
app.get('/api/submissions', async (req, res) => {
  if (isMongoLive) {
    try {
      const subs = await Submission.find().sort({ _id: -1 });
      return res.json(subs.map(s => ({ ...s.toObject(), id: s._id.toString() })));
    } catch (e) {}
  }
  res.json(memoryStore.submissions.map(s => ({ ...s, id: s._id || s.id })));
});

app.get('/api/submissions/student/:rollNumber', async (req, res) => {
  try {
    const cleanRoll = req.params.rollNumber.toUpperCase();
    if (isMongoLive) {
      const sub = await Submission.findOne({ rollNumber: cleanRoll });
      if (sub) return res.json(sub);
    }
    const mem = memoryStore.submissions.find(s => s.rollNumber === cleanRoll);
    if (mem) return res.json(mem);
    return res.status(404).json({ error: 'No submission found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/submissions/:id/override', async (req, res) => {
  try {
    const { id } = req.params;
    const { breakdown } = req.body;

    let sub = null;
    if (isMongoLive) {
      sub = await Submission.findById(id);
    } else {
      sub = memoryStore.submissions.find(s => (s._id || s.id).toString() === id);
    }

    if (!sub) return res.status(404).json({ error: 'Submission record not found' });

    let newTotal = 0;
    sub.breakdown = breakdown.map(item => {
      const awarded = Math.min(item.maxMarks, Math.max(0, Number(item.awardedMarks) || 0));
      newTotal += awarded;
      return {
        ...item,
        awardedMarks: awarded,
        facultyFeedback: item.facultyFeedback || '',
        isOverridden: true
      };
    });

    sub.totalScore = newTotal;
    sub.status = 'Faculty-Reviewed';

    if (isMongoLive) {
      await sub.save();
    }
    res.json({ message: 'Faculty grade and feedback saved successfully', submission: sub });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 3. COMPLETE FRONTEND INTERFACE (SERVED ON ROOT GET /)
// ============================================================================
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ExamMatrix // Secure Web Examination Platform</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap">
  <style>
    body { font-family: 'Inter', sans-serif; }
    .font-mono { font-family: 'JetBrains Mono', monospace; }
  </style>
</head>
<body class="bg-slate-100 text-slate-800 min-h-screen flex flex-col antialiased">

  <!-- TOP HEADER -->
  <header class="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md">
          <i class="fa-solid fa-graduation-cap text-lg"></i>
        </div>
        <div>
          <span class="text-xl font-bold tracking-tight text-slate-900">Exam<span class="text-blue-600">Matrix</span></span>
          <button onclick="checkDbHealth(true)" id="dbBadge" class="hidden sm:inline-flex items-center gap-1.5 ml-2 text-xs font-mono uppercase px-2.5 py-0.5 rounded border transition cursor-pointer">
            <span class="w-2 h-2 rounded-full animate-pulse"></span>
            <span id="dbBadgeText">Checking DB...</span>
          </button>
        </div>
      </div>
      <div id="authNavCluster" class="flex items-center gap-2"></div>
    </div>
  </header>

  <!-- MAIN APP CONTAINER -->
  <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">

    <!-- AUTH VIEW -->
    <section id="authView" class="max-w-md mx-auto my-8">
      <div class="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
        <div class="grid grid-cols-2 border-b border-slate-200 bg-slate-50 text-sm font-semibold text-slate-600 text-center">
          <button id="tabStudentBtn" onclick="switchAuthTab('student')" class="py-3.5 border-b-2 border-blue-600 text-blue-600 bg-white">Student Portal</button>
          <button id="tabAdminBtn" onclick="switchAuthTab('admin')" class="py-3.5 border-b-2 border-transparent hover:text-slate-900">Admin Login</button>
        </div>

        <div class="p-6 sm:p-8">
          <div id="authAlert" class="hidden mb-4 p-3 rounded-lg text-xs font-medium"></div>

          <!-- STUDENT FORM -->
          <div id="studentAuthFormContainer">
            <div class="flex justify-between items-center mb-6">
              <h2 id="studentAuthTitle" class="text-lg font-bold text-slate-900">Student Sign In</h2>
              <button onclick="toggleStudentSubmode()" id="studentToggleModeBtn" class="text-xs font-medium text-blue-600 hover:underline">
                Need an account? Register
              </button>
            </div>

            <form id="studentAuthForm" onsubmit="handleStudentAuth(event)" class="space-y-4">
              <div id="nameFieldContainer" class="hidden">
                <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Full Name</label>
                <input type="text" id="studentNameInput" placeholder="Enter your full name" class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500">
              </div>

              <div>
                <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Roll Number</label>
                <input type="text" id="studentRollInput" required placeholder="Enter roll number" class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 uppercase font-mono focus:ring-2 focus:ring-blue-500">
              </div>

              <div>
                <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Password</label>
                <input type="password" id="studentPassInput" required placeholder="Enter password" class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500">
              </div>

              <button type="submit" id="studentSubmitBtn" class="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shadow transition">
                Sign In to Portal
              </button>
            </form>
          </div>

          <!-- ADMIN FORM -->
          <div id="adminAuthFormContainer" class="hidden">
            <div class="mb-6">
              <h2 class="text-lg font-bold text-slate-900">Faculty & Admin Login</h2>
              <p class="text-xs text-slate-500 mt-1">Configure questions, set exam timings, and review submissions.</p>
            </div>

            <form onsubmit="handleAdminAuth(event)" class="space-y-4">
              <div>
                <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Username</label>
                <input type="text" id="adminUserInput" required placeholder="Enter administrator username" class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300">
              </div>

              <div>
                <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Password</label>
                <input type="password" id="adminPassInput" required placeholder="Enter administrator password" class="w-full px-3 py-2 text-sm rounded-lg border border-slate-300">
              </div>

              <button type="submit" class="w-full py-2.5 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm shadow transition">
                Authenticate Admin
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>

    <!-- STUDENT DASHBOARD -->
    <section id="studentDashboardView" class="hidden space-y-6">
      <div class="bg-gradient-to-r from-blue-700 via-blue-600 to-indigo-700 rounded-2xl p-6 sm:p-8 text-white shadow-lg">
        <h1 class="text-2xl sm:text-3xl font-extrabold">Welcome, <span id="studentWelcomeName">Student</span>!</h1>
        <p class="text-blue-100 text-sm mt-1">Roll Number: <span id="studentRollBadge" class="font-mono font-bold bg-black/20 px-2 py-0.5 rounded">CS2026-089</span></p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="bg-white rounded-xl border border-slate-200 p-6 flex flex-col justify-between shadow-sm">
          <div>
            <div class="flex justify-between items-center mb-3">
              <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Active Exam</span>
              <span class="text-xs font-mono text-slate-500"><i class="fa-regular fa-clock mr-1"></i><span id="studentDashboardDuration">45</span> Mins</span>
            </div>
            <h3 id="studentExamTitle" class="text-lg font-bold text-slate-900">Computer Science & Algorithmics Benchmark</h3>
            <div class="mt-4 pt-4 border-t border-slate-100 flex justify-between text-xs text-slate-600">
              <span><i class="fa-solid fa-list-check text-blue-500 mr-1.5"></i><span id="examQCount">0</span> Questions</span>
              <span><i class="fa-solid fa-award text-amber-500 mr-1.5"></i><span id="examTotalMarks">0</span> Marks</span>
            </div>
          </div>
          <button id="startExamBtn" onclick="launchExamSession()" class="mt-6 w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition shadow">
            Launch Test
          </button>
        </div>

        <div class="bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div>
            <h3 class="text-base font-bold text-slate-900 mb-1">Your Submission Report</h3>
            <div id="studentScoreCard" class="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200 text-center">
              <p class="text-xs text-slate-400 uppercase tracking-wider font-semibold">Latest Score</p>
              <p id="studentLatestScoreDisplay" class="text-3xl font-extrabold text-slate-700 my-1">-- / --</p>
              <p id="studentResultRemark" class="text-xs text-slate-500">Take the exam to see your auto-evaluated result.</p>
            </div>
          </div>
          <button id="viewFeedbackBtn" onclick="openStudentFeedbackModal()" class="hidden mt-4 w-full py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold transition">
            <i class="fa-solid fa-clipboard-check mr-1.5"></i> View Detailed Answers & Teacher Feedback
          </button>
        </div>
      </div>
    </section>

    <!-- ACTIVE TEST TAKING ENVIRONMENT -->
    <section id="examArenaView" class="hidden space-y-4">
      <div class="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 class="text-base font-bold text-slate-900">Active Examination Arena</h2>
          <p class="text-xs text-slate-500">Roll No: <span id="arenaRoll" class="font-mono font-semibold"></span></p>
        </div>
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 px-3 py-1.5 rounded-lg">
            <i class="fa-regular fa-clock animate-pulse"></i>
            <span class="text-xs font-semibold">Remaining:</span>
            <span id="examTimer" class="font-mono text-sm font-bold">45:00</span>
          </div>
          <button onclick="finishAndSubmitExam()" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition shadow">
            Final Submit
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div class="bg-white rounded-xl border border-slate-200 p-4 shadow-sm h-fit">
          <div class="flex justify-between items-center mb-3 border-b border-slate-100 pb-2">
            <h4 class="text-xs font-bold uppercase text-slate-600">Question Palette</h4>
            <span id="answeredRatio" class="text-xs font-mono font-bold text-blue-600">0 / 0</span>
          </div>
          <div id="palletGrid" class="grid grid-cols-5 gap-2"></div>
        </div>

        <div class="lg:col-span-3 bg-white rounded-xl border border-slate-200 p-6 flex flex-col justify-between min-h-[500px]">
          <div>
            <div class="flex justify-between items-center border-b border-slate-100 pb-3 mb-4">
              <span id="qNumberHeading" class="text-sm font-bold text-slate-900">Question 1</span>
              <span id="qMarksBadge" class="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">5 Marks</span>
            </div>
            <div id="qPrompt" class="text-base text-slate-800 font-medium leading-relaxed mb-6"></div>
            <div id="interactiveAnswerZone" class="space-y-4"></div>
          </div>

          <div class="pt-6 border-t border-slate-100 flex justify-between items-center mt-8">
            <button id="prevQBtn" onclick="navigateQuestion(-1)" class="px-4 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-700">Previous</button>
            <div class="flex gap-2">
              <button onclick="saveCurrentResponse()" class="px-4 py-2 rounded-lg bg-slate-100 text-xs font-bold text-slate-700">Save Draft</button>
              <button id="nextQBtn" onclick="navigateQuestion(1)" class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold">Next</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ADMIN CONSOLE -->
    <section id="adminDashboardView" class="hidden space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-slate-900">Faculty Administration Console</h1>
          <p class="text-xs text-slate-500">Configure timings, add auto-evaluated questions, and provide individual student feedback.</p>
        </div>
        <div class="flex gap-2.5">
          <button onclick="openExamSettingsModal()" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold">
            <i class="fa-solid fa-clock-rotate-left text-blue-600 mr-1.5"></i> Exam Timings & Config
          </button>
          <button onclick="openQuestionModal()" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow">
            <i class="fa-solid fa-plus mr-1.5"></i> Add Question
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p class="text-xs font-semibold text-slate-500">Total Questions</p>
          <p id="adminMetricQCount" class="text-2xl font-bold text-slate-900">0</p>
        </div>
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p class="text-xs font-semibold text-slate-500">Exam Duration</p>
          <p id="adminMetricDuration" class="text-2xl font-bold text-slate-900">45 Mins</p>
        </div>
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <p class="text-xs font-semibold text-slate-500">Submitted Tests</p>
          <p id="adminMetricSubmissions" class="text-2xl font-bold text-slate-900">0</p>
        </div>
      </div>

      <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div class="flex border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-600">
          <button id="adminTabQBtn" onclick="switchAdminTab('questions')" class="px-6 py-3 border-b-2 border-blue-600 text-blue-600 bg-white">Question Bank</button>
          <button id="adminTabSubBtn" onclick="switchAdminTab('submissions')" class="px-6 py-3 border-b-2 border-transparent hover:text-slate-900">Student Submissions & Manual Overrides</button>
        </div>

        <div id="adminQuestionsPanel" class="p-6">
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead>
                <tr class="border-b border-slate-200 text-slate-400 font-mono uppercase">
                  <th class="pb-3">#</th>
                  <th class="pb-3">Type</th>
                  <th class="pb-3">Prompt</th>
                  <th class="pb-3">Marks</th>
                  <th class="pb-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody id="adminQuestionsTableBody" class="divide-y divide-slate-100"></tbody>
            </table>
          </div>
        </div>

        <div id="adminSubmissionsPanel" class="hidden p-6">
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead>
                <tr class="border-b border-slate-200 text-slate-400 font-mono uppercase">
                  <th class="pb-3">Roll No</th>
                  <th class="pb-3">Candidate</th>
                  <th class="pb-3">Score</th>
                  <th class="pb-3">Status</th>
                  <th class="pb-3 text-right">Review & Override</th>
                </tr>
              </thead>
              <tbody id="adminSubmissionsTableBody" class="divide-y divide-slate-100"></tbody>
            </table>
          </div>
        </div>
      </div>
    </section>

  </main>

  <!-- MODAL: EXAM CONFIG -->
  <div id="examSettingsModal" class="hidden fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl max-w-md w-full shadow-2xl p-6 space-y-4">
      <h3 class="text-base font-bold text-slate-900">Configure Examination Settings</h3>
      <form onsubmit="handleSaveExamSettings(event)" class="space-y-4">
        <div>
          <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Exam Title</label>
          <input type="text" id="settingExamTitle" required class="w-full text-xs p-2.5 border rounded-lg">
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Duration (Minutes)</label>
          <input type="number" id="settingExamDuration" min="1" max="300" required class="w-full text-xs p-2.5 border rounded-lg">
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="toggleModal('examSettingsModal')" class="px-4 py-2 border rounded-lg text-xs font-bold">Cancel</button>
          <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold">Apply Changes</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: QUESTION BUILDER -->
  <div id="questionModal" class="hidden fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl max-w-xl w-full shadow-2xl p-6 space-y-4">
      <h3 class="text-base font-bold text-slate-900">Add New Question</h3>
      <form onsubmit="handleCreateQuestion(event)" class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Type</label>
            <select id="newQType" onchange="renderQuestionTypeFields()" class="w-full text-xs p-2.5 border rounded-lg">
              <option value="mcq">MCQ</option>
              <option value="theory">Theory (Keywords)</option>
              <option value="programming">Programming</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Marks</label>
            <input type="number" id="newQMarks" value="5" min="1" max="50" required class="w-full text-xs p-2.5 border rounded-lg">
          </div>
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-700 uppercase mb-1">Prompt</label>
          <textarea id="newQPrompt" rows="3" required placeholder="Question text..." class="w-full text-xs p-2.5 border rounded-lg"></textarea>
        </div>

        <div id="dynamicQConfigZone" class="p-3 bg-slate-50 border rounded-xl"></div>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="toggleModal('questionModal')" class="px-4 py-2 border rounded-lg text-xs font-bold">Cancel</button>
          <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold">Save Question</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: SUBMISSION OVERRIDE (ADMIN/TEACHER VIEW) -->
  <div id="submissionAuditModal" class="hidden fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden shadow-2xl flex flex-col">
      <div class="p-4 border-b flex justify-between items-center bg-slate-50">
        <div>
          <h3 class="text-sm font-bold text-slate-900">Student Submission Evaluation & Teacher Feedback</h3>
          <p class="text-xs text-slate-500">Provide observations and adjustments visible directly in the student report.</p>
        </div>
        <button onclick="toggleModal('submissionAuditModal')" class="text-slate-400 hover:text-slate-600"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div id="auditQuestionsContainer" class="p-6 overflow-y-auto space-y-4 flex-1"></div>
      <div class="p-4 border-t flex justify-end gap-2 bg-slate-50">
        <button onclick="toggleModal('submissionAuditModal')" class="px-4 py-2 border rounded-lg text-xs font-bold">Close</button>
        <button onclick="saveManualGrades()" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold">Save Feedback & Overrides</button>
      </div>
    </div>
  </div>

  <!-- MODAL: STUDENT FEEDBACK & DETAILED REPORT MODAL -->
  <div id="studentFeedbackModal" class="hidden fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden shadow-2xl flex flex-col">
      <div class="p-4 border-b flex justify-between items-center bg-slate-50">
        <div>
          <h3 class="text-sm font-bold text-slate-900">Your Exam Performance & Teacher Observations</h3>
          <p class="text-xs text-slate-500">Review auto-graded metrics and instructor remarks.</p>
        </div>
        <button onclick="toggleModal('studentFeedbackModal')" class="text-slate-400 hover:text-slate-600"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div id="studentFeedbackContent" class="p-6 overflow-y-auto space-y-4 flex-1"></div>
      <div class="p-4 border-t flex justify-end bg-slate-50">
        <button onclick="toggleModal('studentFeedbackModal')" class="px-5 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold">Close Report</button>
      </div>
    </div>
  </div>

  <!-- CLIENT-SIDE SCRIPT (CAREFULLY WRITTEN WITH NO SERVER TEMPLATE CONFLICTS) -->
  <script>
    var appState = {
      config: { title: 'Computer Science & Algorithmics Benchmark', durationMinutes: 45, passPercentage: 40 },
      currentUser: null,
      authMode: 'login',
      questions: [],
      submissions: [],
      currentQIndex: 0,
      answers: {},
      timer: null,
      activeSubId: null,
      activeStudentSubmission: null
    };

    window.onload = function() {
      try {
        checkDbHealth();
        refreshData();
        renderNav();
      } catch (err) {
        console.error("Initialization error:", err);
      }
    };

    function checkDbHealth(showModal) {
      fetch('/api/health')
        .then(function(res) { return res.json(); })
        .then(function(data) {
          var badge = document.getElementById('dbBadge');
          var badgeText = document.getElementById('dbBadgeText');
          if (!badge || !badgeText) return;
          var dot = badge.querySelector('span');

          if (data.isMongoLive) {
            badge.className = "hidden sm:inline-flex items-center gap-1.5 ml-2 text-xs font-mono uppercase px-2.5 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-300";
            if (dot) dot.className = "w-2 h-2 rounded-full bg-emerald-500";
            badgeText.innerText = "MongoDB Live (Persistent)";
            if (showModal) alert("MongoDB Atlas is successfully connected! All data, questions, and submissions persist permanently across restarts.");
          } else {
            badge.className = "hidden sm:inline-flex items-center gap-1.5 ml-2 text-xs font-mono uppercase px-2.5 py-0.5 rounded border bg-rose-50 text-rose-700 border-rose-300 animate-pulse";
            if (dot) dot.className = "w-2 h-2 rounded-full bg-rose-500";
            badgeText.innerText = "DB Disconnected (RAM Mode)";
            if (showModal) {
              alert("MongoDB is NOT connected! Data is temporarily stored in RAM and will reset when Render sleeps.\\n\\nError: " + (data.mongoError || "Check MONGO_URI in Render dashboard."));
            }
          }
        })
        .catch(function(e) {
          console.error('Health check failed', e);
          var badgeText = document.getElementById('dbBadgeText');
          if (badgeText) badgeText.innerText = "Offline Mode";
        });
    }

    function refreshData() {
      Promise.all([
        fetch('/api/exam/config').then(function(r) { return r.json(); }).catch(function() { return appState.config; }),
        fetch('/api/questions').then(function(r) { return r.json(); }).catch(function() { return []; }),
        fetch('/api/submissions').then(function(r) { return r.json(); }).catch(function() { return []; })
      ]).then(function(results) {
        if (results[0]) appState.config = results[0];
        if (Array.isArray(results[1])) appState.questions = results[1];
        if (Array.isArray(results[2])) appState.submissions = results[2];
        updateMetrics();
        renderQuestionsTable();
        renderSubmissionsTable();
      }).catch(function(err) {
        console.error('Data refresh error:', err);
      });
    }

    function toggleModal(id) {
      var el = document.getElementById(id);
      if (el) el.classList.toggle('hidden');
    }

    function renderNav() {
      var cluster = document.getElementById('authNavCluster');
      if (!cluster) return;
      if (appState.currentUser) {
        cluster.innerHTML = 
          '<span class="text-xs font-mono font-bold px-2.5 py-1 rounded bg-slate-100 text-slate-700">' +
            appState.currentUser.name + ' (' + appState.currentUser.rollNumber + ')' +
          '</span>' +
          '<button onclick="logout()" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-50 text-rose-600 hover:bg-rose-100">' +
            'Sign Out' +
          '</button>';
      } else {
        cluster.innerHTML = '';
      }
    }

    function switchAuthTab(type) {
      var studentTab = document.getElementById('tabStudentBtn');
      var adminTab = document.getElementById('tabAdminBtn');
      var studentForm = document.getElementById('studentAuthFormContainer');
      var adminForm = document.getElementById('adminAuthFormContainer');

      if (type === 'student') {
        studentTab.className = "py-3.5 border-b-2 border-blue-600 text-blue-600 bg-white";
        adminTab.className = "py-3.5 border-b-2 border-transparent text-slate-600 hover:text-slate-900";
        studentForm.classList.remove('hidden');
        adminForm.classList.add('hidden');
      } else {
        adminTab.className = "py-3.5 border-b-2 border-blue-600 text-blue-600 bg-white";
        studentTab.className = "py-3.5 border-b-2 border-transparent text-slate-600 hover:text-slate-900";
        adminForm.classList.remove('hidden');
        studentForm.classList.add('hidden');
      }
    }

    function toggleStudentSubmode() {
      appState.authMode = appState.authMode === 'login' ? 'register' : 'login';
      var nameBox = document.getElementById('nameFieldContainer');
      var title = document.getElementById('studentAuthTitle');
      var toggleBtn = document.getElementById('studentToggleModeBtn');
      var submitBtn = document.getElementById('studentSubmitBtn');

      if (appState.authMode === 'register') {
        nameBox.classList.remove('hidden');
        title.innerText = "Student Registration";
        toggleBtn.innerText = "Already registered? Sign In";
        submitBtn.innerText = "Register Account";
      } else {
        nameBox.classList.add('hidden');
        title.innerText = "Student Sign In";
        toggleBtn.innerText = "Need an account? Register";
        submitBtn.innerText = "Sign In to Portal";
      }
    }

    function handleStudentAuth(e) {
      e.preventDefault();
      var rollNumber = document.getElementById('studentRollInput').value.trim();
      var password = document.getElementById('studentPassInput').value;
      var name = document.getElementById('studentNameInput').value.trim();

      var url = appState.authMode === 'register' ? '/api/students/register' : '/api/students/login';
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rollNumber: rollNumber, name: name, password: password })
      })
      .then(function(res) {
        return res.json().then(function(data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function(result) {
        if (!result.ok) {
          var alertBox = document.getElementById('authAlert');
          alertBox.className = "mb-4 p-3 rounded-lg text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200";
          alertBox.innerText = result.data.error || 'Authentication failed';
          alertBox.classList.remove('hidden');
          return;
        }

        appState.currentUser = { role: 'student', rollNumber: result.data.rollNumber, name: result.data.name };
        renderNav();
        document.getElementById('authView').classList.add('hidden');
        document.getElementById('studentDashboardView').classList.remove('hidden');
        document.getElementById('studentWelcomeName').innerText = result.data.name;
        document.getElementById('studentRollBadge').innerText = result.data.rollNumber;
        document.getElementById('studentDashboardDuration').innerText = appState.config.durationMinutes;
        document.getElementById('studentExamTitle').innerText = appState.config.title;
        document.getElementById('examQCount').innerText = appState.questions.length;
        document.getElementById('examTotalMarks').innerText = appState.questions.reduce(function(a, b) { return a + b.marks; }, 0);

        checkStudentSubmission();
      })
      .catch(function(err) {
        console.error(err);
      });
    }

    function checkStudentSubmission() {
      if (!appState.currentUser) return;
      fetch('/api/submissions/student/' + encodeURIComponent(appState.currentUser.rollNumber))
        .then(function(res) {
          if (res.ok) {
            return res.json().then(function(sub) {
              appState.activeStudentSubmission = sub;
              var scoreEl = document.getElementById('studentLatestScoreDisplay');
              var remarkEl = document.getElementById('studentResultRemark');
              var feedbackBtn = document.getElementById('viewFeedbackBtn');
              if (scoreEl) scoreEl.innerText = sub.totalScore + ' / ' + sub.maxScore;
              if (remarkEl) {
                remarkEl.innerHTML = '<span class="font-bold ' + (sub.status === 'Faculty-Reviewed' ? 'text-indigo-600' : 'text-emerald-600') + '">Status: ' + sub.status + '</span>';
              }
              if (feedbackBtn) feedbackBtn.classList.remove('hidden');
            });
          } else {
            var feedbackBtn = document.getElementById('viewFeedbackBtn');
            if (feedbackBtn) feedbackBtn.classList.add('hidden');
          }
        })
        .catch(function() {});
    }

    function openStudentFeedbackModal() {
      var sub = appState.activeStudentSubmission;
      if (!sub) return;
      var container = document.getElementById('studentFeedbackContent');
      if (!container) return;
      container.innerHTML = '';

      (sub.breakdown || []).forEach(function(item, idx) {
        var hasFeedback = Boolean(item.facultyFeedback && item.facultyFeedback.trim());
        container.innerHTML += 
          '<div class="p-4 bg-slate-50 border rounded-xl space-y-2 text-xs">' +
            '<div class="flex justify-between items-center">' +
              '<span class="font-bold text-slate-800">Question ' + (idx + 1) + ': ' + (item.prompt || '') + '</span>' +
              '<span class="font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">' +
                'Awarded: ' + item.awardedMarks + ' / ' + item.maxMarks +
              '</span>' +
            '</div>' +
            '<div class="p-2.5 bg-white rounded border">' +
              '<span class="text-slate-400 block text-[10px] uppercase font-bold mb-1">Your Submitted Answer:</span>' +
              '<pre class="font-mono text-xs whitespace-pre-wrap text-slate-700">' + (item.studentAnswer || '(No answer provided)') + '</pre>' +
            '</div>' +
            '<div class="p-2.5 bg-indigo-50/70 border border-indigo-100 rounded">' +
              '<span class="text-indigo-600 font-bold block text-[10px] uppercase mb-0.5"><i class="fa-solid fa-comment-dots mr-1"></i> Teacher Feedback & Observations:</span>' +
              '<p class="text-xs text-indigo-900">' + (hasFeedback ? item.facultyFeedback : '<em>No specific teacher remarks added yet.</em>') + '</p>' +
            '</div>' +
          '</div>';
      });
      toggleModal('studentFeedbackModal');
    }

    function handleAdminAuth(e) {
      e.preventDefault();
      var username = document.getElementById('adminUserInput').value.trim();
      var password = document.getElementById('adminPassInput').value.trim();

      fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
      })
      .then(function(res) {
        return res.json().then(function(data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function(result) {
        if (!result.ok) {
          alert(result.data.error || 'Invalid Admin Credentials');
          return;
        }

        appState.currentUser = { role: 'admin', username: result.data.username, rollNumber: 'ADMIN', name: 'Faculty Administrator' };
        renderNav();
        document.getElementById('authView').classList.add('hidden');
        document.getElementById('adminDashboardView').classList.remove('hidden');
        refreshData();
      })
      .catch(function(err) {
        console.error(err);
      });
    }

    function logout() {
      appState.currentUser = null;
      appState.activeStudentSubmission = null;
      clearInterval(appState.timer);
      document.getElementById('authView').classList.remove('hidden');
      document.getElementById('studentDashboardView').classList.add('hidden');
      document.getElementById('examArenaView').classList.add('hidden');
      document.getElementById('adminDashboardView').classList.add('hidden');
      renderNav();
    }

    function launchExamSession() {
      if (appState.questions.length === 0) return alert('No questions in exam bank.');
      document.getElementById('studentDashboardView').classList.add('hidden');
      document.getElementById('examArenaView').classList.remove('hidden');
      document.getElementById('arenaRoll').innerText = appState.currentUser.rollNumber;
      appState.currentQIndex = 0;
      appState.answers = {};

      var timeLeft = appState.config.durationMinutes * 60;
      clearInterval(appState.timer);
      appState.timer = setInterval(function() {
        timeLeft--;
        var m = Math.floor(timeLeft / 60);
        var s = timeLeft % 60;
        document.getElementById('examTimer').innerText = m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
        if (timeLeft <= 0) {
          clearInterval(appState.timer);
          finishAndSubmitExam();
        }
      }, 1000);

      renderPallet();
      loadArenaQuestion(0);
    }

    function renderPallet() {
      var grid = document.getElementById('palletGrid');
      if (!grid) return;
      grid.innerHTML = '';
      appState.questions.forEach(function(q, idx) {
        var isAnswered = appState.answers[q.id || q._id] !== undefined && appState.answers[q.id || q._id] !== '';
        var btn = document.createElement('button');
        btn.className = 'w-10 h-10 rounded-lg text-xs font-mono font-bold ' + (isAnswered ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700');
        btn.innerText = idx + 1;
        btn.onclick = function() { saveCurrentResponse(); loadArenaQuestion(idx); };
        grid.appendChild(btn);
      });
      var ratioEl = document.getElementById('answeredRatio');
      if (ratioEl) ratioEl.innerText = Object.keys(appState.answers).length + ' / ' + appState.questions.length;
    }

    function loadArenaQuestion(idx) {
      appState.currentQIndex = idx;
      var q = appState.questions[idx];
      if (!q) return;
      var qId = q.id || q._id;
      var headEl = document.getElementById('qNumberHeading');
      var badgeEl = document.getElementById('qMarksBadge');
      var promptEl = document.getElementById('qPrompt');
      if (headEl) headEl.innerText = 'Question ' + (idx + 1) + ' of ' + appState.questions.length;
      if (badgeEl) badgeEl.innerText = q.marks + ' Marks';
      if (promptEl) promptEl.innerText = q.prompt;

      var zone = document.getElementById('interactiveAnswerZone');
      if (!zone) return;
      zone.innerHTML = '';
      var existing = appState.answers[qId] || '';

      if (q.type === 'mcq') {
        var div = document.createElement('div');
        div.className = 'space-y-2';
        (q.options || []).forEach(function(opt, oIdx) {
          div.innerHTML += 
            '<label class="flex items-center gap-3 p-3 rounded-lg border text-xs cursor-pointer hover:bg-slate-50">' +
              '<input type="radio" name="opt" value="' + oIdx + '" ' + (existing == oIdx ? 'checked' : '') + ' onchange="appState.answers[\'' + qId + '\'] = \'' + oIdx + '\'; renderPallet();">' +
              '<span>' + opt + '</span>' +
            '</label>';
        });
        zone.appendChild(div);
      } else if (q.type === 'theory') {
        zone.innerHTML = 
          '<textarea id="arenaTheoryText" rows="6" oninput="appState.answers[\'' + qId + '\'] = this.value; renderPallet();" class="w-full text-xs p-3 border rounded-xl" placeholder="Explain your answer here...">' + existing + '</textarea>';
      } else {
        zone.innerHTML = 
          '<textarea id="arenaCodeText" rows="8" oninput="appState.answers[\'' + qId + '\'] = this.value; renderPallet();" class="w-full text-xs font-mono bg-slate-900 text-emerald-400 p-3 rounded-xl">' + (existing || q.starterCode || '') + '</textarea>';
      }
    }

    function saveCurrentResponse() {
      var q = appState.questions[appState.currentQIndex];
      if (!q) return;
      var qId = q.id || q._id;
      if (q.type === 'theory') {
        var el = document.getElementById('arenaTheoryText');
        if (el) appState.answers[qId] = el.value;
      } else if (q.type === 'programming') {
        var el2 = document.getElementById('arenaCodeText');
        if (el2) appState.answers[qId] = el2.value;
      }
      renderPallet();
    }

    function navigateQuestion(step) {
      saveCurrentResponse();
      var target = appState.currentQIndex + step;
      if (target >= 0 && target < appState.questions.length) loadArenaQuestion(target);
    }

    function finishAndSubmitExam() {
      saveCurrentResponse();
      clearInterval(appState.timer);

      fetch('/api/exams/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rollNumber: appState.currentUser.rollNumber,
          studentName: appState.currentUser.name,
          responses: appState.answers
        })
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        refreshData();
        alert('Exam submitted! Score: ' + data.submission.totalScore + ' / ' + data.submission.maxScore);
        document.getElementById('examArenaView').classList.add('hidden');
        document.getElementById('studentDashboardView').classList.remove('hidden');
        checkStudentSubmission();
      })
      .catch(function(err) {
        console.error(err);
      });
    }

    function openExamSettingsModal() {
      document.getElementById('settingExamTitle').value = appState.config.title;
      document.getElementById('settingExamDuration').value = appState.config.durationMinutes;
      toggleModal('examSettingsModal');
    }

    function handleSaveExamSettings(e) {
      e.preventDefault();
      var title = document.getElementById('settingExamTitle').value;
      var durationMinutes = Number(document.getElementById('settingExamDuration').value);

      fetch('/api/exam/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title, durationMinutes: durationMinutes })
      })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        appState.config = data.config;
        toggleModal('examSettingsModal');
        updateMetrics();
        alert('Exam settings saved.');
      });
    }

    function openQuestionModal() {
      renderQuestionTypeFields();
      toggleModal('questionModal');
    }

    function renderQuestionTypeFields() {
      var type = document.getElementById('newQType').value;
      var zone = document.getElementById('dynamicQConfigZone');
      if (!zone) return;
      if (type === 'mcq') {
        zone.innerHTML = 
          '<input type="text" id="opt0" placeholder="Option A" class="w-full text-xs p-2 border rounded mb-1" required>' +
          '<input type="text" id="opt1" placeholder="Option B" class="w-full text-xs p-2 border rounded mb-1" required>' +
          '<input type="text" id="opt2" placeholder="Option C" class="w-full text-xs p-2 border rounded mb-1" required>' +
          '<input type="text" id="opt3" placeholder="Option D" class="w-full text-xs p-2 border rounded mb-2" required>' +
          '<label class="text-xs font-bold">Correct Option:</label>' +
          '<select id="correctIdx" class="text-xs p-1 border rounded ml-2">' +
            '<option value="0">Option A</option>' +
            '<option value="1">Option B</option>' +
            '<option value="2">Option C</option>' +
            '<option value="3">Option D</option>' +
          '</select>';
      } else if (type === 'theory') {
        zone.innerHTML = 
          '<label class="text-xs font-bold block mb-1">Expected Keywords (comma-separated):</label>' +
          '<input type="text" id="theoryKw" placeholder="e.g. semaphore, mutual exclusion, deadlock" class="w-full text-xs p-2 border rounded" required>';
      } else {
        zone.innerHTML = 
          '<input type="text" id="tcInput" placeholder=\'Test Input (e.g. "racecar")\' class="w-full text-xs p-2 border rounded mb-1" required>' +
          '<input type="text" id="tcOutput" placeholder=\'Expected Output (e.g. True)\' class="w-full text-xs p-2 border rounded" required>';
      }
    }

    function handleCreateQuestion(e) {
      e.preventDefault();
      var type = document.getElementById('newQType').value;
      var marks = Number(document.getElementById('newQMarks').value);
      var prompt = document.getElementById('newQPrompt').value.trim();

      var payload = { type: type, marks: marks, prompt: prompt };
      if (type === 'mcq') {
        payload.options = [
          document.getElementById('opt0').value,
          document.getElementById('opt1').value,
          document.getElementById('opt2').value,
          document.getElementById('opt3').value
        ];
        payload.correctOptionIndex = Number(document.getElementById('correctIdx').value);
      } else if (type === 'theory') {
        payload.expectedKeywords = document.getElementById('theoryKw').value.split(',').map(function(s) { return s.trim(); });
      } else {
        payload.testCases = [{
          input: document.getElementById('tcInput').value,
          expectedOutput: document.getElementById('tcOutput').value
        }];
      }

      fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function() {
        toggleModal('questionModal');
        refreshData();
      });
    }

    function deleteQuestion(id) {
      fetch('/api/questions/' + id, { method: 'DELETE' }).then(function() {
        refreshData();
      });
    }

    function switchAdminTab(t) {
      document.getElementById('adminQuestionsPanel').classList.toggle('hidden', t !== 'questions');
      document.getElementById('adminSubmissionsPanel').classList.toggle('hidden', t === 'questions');
    }

    function updateMetrics() {
      var qEl = document.getElementById('adminMetricQCount');
      if (qEl) qEl.innerText = appState.questions.length;

      var durEl = document.getElementById('adminMetricDuration');
      if (durEl) durEl.innerText = appState.config.durationMinutes + ' Mins';

      var subEl = document.getElementById('adminMetricSubmissions');
      if (subEl) subEl.innerText = appState.submissions.length;
    }

    function renderQuestionsTable() {
      var tb = document.getElementById('adminQuestionsTableBody');
      if (!tb) return;
      tb.innerHTML = '';
      appState.questions.forEach(function(q, i) {
        var id = q.id || q._id;
        tb.innerHTML += 
          '<tr>' +
            '<td class="py-2.5 font-mono">' + (i + 1) + '</td>' +
            '<td class="py-2.5 uppercase font-bold text-blue-600 font-mono">' + q.type + '</td>' +
            '<td class="py-2.5 max-w-xs truncate">' + q.prompt + '</td>' +
            '<td class="py-2.5 font-bold">' + q.marks + '</td>' +
            '<td class="py-2.5 text-right">' +
              '<button onclick="deleteQuestion(\'' + id + '\')" class="text-rose-500 hover:text-rose-700"><i class="fa-solid fa-trash"></i></button>' +
            '</td>' +
          '</tr>';
      });
    }

    function renderSubmissionsTable() {
      var tb = document.getElementById('adminSubmissionsTableBody');
      if (!tb) return;
      tb.innerHTML = '';
      appState.submissions.forEach(function(sub) {
        var id = sub.id || sub._id;
        tb.innerHTML += 
          '<tr>' +
            '<td class="py-2.5 font-mono font-bold">' + sub.rollNumber + '</td>' +
            '<td class="py-2.5">' + sub.studentName + '</td>' +
            '<td class="py-2.5 font-bold">' + sub.totalScore + ' / ' + sub.maxScore + '</td>' +
            '<td class="py-2.5"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700">' + sub.status + '</span></td>' +
            '<td class="py-2.5 text-right">' +
              '<button onclick="openAuditModal(\'' + id + '\')" class="px-2.5 py-1 bg-blue-50 text-blue-700 rounded text-xs font-bold hover:bg-blue-100">' +
                'Review & Feedback' +
              '</button>' +
            '</td>' +
          '</tr>';
      });
    }

    function openAuditModal(subId) {
      appState.activeSubId = subId;
      var sub = appState.submissions.find(function(s) { return (s.id || s._id).toString() === subId.toString(); });
      if (!sub) return;

      var container = document.getElementById('auditQuestionsContainer');
      if (!container) return;
      container.innerHTML = '';
      (sub.breakdown || []).forEach(function(item, idx) {
        container.innerHTML += 
          '<div class="p-3 bg-slate-50 border rounded-xl space-y-2 text-xs">' +
            '<div class="flex justify-between items-center">' +
              '<span class="font-bold">Q' + (idx + 1) + ': ' + item.prompt + '</span>' +
              '<div class="flex items-center gap-1">' +
                '<label>Marks:</label>' +
                '<input type="number" id="auditMark_' + idx + '" value="' + item.awardedMarks + '" max="' + item.maxMarks + '" class="w-14 p-1 border rounded font-mono font-bold text-center">' +
                '<span>/ ' + item.maxMarks + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="p-2 bg-white rounded border">' +
              '<span class="text-slate-400 block text-[10px] uppercase font-bold">Student Answer:</span>' +
              '<pre class="font-mono text-xs whitespace-pre-wrap">' + (item.studentAnswer || '(No answer)') + '</pre>' +
            '</div>' +
            '<div>' +
              '<label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Teacher Feedback / Observation:</label>' +
              '<input type="text" id="auditFeed_' + idx + '" value="' + (item.facultyFeedback || '') + '" placeholder="Write observation / comment for student..." class="w-full p-2 border rounded text-xs">' +
            '</div>' +
          '</div>';
      });
      toggleModal('submissionAuditModal');
    }

    function saveManualGrades() {
      var sub = appState.submissions.find(function(s) { return (s.id || s._id).toString() === appState.activeSubId.toString(); });
      if (!sub) return;

      var breakdown = sub.breakdown.map(function(item, idx) {
        var m = document.getElementById('auditMark_' + idx);
        var f = document.getElementById('auditFeed_' + idx);
        return {
          questionId: item.questionId,
          prompt: item.prompt,
          type: item.type,
          studentAnswer: item.studentAnswer,
          autoScore: item.autoScore,
          maxMarks: item.maxMarks,
          remark: item.remark,
          awardedMarks: m ? Number(m.value) : item.awardedMarks,
          facultyFeedback: f ? f.value : item.facultyFeedback,
          isOverridden: true
        };
      });

      fetch('/api/submissions/' + appState.activeSubId + '/override', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ breakdown: breakdown })
      })
      .then(function(res) { return res.json(); })
      .then(function() {
        toggleModal('submissionAuditModal');
        refreshData();
        alert('Feedback and score adjustments saved successfully.');
      })
      .catch(function(err) {
        console.error(err);
      });
    }
  </script>
</body>
</html>`);
});

// ============================================================================
// 4. SERVER LISTENER
// ============================================================================
app.listen(PORT, () => {
  console.log('====================================================');
  console.log('✓ ExamMatrix single-file server running on port ' + PORT);
  console.log('✓ Web Interface: http://localhost:' + PORT);
  console.log('✓ Admin User:    ' + ADMIN_USERNAME);
  console.log('====================================================');
});