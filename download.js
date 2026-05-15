async function verifyLicense(){

    const email = document.getElementById('email').value.trim();
    const key = document.getElementById('license').value.trim();

    const status = document.getElementById('status');

    status.innerHTML = 'Checking license...';

    try{

        const res = await fetch('https://relaytools.co.uk/api/check-license', {
            method:'POST',
            headers:{
                'Content-Type':'application/json'
            },
            body:JSON.stringify({
                email,
                license_key:key
            })
        });

        const data = await res.json();

        if(data.valid){

            status.innerHTML = 'License valid. Download starting...';

            window.location.href = '/RelayContractRefresher.zip';

        }else{

            status.innerHTML = 'Invalid license';

        }

    }catch(err){

        status.innerHTML = 'Server error';

    }

}
