// api/seed-test.js — ONE TIME use: creates test user + full data in Supabase
// DELETE THIS FILE after running it once!

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

async function sb(table, method, body, filters = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${filters}`, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer':        'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${table} ${method} ${res.status}: ${text}`);
  return data;
}

async function sbAuth(path, method, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey':       SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`auth/${path} ${res.status}: ${text}`);
  return data;
}

export default async function handler(req, res) {
  // Basic protection — only allow GET with secret param
  if (req.query.secret !== 'preppath-seed-2026') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing env vars' });
  }

  const log = [];
  try {

    // ── 1. Create auth user ────────────────────────────────
    let userId;
    try {
      const authUser = await sbAuth('admin/users', 'POST', {
        email:            'test1@test.com',
        password:         'Test@1234',
        email_confirm:    true,
        user_metadata:    { full_name: 'Test User' },
      });
      userId = authUser.id;
      log.push(`✅ Auth user created: ${userId}`);
    } catch (e) {
      // User might already exist — try to find them
      if (e.message.includes('already been registered') || e.message.includes('already exists')) {
        const existing = await sbAuth('admin/users?email=test1@test.com', 'GET');
        userId = existing?.users?.[0]?.id;
        log.push(`ℹ️ User already exists: ${userId}`);
      } else {
        throw e;
      }
    }

    if (!userId) throw new Error('Could not get user ID');

    // ── 2. Upsert profile ──────────────────────────────────
    await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Prefer':        'resolution=merge-duplicates,return=representation',
        'on-conflict':   'id',
      },
      body: JSON.stringify({
        id:               userId,
        email:            'test1@test.com',
        full_name:        'Test User',
        exam_type:        'UPSC CSE',
        attempt_year:     '2026',
        attempt_number:   '1',
        prep_stage:       'Mid-prep',
        study_mode:       'Self-study',
        optional_subject: 'History',
        updated_at:       new Date().toISOString(),
      }),
    });
    log.push('✅ Profile upserted');

    // ── 3. Subject ratings ─────────────────────────────────
    const ratings = [
      { user_id: userId, subject_key: 'gs1', rating: 'neutral' },
      { user_id: userId, subject_key: 'gs2', rating: 'weak' },
      { user_id: userId, subject_key: 'gs3', rating: 'weak' },
      { user_id: userId, subject_key: 'gs4', rating: 'neutral' },
      { user_id: userId, subject_key: 'csat', rating: 'strong' },
      { user_id: userId, subject_key: 'ca',   rating: 'neutral' },
      { user_id: userId, subject_key: 'essay', rating: 'weak' },
      { user_id: userId, subject_key: 'opt',  rating: 'strong' },
    ].map(r => ({ ...r, updated_at: new Date().toISOString() }));

    await fetch(`${SUPABASE_URL}/rest/v1/subject_ratings`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Prefer':        'resolution=merge-duplicates,return=representation',
        'on-conflict':   'user_id,subject_key',
      },
      body: JSON.stringify(ratings),
    });
    log.push(`✅ ${ratings.length} subject ratings upserted`);

    // ── 4. Deactivate old plans ────────────────────────────
    await fetch(`${SUPABASE_URL}/rest/v1/plans?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ is_active: false }),
    });

    // ── 5. Insert plan ─────────────────────────────────────
    const planData = {
      summary: "Prioritising weak GS Paper II, III and Essay with extra revision cycles. Strong CSAT and Optional (History) scheduled for periodic reviews only.",
      weeklyPlan: [
        { day: "Monday", tasks: [
          { subject: "GS Paper I", topic: "Ancient India — Indus Valley Civilisation & Vedic Age", duration: "90", type: "gs1", session: "Morning" },
          { subject: "GS Paper II", topic: "Constitutional Framework — Preamble & Fundamental Rights", duration: "90", type: "gs2", session: "Morning" },
          { subject: "Current Affairs", topic: "The Hindu reading + PIB summary", duration: "60", type: "ca", session: "Evening" },
          { subject: "GS Paper III", topic: "Indian Economy — GDP, GNP, National Income concepts", duration: "120", type: "gs3", session: "Evening" },
        ]},
        { day: "Tuesday", tasks: [
          { subject: "GS Paper II", topic: "Parliament — Lok Sabha, Rajya Sabha, sessions & powers", duration: "90", type: "gs2", session: "Morning" },
          { subject: "GS Paper IV", topic: "Ethics Foundations — Virtue ethics & deontology", duration: "90", type: "gs4", session: "Morning" },
          { subject: "Current Affairs", topic: "Economy & Environment news + editorial analysis", duration: "60", type: "ca", session: "Evening" },
          { subject: "Essay", topic: "Essay writing practice — structure & introduction techniques", duration: "120", type: "essay", session: "Evening" },
        ]},
        { day: "Wednesday", tasks: [
          { subject: "GS Paper III", topic: "Agriculture — Green Revolution, food security, MSP reforms", duration: "90", type: "gs3", session: "Morning" },
          { subject: "GS Paper I", topic: "Modern India — 1857 Revolt & formation of INC", duration: "90", type: "gs1", session: "Morning" },
          { subject: "Current Affairs", topic: "Polity news + SC judgements + governance schemes", duration: "60", type: "ca", session: "Evening" },
          { subject: "GS Paper II", topic: "Federalism — Centre-State relations, Schedule VII", duration: "120", type: "gs2", session: "Evening" },
        ]},
        { day: "Thursday", tasks: [
          { subject: "GS Paper III", topic: "Environment — Biodiversity hotspots, IUCN categories", duration: "90", type: "gs3", session: "Morning" },
          { subject: "Optional Subject", topic: "History — Mughal Empire, administration & culture", duration: "90", type: "opt", session: "Morning" },
          { subject: "Current Affairs", topic: "International Relations + India foreign policy", duration: "60", type: "ca", session: "Evening" },
          { subject: "GS Paper I", topic: "Indian Geography — Physical features & drainage systems", duration: "120", type: "gs1", session: "Evening" },
        ]},
        { day: "Friday", tasks: [
          { subject: "GS Paper III", topic: "Science & Technology — ISRO missions & DRDO", duration: "90", type: "gs3", session: "Morning" },
          { subject: "GS Paper II", topic: "Governance — RTI, Lokpal, CAG, e-Governance", duration: "90", type: "gs2", session: "Morning" },
          { subject: "Current Affairs", topic: "Science & Tech news + weekly consolidation", duration: "60", type: "ca", session: "Evening" },
          { subject: "Essay", topic: "Full essay practice — 1000 word essay on social topic", duration: "120", type: "essay", session: "Evening" },
        ]},
        { day: "Saturday", tasks: [
          { subject: "GS Paper I", topic: "Indian Society — Diversity, role of women, social empowerment", duration: "90", type: "gs1", session: "Morning" },
          { subject: "Optional Subject", topic: "History — British colonial economy & impact", duration: "90", type: "opt", session: "Morning" },
          { subject: "CSAT", topic: "Reading comprehension + Data Interpretation sets", duration: "90", type: "csat", session: "Evening" },
          { subject: "All Papers", topic: "Weekly revision — quick recap of all topics covered", duration: "90", type: "gs2", session: "Evening" },
        ]},
        { day: "Sunday", tasks: [
          { subject: "Current Affairs", topic: "Weekly CA consolidation — prepare monthly digest", duration: "90", type: "ca", session: "Morning" },
          { subject: "Essay", topic: "Essay outlines + answer writing practice", duration: "90", type: "essay", session: "Evening" },
        ]},
      ],
      subjectCoverage: [
        { key: "gs1",   name: "GS Paper I",       color: "#ff9f43", totalTopics: 24, weeksAllocated: 8,  strength: "neutral" },
        { key: "gs2",   name: "GS Paper II",      color: "#4a9eff", totalTopics: 20, weeksAllocated: 8,  strength: "weak" },
        { key: "gs3",   name: "GS Paper III",     color: "#a29bfe", totalTopics: 18, weeksAllocated: 8,  strength: "weak" },
        { key: "gs4",   name: "GS Paper IV",      color: "#fd79a8", totalTopics: 10, weeksAllocated: 4,  strength: "neutral" },
        { key: "csat",  name: "CSAT",             color: "#fdcb6e", totalTopics: 8,  weeksAllocated: 2,  strength: "strong" },
        { key: "ca",    name: "Current Affairs",  color: "#e17055", totalTopics: 12, weeksAllocated: 12, strength: "neutral" },
        { key: "essay", name: "Essay",            color: "#81ecec", totalTopics: 6,  weeksAllocated: 6,  strength: "weak" },
        { key: "opt",   name: "Optional (History)", color: "#55efc4", totalTopics: 16, weeksAllocated: 6, strength: "strong" },
      ],
    };

    const planResult = await sb('plans', 'POST', {
      user_id:      userId,
      plan_data:    planData,
      is_active:    true,
      exam_date:    '2026-05-24',
      generated_at: new Date().toISOString(),
    });
    const planId = planResult?.[0]?.id;
    log.push(`✅ Plan inserted: ${planId}`);

    // ── 6. Streak ──────────────────────────────────────────
    await fetch(`${SUPABASE_URL}/rest/v1/streaks`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Prefer':        'resolution=merge-duplicates,return=representation',
        'on-conflict':   'user_id',
      },
      body: JSON.stringify({
        user_id:           userId,
        current_streak:    3,
        longest_streak:    5,
        last_study_date:   new Date().toISOString().split('T')[0],
        total_days_studied: 12,
        updated_at:        new Date().toISOString(),
      }),
    });
    log.push('✅ Streak upserted');

    return res.status(200).json({
      success: true,
      userId,
      email: 'test1@test.com',
      password: 'Test@1234',
      log,
    });

  } catch (err) {
    console.error('[seed-test] ERROR:', err.message);
    return res.status(500).json({ error: err.message, log });
  }
}
