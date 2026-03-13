// api/db.js — Supabase REST API (no npm packages needed)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

// ── Supabase REST helper ──────────────────────────────────────
async function query(table, method, body, filters = '') {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Supabase env vars not set');
  const url = `${SUPABASE_URL}/rest/v1/${table}${filters}`;
  const res = await fetch(url, {
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
  if (!res.ok) {
    console.error(`Supabase ${method} ${table}${filters} → ${res.status}:`, text);
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// ── Upsert helper ─────────────────────────────────────────────
async function upsert(table, body, onConflict) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Supabase env vars not set');
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer':        `resolution=merge-duplicates,return=representation`,
      'on-conflict':   onConflict,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Supabase upsert ${table} → ${res.status}:`, text);
    throw new Error(`Supabase upsert ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// ── Verify JWT via Supabase Auth ──────────────────────────────
async function getUser(token) {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) { console.error('getUser failed:', res.status); return null; }
  return res.json();
}

const EXAM_DATES = {
  'UPSC CSE':  '2026-05-24',
  'UPSC CAPF': '2026-08-01',
  'SSC CGL':   '2026-07-01',
  'MPSC':      '2026-06-01',
  'UPPSC':     '2026-07-01',
  'BPSC':      '2026-08-01',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('MISSING ENV VARS — set SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel');
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' });
  }

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No auth token' });

  const user = await getUser(token);
  if (!user?.id) return res.status(401).json({ error: 'Invalid or expired token' });

  const uid    = user.id;
  const action = req.query.action;
  console.log(`[db] uid=${uid.slice(0,8)} action=${action}`);

  try {

    // ── LOAD ──────────────────────────────────────────────────
    if (req.method === 'GET' && action === 'load') {
      const [profiles, ratings, plans, streaks] = await Promise.all([
        query('profiles', 'GET', null, `?id=eq.${uid}&select=*`).catch(() => []),
        query('subject_ratings', 'GET', null, `?user_id=eq.${uid}&select=*`).catch(() => []),
        query('plans', 'GET', null, `?user_id=eq.${uid}&is_active=eq.true&select=id,plan_data,exam_date,generated_at&order=generated_at.desc&limit=1`).catch(() => []),
        query('streaks', 'GET', null, `?user_id=eq.${uid}&select=*`).catch(() => []),
      ]);
      console.log(`[db] load OK — profile=${!!profiles?.[0]} plan=${!!plans?.[0]}`);
      return res.status(200).json({
        profile: profiles?.[0] || null,
        ratings: ratings || [],
        plan:    plans?.[0]    || null,
        streak:  streaks?.[0]  || null,
      });
    }

    // ── SAVE PROFILE ──────────────────────────────────────────
    if (req.method === 'POST' && action === 'save-profile') {
      const { exam_type, attempt_year, attempt_number, retry_reason, prep_stage, study_mode, optional_subject } = req.body;
      await upsert('profiles', {
        id:               uid,
        email:            user.email,
        full_name:        user.user_metadata?.full_name    || null,
        avatar_url:       user.user_metadata?.avatar_url   || null,
        exam_type,
        attempt_year,
        attempt_number,
        retry_reason:     retry_reason     || null,
        prep_stage:       prep_stage       || null,
        study_mode:       study_mode       || null,
        optional_subject: optional_subject || null,
        updated_at:       new Date().toISOString(),
      }, 'id');
      console.log(`[db] profile saved exam=${exam_type}`);
      return res.status(200).json({ success: true });
    }

    // ── SAVE RATINGS ──────────────────────────────────────────
    if (req.method === 'POST' && action === 'save-ratings') {
      const { ratings } = req.body;
      const rows = Object.entries(ratings).map(([key, rating]) => ({
        user_id: uid, subject_key: key, rating,
        updated_at: new Date().toISOString(),
      }));
      await upsert('subject_ratings', rows, 'user_id,subject_key');
      console.log(`[db] ratings saved: ${rows.length} rows`);
      return res.status(200).json({ success: true });
    }

    // ── SAVE PLAN ─────────────────────────────────────────────
    if (req.method === 'POST' && action === 'save-plan') {
      const { plan_data, exam_type } = req.body;
      if (!plan_data) return res.status(400).json({ error: 'plan_data missing' });

      // Ensure profile row exists (plans FK references profiles)
      await upsert('profiles', {
        id:         uid,
        email:      user.email,
        full_name:  user.user_metadata?.full_name  || null,
        avatar_url: user.user_metadata?.avatar_url || null,
        updated_at: new Date().toISOString(),
      }, 'id').catch(e => console.warn('profile ensure:', e.message));

      // Deactivate previous plans
      await query('plans', 'PATCH', { is_active: false }, `?user_id=eq.${uid}`)
        .catch(e => console.warn('deactivate plans:', e.message));

      // Determine exam date
      const examDate = EXAM_DATES[exam_type] || '2026-05-24';

      // Insert new plan
      const result = await query('plans', 'POST', {
        user_id:      uid,
        plan_data,
        is_active:    true,
        exam_date:    examDate,
        generated_at: new Date().toISOString(),
      });

      const planId = result?.[0]?.id || null;
      console.log(`[db] plan saved id=${planId} exam_date=${examDate}`);
      return res.status(200).json({ success: true, plan_id: planId });
    }

    // ── COMPLETE TASK ─────────────────────────────────────────
    if (req.method === 'POST' && action === 'complete-task') {
      const { plan_id, day_index, task_index, topic, subject } = req.body;
      await upsert('task_completions', {
        user_id: uid, plan_id, day_index, task_index, topic, subject,
        completed_at: new Date().toISOString(),
      }, 'user_id,plan_id,day_index,task_index').catch(e => console.warn('complete-task:', e.message));

      // Update streak
      const today     = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const rows = await query('streaks', 'GET', null, `?user_id=eq.${uid}&select=*`).catch(() => []);
      if (rows?.length) {
        const s = rows[0];
        const sameDay   = s.last_study_date === today;
        const continued = s.last_study_date === yesterday;
        const streak    = sameDay ? s.current_streak : (continued ? s.current_streak + 1 : 1);
        await query('streaks', 'PATCH', {
          current_streak:     streak,
          longest_streak:     Math.max(streak, s.longest_streak || 0),
          last_study_date:    today,
          total_days_studied: (s.total_days_studied || 0) + (sameDay ? 0 : 1),
          updated_at:         new Date().toISOString(),
        }, `?user_id=eq.${uid}`).catch(e => console.warn('streak update:', e.message));
      } else {
        await upsert('streaks', {
          user_id: uid, current_streak: 1, longest_streak: 1,
          last_study_date: today, total_days_studied: 1,
        }, 'user_id').catch(e => console.warn('streak create:', e.message));
      }
      return res.status(200).json({ success: true });
    }

    // ── DELETE PLAN ───────────────────────────────────────────
    if (req.method === 'POST' && action === 'delete-plan') {
      await query('plans', 'PATCH', { is_active: false }, `?user_id=eq.${uid}`)
        .catch(e => console.warn('delete-plan:', e.message));
      await query('profiles', 'PATCH',
        { exam_type: null, updated_at: new Date().toISOString() }, `?id=eq.${uid}`)
        .catch(e => console.warn('clear profile:', e.message));
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
    console.error(`[db] ERROR action=${action}:`, err.message);
    return res.status(500).json({ error: err.message });
  }
}
