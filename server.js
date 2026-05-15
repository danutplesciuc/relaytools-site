const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || '/var/data';
const LOCAL_LICENSE_SEED_FILE = path.join(__dirname, 'licenses.json');
const LICENSE_FILE = path.join(DATA_DIR, 'licenses.json');
const VERSION_FILE = path.join(__dirname, 'version.json');
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || 'CHANGE_ME_RELAY_2026').trim();

app.use(cors());

app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.log('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const licenses = loadLicenses();

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = clean(session.customer_email || session.customer_details?.email || '');

    if (email) {
      const existing = licenses.find(item => clean(item.email) === email);

      if (!existing) {
        const license = {
          email,
          license_key: makeLicenseKey(),
          product: 'relay-contract-refresher',
          status: 'active',
          plan: 'pro',
          expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
          maxDevices: 1,
          devices: [],
          stripeCustomerId: session.customer || '',
          stripeSubscriptionId: session.subscription || ''
        };

        licenses.push(license);
        saveLicenses(licenses);

        console.log('License created for', email);
      } else {
        existing.status = 'active';
        existing.plan = 'pro';
        existing.stripeCustomerId = session.customer || existing.stripeCustomerId || '';
        existing.stripeSubscriptionId = session.subscription || existing.stripeSubscriptionId || '';
        saveLicenses(licenses);

        console.log('License reactivated for', email);
      }
    }
  }

  if (event.type === 'customer.subscription.deleted' || event.type === 'invoice.payment_failed') {
    const obj = event.data.object;
    const customerId = obj.customer || '';
    const subscriptionId = obj.subscription || obj.id || '';

    const license = licenses.find(item =>
      item.stripeCustomerId === customerId ||
      item.stripeSubscriptionId === subscriptionId
    );

    if (license) {
      license.status = 'inactive';
      saveLicenses(licenses);

      console.log('License disabled for', license.email);
    }
  }


  if (event.type === 'customer.subscription.deleted') {
    disableLicenseFromStripe(event.data.object);
  }

  if (event.type === 'invoice.payment_failed') {
    disableLicenseFromStripe(event.data.object);
  }

  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object;

    if (
      subscription.status === 'canceled' ||
      subscription.status === 'unpaid' ||
      subscription.status === 'incomplete_expired'
    ) {
      disableLicenseFromStripe(subscription);
    }
  }


  res.json({ received: true });
});

app.use(express.json({ limit: '1mb' }));


function ensureDataStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(LICENSE_FILE)) {
      if (fs.existsSync(LOCAL_LICENSE_SEED_FILE)) {
        fs.copyFileSync(LOCAL_LICENSE_SEED_FILE, LICENSE_FILE);
        console.log('Persistent licenses.json created from seed file.');
      } else {
        fs.writeFileSync(LICENSE_FILE, '[]');
        console.log('Persistent licenses.json created empty.');
      }
    }
  } catch (error) {
    console.error('Could not initialise persistent storage:', error.message);
  }
}

