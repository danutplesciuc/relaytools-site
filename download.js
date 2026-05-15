async function verifyLicense(){
  const email = document.getElementById('email').value.trim().toLowerCase();
  const key = document.getElementById('license').value.trim();
  const status = document.getElementById('status');

  if (!email || !key) {
    status.textContent = 'Add email and license key first.';
    return;
  }

  status.textContent = 'Checking license...';

  try {
    const res = await fetch('https://relay-license-server.onrender.com/get-license-by-email', {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'x-rcr-secret':'RCR_SECURE_2026'
      },
      body:JSON.stringify({ email })
    });

    const data = await res.json();

    if (data.ok && data.licenseKey === key) {
      status.textContent = 'License valid. Download starting...';
      window.location.href = '/relaycontractrefresher.zip';
    } else {
      status.textContent = 'Invalid license.';
    }
  } catch(err) {
    console.log(err);
    status.textContent = 'Server error. Try again later.';
  }
}
