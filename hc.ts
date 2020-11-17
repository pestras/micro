import * as http from 'http';

let serviceRootURL = process.argv[2];
let port = process.argv[3];

if (!serviceRootURL) {
  console.log('service root path required');
  process.exit(1);
}

let timer: NodeJS.Timer;
let req = http.request({
  hostname: 'localhost',
  port: port || 3000,
  path: serviceRootURL,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
}, res => {
  clearTimeout(timer);
  console.info('STATUS:', res.statusCode);
  if (res.statusCode === 200) return process.exit(0);
  process.exit(1);
});

req.on('error', e => {
  clearTimeout(timer);
  console.error('Error:', e?.message || e);
  process.exit(1);
});

req.end();

timer = setTimeout(() => {
  req.abort();
  console.error('Error:', 'request timeout!');
  process.exit(1);
}, 30000);

