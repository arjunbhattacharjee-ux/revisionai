import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // service key for server-side
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Get user from token
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Invalid token' });

  // ── SAVE PROFILE ──
  if (req.method === 'POST' && req.query.action === 'save-profile') {
    const { exam_type, attempt_year, attempt_number, retry_reason, prep_stage, study_mode, optional_subject } = req.body;
    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      exam_type, attempt_year, attempt_number, retry_reason, prep_stage, study_mode, optional_subject,
      updated_at: new Date().toISOString()
    });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  // ── SAVE SUBJECT RATINGS ──
  if (req.method === 'POST' && req.query.action === 'save-ratings') {
    const { ratings } = req.body; // { gs1: 'weak', gs2: 'strong', ... }
    const upserts = Object.entries(ratings).map(([key, rating]) => ({
      user_id: user.id,
      subject_key: key,
      rating,
      updated_at: new Date().toISOString()
    }));
    const { error } = await supabase.from('subject_ratings').upsert(upserts, { onConflict: 'user_id,subject_key' });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  // ── SAVE SCHEDULE ──
  if (req.method === 'POST' && req.query.action === 'save-schedule') {
    const { study_days, wake_time, sleep_time, morning_hours, evening_hours, breaks, blocked_dates, intensity } = req.body;
    const { error } = await supabase.from('study_schedules').upsert({
      user_id: user.id,
      study_days, wake_time, sleep_time, morning_hours, evening_hours, breaks, blocked_dates, intensity,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  // ── SAVE PLAN ──
  if (req.method === 'POST' && req.query.action === 'save-plan') {
    const { plan_data } = req.body;
    // Deactivate old plans
    await supabase.from('plans').update({ is_active: false }).eq('user_id', user.id);
    // Save new plan
    const { data, error } = await supabase.from('plans').insert({
      user_id: user.id,
      plan_data,
      is_active: true,
      exam_date: '2026-05-24'
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true, plan_id: data.id });
  }

  // ── LOAD USER DATA ──
  if (req.method === 'GET' && req.query.action === 'load') {
    const [profileRes, ratingsRes, scheduleRes, planRes, streakRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('subject_ratings').select('*').eq('user_id', user.id),
      supabase.from('study_schedules').select('*').eq('user_id', user.id).single(),
      supabase.from('plans').select('*').eq('user_id', user.id).eq('is_active', true).single(),
      supabase.from('streaks').select('*').eq('user_id', user.id).single(),
    ]);
    return res.status(200).json({
      profile: profileRes.data,
      ratings: ratingsRes.data,
      schedule: scheduleRes.data,
      plan: planRes.data,
      streak: streakRes.data,
    });
  }

  // ── COMPLETE TASK ──
  if (req.method === 'POST' && req.query.action === 'complete-task') {
    const { plan_id, day_index, task_index, topic, subject } = req.body;
    const { error } = await supabase.from('task_completions').upsert({
      user_id: user.id, plan_id, day_index, task_index, topic, subject,
      completed_at: new Date().toISOString()
    }, { onConflict: 'user_id,plan_id,day_index,task_index' });

    // Update streak
    const today = new Date().toISOString().split('T')[0];
    await supabase.from('streaks').upsert({
      user_id: user.id,
      last_study_date: today,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