function loadLicenses() {
  ensureDataStore();

  try {
    const raw = fs.readFileSync(LICENSE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Could not read persistent licenses.json:', error.message);
    return [];
  }
}

function saveLicenses(licenses) {
  ensureDataStore();
  fs.writeFileSync(LICENSE_FILE, JSON.stringify(licenses, null, 2));
}

function findLicenseByStripe(licenses, customerId, subscriptionId) {
  return licenses.find(item =>
    (customerId && item.stripeCustomerId === customerId) ||
    (subscriptionId && item.stripeSubscriptionId === subscriptionId)
  );
}

function activateLicenseFromStripe(session) {
  const licenses = loadLicenses();

  const email = String(
    session.customer_email ||
    session.customer_details?.email ||
    session.metadata?.email ||
    ''
  ).trim().toLowerCase();

  if (!email) {
    console.log('Stripe session has no email.');
    return null;
  }

  let license = licenses.find(item =>
    String(item.email || '').trim().toLowerCase() === email
  );

  if (!license) {
    license = {
      email,
      license_key: makeLicenseKey(),
      product: 'relay-contract-refresher',
      status: 'active',
      plan: 'pro',
      expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
      maxDevices: 1,
      devices: [],
      stripeCustomerId: session.customer || '',
      stripeSubscriptionId: session.subscription || ''
    };

    licenses.push(license);
    console.log('License created for', email);
  } else {
    license.status = 'active';
    license.plan = 'pro';
    license.stripeCustomerId = session.customer || license.stripeCustomerId || '';
    license.stripeSubscriptionId = session.subscription || license.stripeSubscriptionId || '';
    console.log('License reactivated for', email);
  }

  saveLicenses(licenses);
  return license;
}

function disableLicenseFromStripe(obj) {
  const licenses = loadLicenses();
  const customerId = obj.customer || '';
  const subscriptionId = obj.subscription || obj.id || '';

  const license = findLicenseByStripe(licenses, customerId, subscriptionId);

  if (license) {
    license.status = 'inactive';
    saveLicenses(licenses);
    console.log('License disabled for', license.email);
    return license;
  }

  console.log('No license found for Stripe customer/subscription.');
  return null;
}


function loadVersionInfo() {
  try {
    const raw = fs.readFileSync(VERSION_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return { version: '3.1.0', downloadUrl: '', notes: 'Version file not found.' };
  }
}

function clean(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanKey(value) {
  return String(value || '').trim().toUpperCase();
}

function makeLicenseKey() {
  const part = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RCR-${part()}-${part()}-${new Date().getFullYear()}`;
}

function requireAdmin(req, res, next) {
  const provided = req.headers['x-admin-password'] || req.query.password;
  if (!provided || String(provided).trim() !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'unauthorised' });
  }
  next();
}

function normaliseLicense(input) {
  const email = clean(input.email);
  const license_key = cleanKey(input.license_key || input.licenseKey || makeLicenseKey());
  const product = clean(input.product || 'relay-contract-refresher');
  const status = clean(input.status || 'active');
  const plan = clean(input.plan || 'standard');
  const maxDevices = Number(input.maxDevices || input.max_devices || 1);
  const expiresAt = input.expiresAt || input.expires_at || new Date(Date.now() + 30 * 86400000).toISOString();

  if (!email) throw new Error('email_required');
  if (!license_key) throw new Error('license_key_required');

  return {
    email,
    license_key,
    product,
    status,
    plan,
    expiresAt: new Date(expiresAt).toISOString(),
    maxDevices: Math.max(1, maxDevices),
    devices: Array.isArray(input.devices) ? input.devices : (Array.isArray(input.deviceIds) ? input.deviceIds : [])
  };
}

app.get('/', (req, res) => {
  res.json({
    ok: true,
    product: 'Relay Contract Refresher License Server',
    version: '3.1.0',
    admin: '/admin',
    validate: '/validate-license',
    versionCheck: '/version',
    checkout: '/create-checkout-session',
    webhook: '/stripe/webhook',
    datastore: LICENSE_FILE
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), version: '3.1.0', datastore: LICENSE_FILE });
});

app.get('/version', (req, res) => {
  const info = loadVersionInfo();
  res.json({
    ok: true,
    product: 'relay-contract-refresher',
    version: info.version || '3.1.0',
    downloadUrl: info.downloadUrl || info.download || '',
    notes: info.notes || ''
  });
});

app.get('/admin/env-check', (req, res) => {
  res.json({
    ok: true,
    version: '3.1.0',
    adminPasswordLoaded: Boolean(ADMIN_PASSWORD && ADMIN_PASSWORD !== 'CHANGE_ME_RELAY_2026'),
    adminPasswordLength: ADMIN_PASSWORD ? ADMIN_PASSWORD.length : 0
  });
});


app.post('/validate-license', (req, res) => {
  const email = clean(req.body.email);
  const licenseKey = cleanKey(req.body.license_key);
  const product = clean(req.body.product || 'relay-contract-refresher');
  const deviceId = String(req.body.deviceId || req.body.device_id || '').trim();

  if (!email || !licenseKey) {
    return res.json({ ok: true, active: false, reason: 'missing_email_or_license' });
  }

  const licenses = loadLicenses();
  const license = licenses.find(item =>
    clean(item.email) === email &&
    cleanKey(item.license_key) === licenseKey &&
    clean(item.product) === product
  );

  if (!license) {
    return res.json({ ok: true, active: false, reason: 'not_found' });
  }

  if (license.status !== 'active') {
    return res.json({ ok: true, active: false, reason: license.status || 'inactive' });
  }

  const expires = new Date(license.expiresAt).getTime();
  if (!expires || expires <= Date.now()) {
    return res.json({ ok: true, active: false, reason: 'expired', expiresAt: license.expiresAt });
  }


  license.devices = Array.isArray(license.devices) ? license.devices : [];

  if (deviceId) {
    const exists = license.devices.includes(deviceId);

    if (!exists) {
      const limit = Number(license.maxDevices || 1);

      if (license.devices.length >= limit) {
        return res.json({
          ok: true,
          active: false,
          reason: 'device_limit_reached',
          maxDevices: limit,
          usedDevices: license.devices.length
        });
      }

      license.devices.push(deviceId);
      saveLicenses(licenses);
    }
  }

  return res.json({
    ok: true,
    active: true,
    expiresAt: license.expiresAt,
    plan: license.plan || 'standard',
    maxDevices: license.maxDevices || 1,
    usedDevices: license.devices ? license.devices.length : 0
  });
});


app.post('/create-checkout-session', async (req, res) => {
  try {
    const email = clean(req.body.email);

    if (!email) {
      return res.status(400).json({
        ok: false,
        error: 'email_required'
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1
        }
      ],
      subscription_data: {
        trial_period_days: 7
      },
      success_url: `${process.env.APP_URL || 'https://relay-license-server.onrender.com'}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL || 'https://relay-license-server.onrender.com'}/cancel`
    });

    res.json({
      ok: true,
      url: session.url
    });
  } catch (error) {
    console.error('Stripe checkout failed:', error.message);
    res.status(500).json({
      ok: false,
      error: 'checkout_failed'
    });
  }
});

app.get('/success', (req, res) => {
  res.send('Payment successful. Your Relay Contract Refresher trial is active. You can now return to the extension.');
});

app.get('/cancel', (req, res) => {
  res.send('Payment cancelled. You can return to the extension and start again anytime.');
});

app.get('/admin', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Relay Tools Admin</title>
  <style>
    body{margin:0;background:#0b1220;color:#e5e7eb;font-family:Arial,sans-serif}.wrap{max-width:1100px;margin:0 auto;padding:24px}h1{margin:0 0 6px;font-size:28px}.sub{color:#94a3b8;margin-bottom:22px}.card{background:#111827;border:1px solid #243244;border-radius:18px;padding:18px;margin-bottom:18px;box-shadow:0 15px 45px rgba(0,0,0,.25)}input,select,button{border:0;border-radius:10px;padding:11px;font-size:14px}input,select{background:#1f2937;color:white;border:1px solid #334155}button{background:#22c55e;color:#052e16;font-weight:900;cursor:pointer}button.danger{background:#ef4444;color:white}button.warn{background:#f59e0b;color:#111827}button.copy{background:#64748b;color:white}.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}.grid label{display:flex;flex-direction:column;gap:6px;color:#cbd5e1;font-size:12px}.actions{display:flex;gap:8px;flex-wrap:wrap}.top{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:11px;border-bottom:1px solid #243244;vertical-align:middle}th{color:#93c5fd}.pill{display:inline-block;padding:4px 8px;border-radius:999px;font-weight:900;font-size:12px}.active{background:#14532d;color:#86efac}.inactive{background:#451a1a;color:#fecaca}.muted{color:#94a3b8}.msg{min-height:20px;color:#86efac;font-weight:700}.hide{display:none}@media(max-width:900px){.grid{grid-template-columns:1fr 1fr}table{font-size:12px}.wrap{padding:14px}}
  </style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div><h1>Relay Tools Admin</h1><div class="sub">Relay Contract Refresher license manager</div></div>
    <div class="actions"><button class="copy" id="refreshBtn">Refresh</button><button class="danger" id="logoutBtn">Logout</button></div>
  </div>
  <div id="loginBox" class="card">
    <h2>Admin login</h2>
    <p class="muted">Enter your admin password from Render environment variable ADMIN_PASSWORD.</p>
    <input id="password" type="password" placeholder="Admin password" style="width:280px;max-width:100%">
    <button id="loginBtn">Login</button>
    <div id="loginMsg" class="msg"></div>
  </div>
  <div id="appBox" class="hide">
    <div class="card">
      <h2>Add or update license</h2>
      <div class="grid">
        <label>Email<input id="email" placeholder="client@email.com"></label>
        <label>License Key<input id="license_key" placeholder="auto if empty"></label>
        <label>Plan<select id="plan"><option>starter</option><option>pro</option><option>fleet</option><option>owner</option><option>demo</option></select></label>
        <label>Status<select id="status"><option>active</option><option>inactive</option><option>cancelled</option></select></label>
        <label>Expires<input id="expiresAt" type="date"></label>
        <label>Max devices<input id="maxDevices" type="number" value="1" min="1"></label>
      </div>
      <div class="actions" style="margin-top:12px"><button id="saveBtn">Save license</button><button class="copy" id="clearBtn">Clear form</button><button class="warn" id="genBtn">Generate key</button></div>
      <div id="msg" class="msg"></div>
    </div>
    <div class="card">
      <h2>Licenses</h2>
      <div style="overflow:auto"><table><thead><tr><th>Email</th><th>Key</th><th>Plan</th><th>Status</th><th>Expires</th><th>Devices</th><th>Actions</th></tr></thead><tbody id="rows"></tbody></table></div>
    </div>
  </div>
</div>
<script>
(function(){
  var adminPassword = localStorage.getItem('rcr_admin_password') || '';
  var currentLicenses = [];
  function byId(id){ return document.getElementById(id); }
  function headers(){ return {'Content-Type':'application/json','x-admin-password':adminPassword}; }
  function showMsg(text,bad){ var el=byId('msg'); if(!el) return; el.style.color=bad?'#fecaca':'#86efac'; el.textContent=text; setTimeout(function(){el.textContent='';},3500); }
  function showLoginMsg(text){ var el=byId('loginMsg'); el.style.color='#fecaca'; el.textContent=text; }
  function defaultDate(){ var d=new Date(); d.setMonth(d.getMonth()+1); byId('expiresAt').value=d.toISOString().slice(0,10); }
  function clearForm(){ ['email','license_key'].forEach(function(id){byId(id).value='';}); byId('plan').value='starter'; byId('status').value='active'; byId('maxDevices').value=1; defaultDate(); }
  function generateKey(){ function p(){return Math.random().toString(36).slice(2,6).toUpperCase();} byId('license_key').value='RCR-'+p()+'-'+p()+'-'+new Date().getFullYear(); }
  function escapeHtml(value){ return String(value == null ? '' : value).replace(/[&<>"']/g,function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]; }); }
  function renderRows(){
    var rows = byId('rows');
    rows.innerHTML = currentLicenses.map(function(l){
      var key = escapeHtml(l.license_key);
      var statusClass = l.status === 'active' ? 'active' : 'inactive';
      var expires = l.expiresAt ? new Date(l.expiresAt).toLocaleDateString() : '';
      return '<tr><td>'+escapeHtml(l.email)+'</td><td><code>'+key+'</code></td><td>'+escapeHtml(l.plan)+'</td><td><span class="pill '+statusClass+'">'+escapeHtml(l.status)+'</span></td><td>'+escapeHtml(expires)+'</td><td>'+escapeHtml((l.devices ? l.devices.length : 0) + '/' + (l.maxDevices || 1))+'</td><td class="actions"><button class="copy editBtn" data-key="'+key+'">Edit</button><button class="warn toggleBtn" data-key="'+key+'">Toggle</button><button class="danger deleteBtn" data-key="'+key+'">Delete</button></td></tr>';
    }).join('');
  }
  async function loadLicenses(){
    if(!adminPassword){ byId('loginBox').classList.remove('hide'); byId('appBox').classList.add('hide'); return; }
    try {
      var res = await fetch('/admin/licenses',{headers:headers()});
      if(res.status===401){ logout(); showLoginMsg('Wrong password or server not redeployed yet.'); return; }
      var data = await res.json();
      if(!data.ok){ showLoginMsg(data.error || 'Login failed'); return; }
      currentLicenses = data.licenses || [];
      byId('loginBox').classList.add('hide'); byId('appBox').classList.remove('hide');
      renderRows();
    } catch(e) { showLoginMsg('Server error: '+e.message); }
  }
  function login(){ adminPassword = byId('password').value.trim(); localStorage.setItem('rcr_admin_password',adminPassword); loadLicenses(); }
  function logout(){ localStorage.removeItem('rcr_admin_password'); adminPassword=''; byId('appBox').classList.add('hide'); byId('loginBox').classList.remove('hide'); }
  function editLicenseByKey(key){
    var l = currentLicenses.find(function(x){return x.license_key === key;}); if(!l) return;
    byId('email').value=l.email||''; byId('license_key').value=l.license_key||''; byId('plan').value=l.plan||'starter'; byId('status').value=l.status||'active'; byId('expiresAt').value=l.expiresAt ? new Date(l.expiresAt).toISOString().slice(0,10) : ''; byId('maxDevices').value=l.maxDevices||1; window.scrollTo({top:0,behavior:'smooth'});
  }
  async function saveLicense(){
    var body={email:byId('email').value,license_key:byId('license_key').value,plan:byId('plan').value,status:byId('status').value,expiresAt:byId('expiresAt').value,maxDevices:byId('maxDevices').value};
    var res=await fetch('/admin/licenses',{method:'POST',headers:headers(),body:JSON.stringify(body)}); var data=await res.json();
    if(!data.ok){showMsg(data.error||'Error',true);return;} showMsg('Saved: '+data.license.license_key); clearForm(); loadLicenses();
  }
  async function toggleLicense(key){ await fetch('/admin/licenses/toggle',{method:'POST',headers:headers(),body:JSON.stringify({license_key:key})}); loadLicenses(); }
  async function deleteLicense(key){ if(!confirm('Delete license '+key+'?')) return; await fetch('/admin/licenses/delete',{method:'POST',headers:headers(),body:JSON.stringify({license_key:key})}); loadLicenses(); }
  document.addEventListener('click',function(e){
    if(e.target.id==='loginBtn') login();
    if(e.target.id==='logoutBtn') logout();
    if(e.target.id==='refreshBtn') loadLicenses();
    if(e.target.id==='saveBtn') saveLicense();
    if(e.target.id==='clearBtn') clearForm();
    if(e.target.id==='genBtn') generateKey();
    if(e.target.classList.contains('editBtn')) editLicenseByKey(e.target.dataset.key);
    if(e.target.classList.contains('toggleBtn')) toggleLicense(e.target.dataset.key);
    if(e.target.classList.contains('deleteBtn')) deleteLicense(e.target.dataset.key);
  });
  byId('password').addEventListener('keydown',function(e){ if(e.key==='Enter') login(); });
  defaultDate(); loadLicenses();
})();
</script>
</body></html>`);
});

