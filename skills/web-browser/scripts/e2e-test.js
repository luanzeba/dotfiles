const WebSocket = require('ws');
const fs = require('fs');
const ws = new WebSocket('ws://localhost:9222/devtools/page/F4A64D4410B9DE0B4EADB60D9D8FC0CA');
ws.on('open', () => {
  // Clear and reload
  ws.send(JSON.stringify({id:1, method:'Runtime.evaluate', params:{
    expression: 'localStorage.clear(); location.reload(); true',
    returnByValue: true
  }}));
  
  // Wait for reload, then click sync
  setTimeout(() => {
    ws.send(JSON.stringify({id:2, method:'Runtime.evaluate', params:{
      expression: "const btn = document.getElementById('btn-workiq-sync'); btn ? (btn.click(), 'clicked') : 'no button';",
      returnByValue: true
    }}));
  }, 3000);
  
  // Wait for sync to complete, then check state
  setTimeout(() => {
    ws.send(JSON.stringify({id:3, method:'Runtime.evaluate', params:{
      expression: "JSON.stringify({events: JSON.parse(localStorage.getItem('tidycalendar.events.v1') || '[]').length, logs: JSON.parse(localStorage.getItem('tidycalendar.logs.v1') || '[]').slice(0,3), pills: document.querySelectorAll('.event-pill').length})",
      returnByValue: true
    }}));
  }, 25000);
  
  // Screenshot
  setTimeout(() => {
    ws.send(JSON.stringify({id:4, method:'Page.captureScreenshot', params:{format:'png'}}));
  }, 26000);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.id === 2) console.log('Sync click:', msg.result && msg.result.result && msg.result.result.value);
  if (msg.id === 3) console.log('State:', msg.result && msg.result.result && msg.result.result.value);
  if (msg.id === 4) {
    const buf = Buffer.from(msg.result.data, 'base64');
    fs.writeFileSync('/tmp/tidycal-e2e-test.png', buf);
    console.log('Screenshot: /tmp/tidycal-e2e-test.png');
    ws.close();
  }
});
