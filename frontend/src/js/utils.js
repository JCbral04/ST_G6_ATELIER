/* =============================================================
   ATELIER — utilidades compartidas
   Namespace global: window.Atelier (scripts clásicos, sin build)
   ============================================================= */
window.Atelier = window.Atelier || { views: {} };

(function (A) {
  'use strict';

  // Formato de moneda colombiana: 45000 -> $45.000
  A.fmt = function (n) {
    return '$' + Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
  };

  // Escapa texto antes de insertarlo como HTML (evita XSS con datos de la BD)
  A.esc = function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  // Hora corta a partir de un timestamp ISO
  A.hora = function (iso) {
    const d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  };

  A.fecha = function (iso) {
    const d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  // Regla RN-04 / RF-10: alerta cuando stock <= stock_minimo
  A.isLow = function (v) {
    return Number(v.stock) <= Number(v.stock_minimo);
  };

  // Mensaje flotante. `html` debe venir ya escapado.
  A.toast = function (html) {
    const t = document.getElementById('toast');
    t.innerHTML = html;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('show'); }, 4000);
  };

  // sessionStorage puede fallar (modo privado, file://): siempre con try/catch
  A.storage = {
    get: function (k) {
      try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; }
    },
    set: function (k, v) {
      try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin persistencia */ }
    },
    remove: function (k) {
      try { sessionStorage.removeItem(k); } catch (e) { /* noop */ }
    },
  };
})(window.Atelier);
