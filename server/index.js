import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const app = express();
const PORT = Number(process.env.PORT || 4242);
const APP_URL = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KHALTI_BASE_URL = (process.env.KHALTI_BASE_URL || 'https://dev.khalti.com/api/v2').replace(/\/$/, '');
const KHALTI_SECRET_KEY = process.env.KHALTI_SECRET_KEY;
const hasKhaltiSecret = Boolean(KHALTI_SECRET_KEY && !KHALTI_SECRET_KEY.startsWith('YOUR_'));

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: APP_URL, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '30kb' }));
app.use('/api/payments', rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false }));

const hasSupabase = Boolean(SUPABASE_URL && SERVICE_KEY && !SUPABASE_URL.includes('YOUR-PROJECT') && !SERVICE_KEY.startsWith('YOUR_'));
const admin = hasSupabase ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } }) : null;

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'TASKORA API', paymentsConfigured: Boolean(hasKhaltiSecret && admin) }));
app.get('/api/config', (_req, res) => res.json({ currency: 'NPR', monthlyNpr: Number(process.env.PRO_MONTHLY_NPR || 499), yearlyNpr: Number(process.env.PRO_YEARLY_NPR || 4999) }));

async function requireUser(req, res, next) {
  try {
    if (!admin) return res.status(503).json({ error: 'Cloud backend is not configured. Add the server Supabase settings first.' });
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Please sign in first.' });
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Your session is invalid or expired. Please sign in again.' });
    req.user = data.user;
    next();
  } catch (error) {
    console.error('Authentication error:', error.message);
    res.status(500).json({ error: 'Could not validate your session.' });
  }
}

function getPlan(planKey) {
  const plans = {
    pro_monthly: { label: 'TASKORA Pro — 30 days', amount: Math.round(Number(process.env.PRO_MONTHLY_NPR || 499) * 100), days: 30 },
    pro_yearly: { label: 'TASKORA Pro — 365 days', amount: Math.round(Number(process.env.PRO_YEARLY_NPR || 4999) * 100), days: 365 }
  };
  const selected = plans[planKey] || null;
  return selected && Number.isFinite(selected.amount) && selected.amount > 1000 ? selected : null;
}

async function khaltiRequest(path, payload) {
  if (!hasKhaltiSecret) throw new Error('Khalti is not configured. Add the sandbox merchant secret to the server .env file.');
  const response = await fetch(`${KHALTI_BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Key ${KHALTI_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('Khalti API rejected request:', response.status, body);
    throw new Error(body.detail || body.message || `Khalti returned HTTP ${response.status}.`);
  }
  return body;
}

app.post('/api/payments/khalti/initiate', requireUser, async (req, res) => {
  try {
    const plan = getPlan(req.body?.plan);
    if (!plan) return res.status(400).json({ error: 'Choose a valid TASKORA Pro plan.' });
    if (!hasKhaltiSecret) return res.status(503).json({ error: 'Payment gateway is not configured yet. Ask the site owner to add the Khalti sandbox key.' });

    const orderId = randomUUID();
    const request = {
      return_url: `${APP_URL}/?payment=return`,
      website_url: APP_URL,
      amount: plan.amount,
      purchase_order_id: orderId,
      purchase_order_name: plan.label,
      customer_info: {
        name: req.user.user_metadata?.full_name || 'TASKORA customer',
        email: req.user.email || ''
      }
    };
    const gateway = await khaltiRequest('/epayment/initiate/', request);
    if (!gateway.pidx || !gateway.payment_url) throw new Error('Khalti did not return a checkout URL.');

    const { error: saveError } = await admin.from('payment_orders').insert({
      user_id: req.user.id,
      purchase_order_id: orderId,
      pidx: gateway.pidx,
      plan_key: req.body.plan,
      amount_paisa: plan.amount,
      currency: 'NPR',
      status: 'initiated'
    });
    if (saveError) {
      console.error('Could not save payment order:', saveError.message);
      return res.status(500).json({ error: 'Checkout started but the order could not be saved. Contact the site owner before retrying.' });
    }
    res.json({ paymentUrl: gateway.payment_url, pidx: gateway.pidx });
  } catch (error) {
    console.error('Khalti initiate error:', error.message);
    res.status(502).json({
  error: 'Could not start checkout. Please try again later.'
});
  }
});

app.post('/api/payments/khalti/verify', requireUser, async (req, res) => {
  try {
    const pidx = String(req.body?.pidx || '').trim();
    if (!pidx || pidx.length > 180) return res.status(400).json({ error: 'Missing or invalid payment reference.' });
    const { data: order, error: orderError } = await admin.from('payment_orders')
      .select('*').eq('pidx', pidx).eq('user_id', req.user.id).maybeSingle();
    if (orderError || !order) return res.status(404).json({ error: 'Payment order was not found for this account.' });

    // A browser redirect is never proof of payment. Confirm every transaction server-to-server.
    const gateway = await khaltiRequest('/epayment/lookup/', { pidx });
    const verified = gateway.status === 'Completed' && gateway.pidx === pidx && Number(gateway.total_amount) === Number(order.amount_paisa) && gateway.refunded !== true && Boolean(gateway.transaction_id);
    if (!verified) {
      const rejectedStatus = gateway.refunded === true ? 'refunded' : (gateway.status === 'Completed' ? 'verification_failed' : String(gateway.status || 'pending').toLowerCase());
      await admin.from('payment_orders').update({ status: rejectedStatus }).eq('pidx', pidx);
      return res.status(409).json({ error: `Payment is not completed (gateway status: ${gateway.status || 'unknown'}). No Pro access was added.` });
    }

    const { error: activationError } = await admin.rpc('complete_khalti_order', {
      p_pidx: pidx,
      p_transaction_id: String(gateway.transaction_id || '')
    });
    if (activationError) throw new Error(`Payment was confirmed, but Pro activation needs attention: ${activationError.message}`);

    const { data: subscription } = await admin.from('subscriptions').select('plan,status,current_period_end')
      .eq('user_id', req.user.id).maybeSingle();
    res.json({ ok: true, message: 'Payment verified.', subscription });
  } catch (error) {
    console.error('Khalti verification error:', error.message);
    res.status(502).json({
  error: 'Could not complete payment verification. Please contact support if you were charged.'
});
  }
});

app.use((err, _req, res, _next) => {
  console.error('Unhandled API error:', err.message);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

app.listen(PORT, () => {
  console.log(`TASKORA API listening on http://127.0.0.1:${PORT}`);
  if (!hasSupabase) console.warn('Supabase server credentials are missing; protected routes are disabled.');
  if (!hasKhaltiSecret) console.warn('Khalti key is missing or still a placeholder; payments are disabled until configured.');
});
