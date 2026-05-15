async function verifyLicense(){

    const email = document.getElementById('email').value.trim().toLowerCase();
    const key = document.getElementById('license').value.trim();

    const status = document.getElementById('status');

    status.innerHTML = 'Checking license...';

    try{

        const res = await fetch(
            'https://relay-license-server.onrender.com/get-license-by-email',
            {
                method:'POST',
                headers:{
                    'Content-Type':'application/json',
                    'x-rcr-secret':'RCR_SECURE_2026'
                },
                body:JSON.stringify({
                    email
                })
            }
        );

        const data = await res.json();

        if(
            data.ok &&
            data.licenseKey === key
        ){

            status.innerHTML =
                'License valid. Download starting...';

            window.location.href =
                '/RelayContractRefresher.zip';

        }else{

            status.innerHTML =
                'Invalid license';

        }

    }catch(err){

        console.log(err);

        status.innerHTML =
            'Server error';

    }

}
