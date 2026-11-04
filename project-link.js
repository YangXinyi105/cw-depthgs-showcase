// The project opened in 项目档案 in this browser tab, shared with 三维浏览 and 人工复核 so they can
// open its models and photos directly. Stored in sessionStorage next to the archive's own access data.
const KEY = 'cw:project';

export function rememberProject(project) {
  try { if (project) sessionStorage.setItem(KEY, JSON.stringify(project)); else sessionStorage.removeItem(KEY); } catch {}
}

export function currentProject() {
  try {
    const p = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    return p && typeof p.base === 'string' && /^[a-f0-9]{32}$/.test(p.id) && (p.admin || p.token) ? p : null;
  } catch { return null; }
}

const headers = p => p.admin ? {'X-Admin-Key': p.admin} : {Authorization: 'Bearer ' + p.token};
const url = (p, suffix = '') => p.base + '/api/projects/' + encodeURIComponent(p.id) + suffix;

async function failure(response, fallback) {
  let text = fallback + '（' + response.status + '）';
  try { const data = await response.json(); if (typeof data.detail === 'string') text = data.detail; } catch {}
  return Error(response.status === 404 ? '项目不存在或访问已失效，请在项目档案中重新打开' : text);
}

export async function projectDetail(p, signal) {
  const response = await fetch(url(p), {headers: headers(p), referrerPolicy: 'no-referrer', signal});
  if (!response.ok) throw await failure(response, '项目读取失败');
  return response.json();
}

export async function assetBlob(p, asset, signal, onProgress) {
  const response = await fetch(url(p, '/assets/' + encodeURIComponent(asset.id) + '/file'), {headers: headers(p), referrerPolicy: 'no-referrer', signal});
  if (!response.ok) throw await failure(response, '文件读取失败');
  if (!onProgress || !response.body) return response.blob();
  const size = Number(asset.size) || Number(response.headers.get('content-length'));
  const total = Number.isFinite(size) && size > 0 ? size : null;
  const reader = response.body.getReader(), chunks = [];
  let loaded = 0;
  onProgress({loaded, total, percent: total ? 0 : null});
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      chunks.push(value); loaded += value.byteLength;
      onProgress({loaded, total, percent: total ? Math.min(99, Math.floor(loaded / total * 100)) : null});
    }
    onProgress({loaded, total: loaded, percent: 100});
    return new Blob(chunks, {type: response.headers.get('content-type') || 'application/octet-stream'});
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

export async function uploadAsset(p, blob, name, kind, actor = '项目成员') {
  const form = new FormData();
  form.append('file', blob, name);
  form.append('kind', kind);
  form.append('actor', actor);
  const response = await fetch(url(p, '/assets'), {method: 'POST', headers: headers(p), body: form, referrerPolicy: 'no-referrer'});
  if (!response.ok) throw await failure(response, '上传失败');
  return response.json();
}

// Replace the notes of the given photos; others' notes on other photos are kept.
export async function saveAnnotations(p, notesByAsset, actor = '项目成员') {
  const detail = await projectDetail(p);
  const edited = new Set(Object.keys(notesByAsset));
  const annotations = [...detail.annotations.filter(n => !edited.has(n.asset_id)),
    ...Object.entries(notesByAsset).flatMap(([assetId, notes]) => notes.map(n => ({id: n.id, asset_id: assetId, x: n.x, y: n.y, note: n.note, status: n.status})))];
  const response = await fetch(url(p, '/annotations'), {method: 'PUT', headers: {...headers(p), 'Content-Type': 'application/json'}, referrerPolicy: 'no-referrer',
    body: JSON.stringify({revision: detail.project.revision, actor, annotations})});
  if (!response.ok) throw await failure(response, '标注保存失败');
  return response.json();
}

export const canEditProject = p => !!p && p.role !== 'read';
