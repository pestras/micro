import { PathPattern } from '@pestras/toolbox/url/path-pattern';
import { fetch } from '@pestras/toolbox/fetch';

let serviceRootURL = process.argv[2];
let port = process.argv[3]; 

if (!serviceRootURL) {
  console.log('service root path required');
  process.exit(1);
} else {
  let path = '/' + PathPattern.Clean(serviceRootURL) + '/healthcheck';
  let port = +process.argv[3] || 3000
  console.log(path, process.argv[3] || 3000);
  fetch({
    url: 'http://localhost:' + port + path,
    timeout: 10000
  })
    .then(res => {
      console.info('STATUS:', res.statusCode);
      if (res.statusCode === 200) process.exit(0);
      else process.exit(1);
    })
    .catch(e => {      
    console.error('ERROR:', e);
    process.exit(1)
    });
}
