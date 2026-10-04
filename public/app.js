const fileInput = document.getElementById('file-input');
const dropzone = document.getElementById('dropzone');
const fileCount = document.getElementById('file-count');
const storageSize = document.getElementById('storage-size');
const filesList = document.getElementById('files-list');
const refreshButton = document.getElementById('refresh-files');
const fileTemplate = document.getElementById('file-template');
const connectDropboxBtn = document.getElementById('connect-dropbox');
const fetchNasaImageBtn = document.getElementById('fetch-nasa-image');
const nasaApiKeyInput = document.getElementById('nasa-api-key');
const nasaDateInput = document.getElementById('nasa-date');
const authStatus = document.getElementById('auth-status');

async function fetchFiles() {
  const response = await fetch('/api/files');
  if (!response.ok) {
    throw new Error('Unable to load files.');
  }

  const payload = await response.json();
  return payload.files || [];
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function renderFiles(files) {
  filesList.innerHTML = '';

  if (!files.length) {
    filesList.innerHTML = '<p class="empty-state">No mission data uploaded yet.</p>';
    fileCount.textContent = '0';
    storageSize.textContent = '0 B';
    return;
  }

  const totalSize = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
  fileCount.textContent = String(files.length);
  storageSize.textContent = formatBytes(totalSize);

  files.forEach((file) => {
    const fragment = fileTemplate.content.cloneNode(true);
    const name = fragment.querySelector('.file-name');
    const details = fragment.querySelector('.file-details');
    const downloadLink = fragment.querySelector('.download-link');
    const deleteBtn = fragment.querySelector('.delete-btn');

    name.textContent = file.name;
    details.textContent = `${file.sizeLabel} • ${new Date(file.uploadedAt).toLocaleString()}`;
    downloadLink.href = `/api/download/${file.id}`;
    downloadLink.setAttribute('download', file.name);

    deleteBtn.addEventListener('click', async () => {
      const response = await fetch(`/api/files/${file.id}`, { method: 'DELETE' });
      if (response.ok) {
        renderFiles(await fetchFiles());
      }
    });

    filesList.appendChild(fragment);
  });
}

async function loadFiles() {
  try {
    const files = await fetchFiles();
    renderFiles(files);
  } catch (error) {
    filesList.innerHTML = `<p class="empty-state">${error.message}</p>`;
  }
}

async function uploadFiles(fileList) {
  if (!fileList.length) return;

  const formData = new FormData();
  Array.from(fileList).forEach((file) => formData.append('files', file));

  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('Upload failed.');
  }

  await loadFiles();
}

fileInput.addEventListener('change', async (event) => {
  await uploadFiles(event.target.files);
  fileInput.value = '';
});

refreshButton.addEventListener('click', loadFiles);

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});

['dragenter', 'dragover'].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add('drag-over');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove('drag-over');
  });
});

dropzone.addEventListener('drop', async (event) => {
  const droppedFiles = event.dataTransfer?.files;
  if (droppedFiles && droppedFiles.length) {
    await uploadFiles(droppedFiles);
  }
});

async function fetchDropboxStatus() {
  try {
    const response = await fetch('/api/auth/dropbox/status');
    const payload = await response.json();

    if (payload.connected) {
      authStatus.textContent = 'Dropbox connected';
      authStatus.style.color = '#9ae6b4';
      return;
    }

    authStatus.textContent = 'Dropbox not connected';
    authStatus.style.color = '#a4b7d6';
  } catch (_error) {
    authStatus.textContent = 'Dropbox status unavailable';
    authStatus.style.color = '#fca5a5';
  }
}

connectDropboxBtn.addEventListener('click', async () => {
  const response = await fetch('/api/auth/dropbox/status');
  const payload = await response.json();

  if (payload.authUrl) {
    window.location.href = payload.authUrl;
    return;
  }

  authStatus.textContent = 'Dropbox OAuth is not configured on the server';
  authStatus.style.color = '#fca5a5';
});

fetchNasaImageBtn.addEventListener('click', async () => {
  const date = nasaDateInput.value || 'today';
  const apiKey = nasaApiKeyInput.value.trim();

  authStatus.textContent = 'Fetching NASA image...';
  authStatus.style.color = '#7dd3fc';

  const response = await fetch('/api/nasa/fetch-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, apiKey: apiKey || undefined }),
  });

  const payload = await response.json();

  if (!response.ok) {
    if (payload.requiresAuth && payload.authUrl) {
      window.location.href = payload.authUrl;
      return;
    }

    authStatus.textContent = payload.message || 'NASA image upload failed';
    authStatus.style.color = '#fca5a5';
    return;
  }

  authStatus.textContent = `NASA image uploaded to Dropbox: ${payload.dropboxPath}`;
  authStatus.style.color = '#9ae6b4';
  await loadFiles();
});

loadFiles();
fetchDropboxStatus();
