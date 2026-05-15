const tracked = document.getElementById('trackedCount');
const changes = document.getElementById('changeCount');
const nextScan = document.getElementById('nextScan');
const scanText = document.getElementById('scanText');

let seconds = 17;
let changeNumber = 8;

setInterval(() => {
  seconds -= 1;
  if (seconds <= 0) {
    seconds = Math.floor(15 + Math.random() * 11);
    changeNumber += Math.random() > 0.55 ? 1 : 0;
  }

  if (nextScan) nextScan.textContent = `${seconds}s`;
  if (scanText) scanText.textContent = `Click refresh in ${seconds}s • 15–25s`;
  if (tracked) tracked.textContent = String(38 + Math.floor(Math.random() * 8));
  if (changes) changes.textContent = String(changeNumber);
}, 1000);