app.get('/admin/licenses', requireAdmin, (req, res) => {
  res.json({ ok: true, licenses: loadLicenses() });
});

app.post('/admin/licenses', requireAdmin, (req, res) => {
  try {
    const next = normaliseLicense(req.body);
    const licenses = loadLicenses();
    const index = licenses.findIndex(item => cleanKey(item.license_key) === next.license_key);
    if (index >= 0) licenses[index] = { ...licenses[index], ...next };
    else licenses.push(next);
    saveLicenses(licenses);
    res.json({ ok: true, license: next });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/admin/licenses/toggle', requireAdmin, (req, res) => {
  const key = cleanKey(req.body.license_key);
  const licenses = loadLicenses();
  const license = licenses.find(item => cleanKey(item.license_key) === key);
  if (!license) return res.status(404).json({ ok: false, error: 'not_found' });
  license.status = license.status === 'active' ? 'inactive' : 'active';
  saveLicenses(licenses);
  res.json({ ok: true, license });
});

app.post('/admin/licenses/delete', requireAdmin, (req, res) => {
  const key = cleanKey(req.body.license_key);
  const licenses = loadLicenses();
  const next = licenses.filter(item => cleanKey(item.license_key) !== key);
  saveLicenses(next);
  res.json({ ok: true, deleted: licenses.length - next.length });
});


app.post('/create-customer-portal-session', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();

    if (!email) {
      return res.status(400).json({
        ok: false,
        error: 'email_required'
      });
    }

    const licenses = loadLicenses();

    const license = licenses.find(item =>
      String(item.email || '').trim().toLowerCase() === email &&
      String(item.status || '').toLowerCase() === 'active'
    );

    if (!license || !license.stripeCustomerId) {
      return res.status(404).json({
        ok: false,
        error: 'active_subscription_not_found'
      });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: license.stripeCustomerId,
      return_url: process.env.APP_URL || 'https://relaytools.co.uk'
    });

    return res.json({
      ok: true,
      url: session.url
    });

  } catch (error) {
    console.error('Customer portal failed:', error.message);

    return res.status(500).json({
      ok: false,
      error: 'portal_failed'
    });
  }
});



