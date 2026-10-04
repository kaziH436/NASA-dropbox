const http = require('http');
const https = require('https');
const querystring = require('querystring');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const NASA_API_URL = 'https://api.nasa.gov/planetary/apod';
const DROPBOX_UPLOAD_URL = 'https://content.dropboxapi.com/2/files/upload';

function sendHtml(response, statusCode, htmlBody) {
  response.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(htmlBody);
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(text);
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data, null, 2));
}

function parseBody(request, callback) {
  let rawBody = '';

  request.on('data', function (chunk) {
    rawBody += chunk;
  });

  request.on('end', function () {
    if (!rawBody) {
      return callback(null, {});
    }

    try {
      const parsed = querystring.parse(rawBody);
      callback(null, parsed);
    } catch (error) {
      callback(error);
    }
  });

  request.on('error', callback);
}

function getLandingPageHtml() {
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>NASA Dropbox</title>
        <style>
          body { font-family: Arial, sans-serif; background: #081421; color: #edf6ff; padding: 40px; }
          .panel { max-width: 620px; margin: 0 auto; background: #13263d; border-radius: 16px; padding: 24px; }
          label { display: block; margin-top: 14px; font-weight: bold; }
          input { width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #46637d; background: #0b1a2d; color: white; margin-top: 8px; }
          button { margin-top: 18px; padding: 12px 18px; background: linear-gradient(135deg, #7dd3fc, #60a5fa); border: none; border-radius: 10px; font-weight: bold; cursor: pointer; }
        </style>
      </head>
      <body>
        <div class="panel">
          <h1>NASA Dropbox</h1>
          <p>Fetch a NASA image and upload it to Dropbox in one server-driven workflow.</p>
          <form method="POST" action="/submit">
            <label for="apiKey">NASA API key</label>
            <input id="apiKey" name="apiKey" type="text" placeholder="DEMO_KEY or your NASA key" required />

            <label for="date">Observation date</label>
            <input id="date" name="date" type="date" />

            <label for="dropboxToken">Dropbox access token</label>
            <input id="dropboxToken" name="dropboxToken" type="password" placeholder="Dropbox bearer token" required />

            <label for="folder">Dropbox folder</label>
            <input id="folder" name="folder" type="text" value="NASA Dropbox" />

            <button type="submit">Fetch and Upload</button>
          </form>
        </div>
      </body>
    </html>
  `;
}

function buildNasaUrl(date, apiKey) {
  const params = { api_key: apiKey };

  if (date && date.trim() !== '') {
    params.date = date.trim();
  }

  return NASA_API_URL + '?' + querystring.stringify(params);
}

function requestNasaImage(date, apiKey, callback) {
  const requestUrl = buildNasaUrl(date, apiKey);
  console.log('API 1 called: NASA APOD');

  https.get(requestUrl, function (response) {
    let body = '';

    response.on('data', function (chunk) {
      body += chunk;
    });

    response.on('end', function () {
      if (response.statusCode >= 400) {
        return callback(new Error('NASA API request failed: ' + response.statusCode + ' ' + body));
      }

      try {
        const result = JSON.parse(body);

        if (!result || result.media_type !== 'image' || !result.url) {
          return callback(new Error('NASA API did not return a usable image.'));
        }

        callback(null, result);
      } catch (error) {
        callback(error);
      }
    });
  }).on('error', callback);
}

function downloadImageBytes(imageUrl, callback) {
  https.get(imageUrl, function (response) {
    if (response.statusCode >= 400) {
      return callback(new Error('Image download failed: ' + response.statusCode));
    }

    const chunks = [];

    response.on('data', function (chunk) {
      chunks.push(chunk);
    });

    response.on('end', function () {
      callback(null, Buffer.concat(chunks));
    });
  }).on('error', callback);
}

function buildDropboxPath(folder, originalFileName) {
  const safeFolder = (folder || 'NASA Dropbox').replace(/^\/+|\/+$/g, '');
  const safeFileName = (originalFileName || 'nasa-image.jpg').replace(/^\/+/, '');
  return '/' + safeFolder + '/' + safeFileName;
}

function getImageFileName(imageInfo) {
  const imageUrl = imageInfo.hdurl || imageInfo.url;
  const parsed = url.parse(imageUrl);
  const candidate = path.basename(parsed.pathname || 'nasa-image.jpg');
  const datePrefix = (imageInfo.date || 'nasa').replace(/[^0-9-]/g, '');
  return datePrefix + '-' + candidate;
}

function uploadToDropbox(dropboxToken, folder, imageInfo, imageBuffer, callback) {
  const fileName = getImageFileName(imageInfo);
  const dropboxPath = buildDropboxPath(folder, fileName);
  const requestBody = JSON.stringify({
    path: dropboxPath,
    mode: 'overwrite',
    autorename: true,
    mute: false
  });

  console.log('API 2 called: Dropbox upload');

  const request = https.request(DROPBOX_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + dropboxToken,
      'Dropbox-API-Arg': requestBody,
      'Content-Type': 'application/octet-stream'
    }
  }, function (response) {
    let body = '';

    response.on('data', function (chunk) {
      body += chunk;
    });

    response.on('end', function () {
      if (response.statusCode >= 400) {
        return callback(new Error('Dropbox upload failed: ' + response.statusCode + ' ' + body));
      }

      try {
        const result = body ? JSON.parse(body) : {};
        callback(null, result);
      } catch (error) {
        callback(error);
      }
    });
  });

  request.on('error', callback);
  request.write(imageBuffer);
  request.end();
}

function handleSubmit(request, response) {
  parseBody(request, function (error, form) {
    if (error) {
      return sendJson(response, 400, { error: 'Form parsing failed', message: error.message });
    }

    const apiKey = (form.apiKey || process.env.NASA_API_KEY || '').trim();
    const date = (form.date || '').trim();
    const dropboxToken = (form.dropboxToken || process.env.DROPBOX_ACCESS_TOKEN || '').trim();
    const folder = (form.folder || 'NASA Dropbox').trim() || 'NASA Dropbox';

    if (!apiKey || !dropboxToken) {
      return sendJson(response, 400, {
        error: 'Missing required input',
        message: 'Both NASA API key and Dropbox access token are required.'
      });
    }

    requestNasaImage(date, apiKey, function (nasaError, imageInfo) {
      if (nasaError) {
        return sendJson(response, 502, {
          error: 'NASA API failed',
          message: nasaError.message
        });
      }

      downloadImageBytes(imageInfo.hdurl || imageInfo.url, function (downloadError, imageBuffer) {
        if (downloadError) {
          return sendJson(response, 502, {
            error: 'Image download failed',
            message: downloadError.message
          });
        }

        uploadToDropbox(dropboxToken, folder, imageInfo, imageBuffer, function (dropboxError, uploadResult) {
          if (dropboxError) {
            return sendJson(response, 502, {
              error: 'Dropbox upload failed',
              message: dropboxError.message
            });
          }

          const resultPage = `
            <!doctype html>
            <html>
              <head><meta charset="utf-8" /><title>Upload complete</title></head>
              <body style="font-family: Arial, sans-serif; background:#081421; color:#edf6ff; padding:40px;">
                <h1>Upload complete</h1>
                <p><strong>Title:</strong> ${imageInfo.title || 'NASA image'}</p>
                <p><strong>Date:</strong> ${imageInfo.date || date || 'n/a'}</p>
                <p><strong>Dropbox path:</strong> ${folder}/${getImageFileName(imageInfo)}</p>
                <p><strong>Source URL:</strong> ${imageInfo.hdurl || imageInfo.url}</p>
                <p><a href="/">Upload another image</a></p>
              </body>
            </html>
          `;

          sendHtml(response, 200, resultPage);
        });
      });
    });
  });
}

function createServer() {
  return http.createServer(function (request, response) {
    const requestUrl = new URL(request.url, 'http://' + request.headers.host);

    if (request.method === 'GET' && requestUrl.pathname === '/') {
      return sendHtml(response, 200, getLandingPageHtml());
    }

    if (request.method === 'POST' && requestUrl.pathname === '/submit') {
      return handleSubmit(request, response);
    }

    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      return sendJson(response, 200, { status: 'ok' });
    }

    return sendText(response, 404, 'Not found');
  });
}

function startServer() {
  const server = createServer();
  server.listen(PORT, function () {
    console.log('NASA Dropbox server listening on http://localhost:' + PORT);
  });
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createServer,
  startServer,
  requestNasaImage,
  downloadImageBytes,
  uploadToDropbox,
  buildDropboxPath,
  getImageFileName,
  buildNasaUrl
};
