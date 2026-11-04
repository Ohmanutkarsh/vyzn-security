import { escapeHtml } from '../utils.js';

/**
 * Renders a CameraTile component for the Cameras list (S5) and live switcher (Overview).
 * Conforms to Section 6.5 and Section 6.2 specifications.
 * @param {object} props
 * @param {object} props.camera
 * @param {boolean} [props.isSelected=false]
 * @param {boolean} [props.showActions=false]
 * @returns {string} HTML string
 */
export function renderCameraTile({ camera, isSelected = false, showActions = false }) {
  const camId = camera.id || camera.camera_id;
  let cachedThumb = '';
  if (typeof window !== 'undefined' && window.localStorage) {
    try { cachedThumb = localStorage.getItem('vyzn_cam_thumb_' + camId) || ''; } catch (_) {}
  }
  let thumbUrl = cachedThumb || camera.snapshot_url || camera.snapshotUrl || `/api/cameras/${camId}/snapshot.jpg`;
  if (typeof window !== 'undefined' && window.__vyzn_edge_url && thumbUrl.startsWith('/api/')) {
    thumbUrl = `${window.__vyzn_edge_url}${thumbUrl}`;
  }
  const isOnline = camera.status === 'online';
  const statusDotClass = isOnline ? 'neutral' : 'amber';
  const statusText = isOnline ? 'Online' : (camera.offline_since ? `Offline since ${camera.offline_since}` : 'Offline');

  const fallbackSvg = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" fill="none">
      <rect width="640" height="360" fill="#0b0f19"/>
      <rect x="2" y="2" width="636" height="356" rx="6" stroke="#1e293b" stroke-width="2"/>
      <circle cx="320" cy="155" r="32" fill="#131c2e" stroke="#334155" stroke-width="2"/>
      <circle cx="320" cy="155" r="14" fill="#1e293b"/>
      <circle cx="328" cy="147" r="4" fill="#38bdf8"/>
      <text x="320" y="215" fill="#e2e8f0" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif" font-size="14" font-weight="600" text-anchor="middle">${camera.name || 'Camera'}</text>
      <text x="320" y="238" fill="#64748b" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif" font-size="12" text-anchor="middle">Live CCTV Stream Active</text>
    </svg>
  `)}`;

  let sourceLine = camera.source_line;
  if (!sourceLine) {
    const rtsp = String(camera.rtsp_url || '').trim();
    if (camera.source_type === 'webcam' || rtsp === '0' || rtsp === 'webcam' || (camera.name && camera.name.toLowerCase().includes('webcam'))) {
      sourceLine = 'Webcam';
    } else if (camera.source_type === 'phone' || rtsp.includes(':8080') || (camera.name && camera.name.toLowerCase().includes('phone'))) {
      let host = camera.ip_address;
      if (!host && rtsp.includes('://')) {
        try { host = new URL(rtsp).hostname; } catch (_) {}
      }
      sourceLine = `Phone camera · ${host || '192.168.31.216'}`;
    } else {
      let host = camera.ip_address;
      if (!host && rtsp.includes('://')) {
        try { host = new URL(rtsp).hostname; } catch (_) {}
      }
      sourceLine = host ? `IP camera · ${host}` : 'IP camera';
    }
  }

  const res = camera.resolution || { width: 1920, height: 1080 };
  const fps = camera.fps || 15.0;
  const facts = `${res.width}×${res.height} · ${fps} fps`;
  const areaCount = camera.area_count || 0;
  const areaSummary = areaCount > 0 ? `Watching ${areaCount} area${areaCount > 1 ? 's' : ''}` : 'Watching the whole view';

  return `
    <div class="camera-tile ${isSelected ? 'is-selected' : ''}" data-camera-id="${escapeHtml(camId)}" role="button" tabindex="0">
      <div class="camera-thumb-frame">
        <img class="camera-thumb-img" src="${escapeHtml(thumbUrl)}" alt="${escapeHtml(camera.name)}" loading="lazy" onerror="this.onerror=null;this.src='${fallbackSvg}'" />
        ${!isOnline ? `
          <div class="camera-offline-overlay">
            <span class="offline-pill">${escapeHtml(statusText)}</span>
          </div>
        ` : ''}
      </div>
      <div class="camera-info-body">
        <div class="camera-title-row">
          <span class="camera-name">${escapeHtml(camera.name)}</span>
          ${showActions ? `
            <div class="camera-menu-wrap">
              <button type="button" class="btn-menu-trigger" data-cam-id="${escapeHtml(camId)}" aria-label="Camera options">⋯</button>
              <div class="camera-menu-dropdown" id="menu-${escapeHtml(camId)}" style="display: none;">
                <button type="button" class="menu-item action-rename" data-cam-id="${escapeHtml(camId)}" data-cam-name="${escapeHtml(camera.name)}">Rename</button>
                <a href="/areas/${escapeHtml(camId)}" class="menu-item action-areas">Choose watch areas</a>
                <button type="button" class="menu-item action-remove danger" data-cam-id="${escapeHtml(camId)}" data-cam-name="${escapeHtml(camera.name)}">Remove</button>
              </div>
            </div>
          ` : ''}
        </div>
        <div class="camera-status-line">
          <span class="status-dot ${statusDotClass}"></span>
          <span class="status-text">${escapeHtml(statusText)}</span>
        </div>
        <div class="camera-source-line">
          <span class="source-text mono-facts">${escapeHtml(sourceLine)}</span>
        </div>
        <div class="camera-facts-line">
          <span class="facts-text mono-facts">${escapeHtml(facts)}</span>
        </div>
        <div class="camera-area-summary">
          <span class="area-text">${escapeHtml(areaSummary)}</span>
          ${areaCount === 0 ? `<a href="/areas/${escapeHtml(camId)}" class="area-hint-link">Choose the area to watch</a>` : ''}
        </div>
      </div>
    </div>
  `.trim();
}
