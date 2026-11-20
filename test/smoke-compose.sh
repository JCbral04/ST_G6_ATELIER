#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Requiere compose up --wait y los usuarios del seed de demostración.
docker compose exec -T backend node - <<'JS'
const assert = require('node:assert/strict');
const base = 'http://127.0.0.1:3000';
const sessions = [];
async function request(path, { method = 'GET', body, token, origin = base } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
}
async function login(correo, rol) {
  const res = await request('/api/auth/login', { method: 'POST', body: { correo, contrasena: '123456' } });
  assert.equal(res.status, 200, `Login ${rol}`);
  const data = await res.json();
  assert.ok(data.token);
  sessions.push(data.token);
  assert.equal(data.usuario.rol, rol);
  return data.token;
}
async function main() {
  try {
    const health = await request('/api/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).base_de_datos, true);
    for (const path of ['/', '/ia.html']) {
      const res = await request(path);
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get('content-type') || '', /text\/html/);
      await res.arrayBuffer();
    }
    console.log('PASS: API, PostgreSQL y páginas HTML');
    const body = { horizon_days: 15, lead_days: 7 };
    assert.equal((await request('/api/v1/predict/restock', { origin: 'http://ai:8000', method: 'POST', body })).status, 401);
    assert.equal((await request('/api/ia/reposicion', { method: 'POST', body })).status, 401);
    const vendor = await login('vendedor@atelier.com', 'vendedor');
    assert.equal((await request('/api/ia/reposicion', { method: 'POST', body, token: vendor })).status, 403);
    const admin = await login('admin@atelier.com', 'administrador');
    assert.equal((await request('/api/auth/me', { token: admin })).status, 200);
    console.log('PASS: autenticación y separación de roles');
    const prediction = await request('/api/ia/reposicion', { method: 'POST', body, token: admin });
    assert.equal(prediction.status, 200);
    const data = await prediction.json();
    assert.equal(data.modo, 'prediccion', 'La IA no debe responder en fallback');
    assert.ok(Array.isArray(data.items) && data.items.length > 0);
    console.log('PASS: predicción real de IA');
    assert.equal((await request('/api/auth/logout', { method: 'POST', token: admin })).status, 200);
    assert.equal((await request('/api/auth/me', { token: admin })).status, 401);
    console.log('PASS: revocación de sesión');
  } finally {
    for (const token of sessions) await request('/api/auth/logout', { method: 'POST', token }).catch(() => {});
  }
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
JS

docker compose exec -T ai python - <<'PY'
import os
import psycopg
with psycopg.connect(os.environ['AI_DATABASE_URL']) as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT current_user, current_setting('transaction_read_only'), has_table_privilege(current_user, 'public.pedido', 'INSERT'), has_table_privilege(current_user, 'public.variante_producto', 'UPDATE')")
        assert cur.fetchone() == ('ai_readonly', 'on', False, False), 'Permisos IA inesperados'
print('PASS: rol analítico sin permisos de escritura verificados')
PY
