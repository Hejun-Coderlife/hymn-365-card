/* 和服务器说话（同源 /api/*）。没登录就跳登录页。 */
async function api(path, data) {
  const opt = data === undefined ? { credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hymn': '1' }, body: JSON.stringify(data) };
  let r;
  try { r = await fetch('/api' + path, opt); } catch (e) { throw new Error('网络不通，请检查网络后再试'); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/login') { location.href = '/login.html?to=' + encodeURIComponent(location.pathname); throw new Error('请先登录'); }
  if (!r.ok) throw new Error(j.error || ('出错了（' + r.status + '）'));
  return j;
}
async function logout() { try { await api('/logout', {}); } catch (e) {} location.href = '/login.html'; }