app.post('/get-license-by-email', (req, res) => {
  try {
    const secret = String(req.headers['x-rcr-secret'] || '');

    if (process.env.RCR_API_SECRET && secret !== process.env.RCR_API_SECRET) {
      return res.status(403).json({
        ok: false,
        error: 'forbidden'
      });
    }

    const email = String(req.body.email || '').trim().toLowerCase();

    const licenses = loadLicenses();

    const found = licenses.find(item =>
      String(item.email || '').trim().toLowerCase() === email &&
      String(item.status || '').toLowerCase() === 'active'
    );

    if (!found) {
      return res.json({
        ok: false,
        error: 'license_not_found'
      });
    }

    return res.json({
      ok: true,
      licenseKey: found.license_key || '',
      plan: found.plan || 'pro',
      expires: found.expiresAt || found.expires || '',
      maxDevices: found.maxDevices || 1,
      usedDevices: Array.isArray(found.devices) ? found.devices.length : 0
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'server_error'
    });
  }
});



app.get('/manage-subscription', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
<title>Manage Subscription | RelayTools</title>
<style>
body{background:#050816;color:white;font-family:Arial;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{background:#0f172a;border:1px solid #1e293b;border-radius:20px;padding:32px;width:420px}
input,button{width:100%;padding:14px;border-radius:10px;border:none;margin-top:12px;box-sizing:border-box}
input{background:#111827;color:white}
button{background:#0ea5e9;color:white;font-weight:bold;cursor:pointer}
#msg{margin-top:15px;color:#93c5fd}
</style>
</head>
<body>
<div class="box">
<h1>Manage Subscription</h1>
<p>Enter your license email to manage or cancel your subscription securely through Stripe.</p>
<input id="email" placeholder="Email">
<button onclick="openPortal()">Open Stripe Portal</button>
<div id="msg"></div>
</div>
<script>
async function openPortal(){
  const email=document.getElementById('email').value.trim().toLowerCase();
  const msg=document.getElementById('msg');
  msg.textContent='Opening portal...';
  try{
    const r=await fetch('/create-customer-portal-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
    const d=await r.json();
    if(d.ok && d.url){ location.href=d.url; return; }
    msg.textContent=d.error || 'Could not open portal.';
  }catch(e){ msg.textContent='Server error.'; }
}
</script>
</body>
</html>`);
});


app.listen(PORT, () => {
  console.log(`Relay Contract Refresher license server v3.1.0 running on port ${PORT}`);
});
