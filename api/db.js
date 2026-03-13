// api/db.js — Uses Supabase REST API directly (no npm packages needed)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Helper: call Supabase REST API
async function query(table, method, body, filters = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${filters}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer': 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase error: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Helper: verify JWT and get user from Supabase Auth
async function getUser(token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${token}`,
    }
  });
  if (!res.ok) return null;
  return await res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase env vars not configured on Vercel' });
  }

  // Verify user token
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });

  const user = await getUser(token);
  if (!user?.id) return res.status(401).json({ error: 'Invalid or expired token' });

  const uid = user.id;
  const action = req.query.action;

  try {

    // ── LOAD ALL USER DATA ──
    if (req.method === 'GET' && action === 'load') {
      const [profiles, ratings, plans, streaks] = await Promise.all([
        query('profiles', 'GET', null, `?id=eq.${uid}&select=*`).catch(() => []),
        query('subject_ratings', 'GET', null, `?user_id=eq.${uid}&select=*`).catch(() => []),
        query('plans', 'GET', null, `?user_id=eq.${uid}&is_active=eq.true&select=*&order=generated_at.desc&limit=1`).catch(() => []),
        query('streaks', 'GET', null, `?user_id=eq.${uid}&select=*`).catch(() => []),
      ]);
      return res.status(200).json({
        profile: profiles?.[0] || null,
        ratings: ratings || [],
        plan: plans?.[0] || null,
        streak: streaks?.[0] || null,
      });
    }

    // ── SAVE PROFILE ──
    if (req.method === 'POST' && action === 'save-profile') {
      const { exam_type, attempt_year, attempt_number, retry_reason, prep_stage, study_mode, optional_subject } = req.body;
      const existing = await query('profiles', 'GET', null, `?id=eq.${uid}&select=id`).catch(() => []);
      if (existing?.length > 0) {
        await query('profiles', 'PATCH', {
          exam_type, attempt_year, attempt_number, retry_reason,
          prep_stage, study_mode, optional_subject,
          updated_at: new Date().toISOString()
        }, `?id=eq.${uid}`);
      } else {
        await query('profiles', 'POST', {
          id: uid,
          email: user.email,
          full_name: user.user_metadata?.full_name,
          avatar_url: user.user_metadata?.avatar_url,
          exam_type, attempt_year, attempt_number, retry_reason,
          prep_stage, study_mode, optional_subject,
        });
      }
      return res.status(200).json({ success: true });
    }

    // ── SAVE SUBJECT RATINGS ──
    if (req.method === 'POST' && action === 'save-ratings') {
      const { ratings } = req.body;
      for (const [key, rating] of Object.entries(ratings)) {
        const existing = await query('subject_ratings', 'GET', null,
          `?user_id=eq.${uid}&subject_key=eq.${key}&select=id`).catch(() => []);
        if (existing?.length > 0) {
          await query('subject_ratings', 'PATCH',
            { rating, updated_at: new Date().toISOString() },
            `?user_id=eq.${uid}&subject_key=eq.${key}`);
        } else {
          await query('subject_ratings', 'POST', { user_id: uid, subject_key: key, rating });
        }
      }
      return res.status(200).json({ success: true });
    }

    // ── SAVE PLAN ──
    if (req.method === 'POST' && action === 'save-plan') {
      const { plan_data } = req.body;
      // Deactivate old plans first
      await query('plans', 'PATCH', { is_active: false }, `?user_id=eq.${uid}`).catch(() => {});
      // Insert new active plan
      const result = await query('plans', 'POST', {
        user_id: uid,
        plan_data,
        is_active: true,
        exam_date: '2026-05-24'
      });
      return res.status(200).json({ success: true, plan_id: result?.[0]?.id });
    }

    // ── COMPLETE TASK ──
    if (req.method === 'POST' && action === 'complete-task') {
      const { plan_id, day_index, task_index, topic, subject } = req.body;
      const existing = await query('task_completions', 'GET', null,
        `?user_id=eq.${uid}&plan_id=eq.${plan_id}&day_index=eq.${day_index}&task_index=eq.${task_index}&select=id`
      ).catch(() => []);
      if (!existing?.length) {
        await query('task_completions', 'POST', {
          user_id: uid, plan_id, day_index, task_index, topic, subject,
          completed_at: new Date().toISOString()
        });
      }
      // Update streak
      const today = new Date().toISOString().split('T')[0];
      const streakRows = await query('streaks', 'GET', null, `?user_id=eq.${uid}&select=*`).catch(() => []);
      if (streakRows?.length > 0) {
        const s = streakRows[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        const cont = s.last_study_date === yesterday;
        const sameDay = s.last_study_date === today;
        const newStreak = sameDay ? s.current_streak : (cont ? s.current_streak + 1 : 1);
        await query('streaks', 'PATCH', {
          current_streak: newStreak,
          longest_streak: Math.max(newStreak, s.longest_streak || 0),
          last_study_date: today,
          total_days_studied: (s.total_days_studied || 0) + (sameDay ? 0 : 1),
          updated_at: new Date().toISOString()
        }, `?user_id=eq.${uid}`);
      } else {
        await query('streaks', 'POST', {
          user_id: uid, current_streak: 1, longest_streak: 1,
          last_study_date: today, total_days_studied: 1
        });
      }
      return res.status(200).json({ success: true });
    }

    // ── DELETE PLAN (restart onboarding) ──
    if (req.method === 'POST' && action === 'delete-plan') {
      await query('plans', 'PATCH', { is_active: false }, `?user_id=eq.${uid}`).catch(() => {});
      await query('profiles', 'PATCH', { exam_type: null, updated_at: new Date().toISOString() }, `?id=eq.${uid}`).catch(() => {});
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });

  } catch (err) {
    console.error('DB error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
