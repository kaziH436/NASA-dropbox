const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createServer } = require('../server');

function request(method, path, payload) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, function () {
      const port = server.address().port;
      const data = payload ? new URLSearchParams(payload).toString() : '';
      const requestOptions = {
        hostname: 'localhost',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(data)
        }
      };

      const requestObject = http.request(requestOptions, function (response) {
        let body = '';
        response.on('data', function (chunk) {
          body += chunk;
        });
        response.on('end', function () {
          server.close();
          resolve({ statusCode: response.statusCode, body });
        });
      });

      requestObject.on('error', function (error) {
        server.close();
        reject(error);
      });

      if (data) {
        requestObject.write(data);
      }

      requestObject.end();
    });
  });
}

test('GET / returns the landing form', async () => {
  const response = await request('GET', '/');
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /NASA Dropbox/i);
  assert.match(response.body, /name="apiKey"/i);
});

test('POST /submit rejects missing required values', async () => {
  const response = await request('POST', '/submit', {
    apiKey: '',
    dropboxToken: ''
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /Missing required input/i);
});

test('buildNasaUrl includes the requested date', () => {
  const url = require('../server').buildNasaUrl('2024-01-01', 'DEMO_KEY');
  assert.match(url, /api_key=DEMO_KEY/);
  assert.match(url, /date=2024-01-01/);
});
