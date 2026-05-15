const LICENSE_SERVER = 'https://relay-license-server.onrender.com';

function setStatus(message, isBad = false) {
  const status = document.getElementById('status');
  if (!status) return;
  status.textContent = message;
  status.style.color = isBad ? '#fca5a5' : '#86efac';
}

async function continueWithGoogle() {
  setStatus('Opening Google sign-in...');

  /*
    Website Google login needs a web OAuth flow.
    The Chrome extension already uses Chrome Identity API inside the extension.
    For the public website, this button sends the user to the extension download flow.
    After install, the extension handles Google account picker and automatic license activation.
  */

  setStatus('Install the extension, then click Choose Google Account inside Relay Tools Pro.');
  setTimeout(() => {
    window.location.href = '/relaycontractrefresher.zip';
  }, 900);
}

async function verifyLicense(){
  const email = document.getElementById('email').value.trim().toLowerCase();
  const key = document.getElementById('license').value.trim();

  if (!email || !key) {
    setStatus('Add email and license key first.', true);
    return;
  }

  setStatus('Checking license...');

  try {
    const res = await fetch(`${LICENSE_SERVER}/get-license-by-email`, {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'x-rcr-secret':'RCR_SECURE_2026'
      },
      body:JSON.stringify({ email })
    });

    const data = await res.json();

    if (data.ok && data.licenseKey === key) {
      setStatus('License valid. Download starting...');
      window.location.href = '/relaycontractrefresher.zip';
    } else {
      setStatus('Invalid license.', true);
    }
  } catch(err) {
    console.log(err);
    setStatus('Server error. Try again later.', true);
  }
}
