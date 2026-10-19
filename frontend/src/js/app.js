/* =============================================================
   ATELIER — shell de la aplicación: sesión, navegación y router
   Rutas por hash: #/dashboard, #/pos, #/inventario, #/catalogo, #/compras
   ============================================================= */
(function (A) {
  'use strict';

  const ORDER = ['dashboard', 'pos', 'inventario', 'catalogo', 'compras'];
  const $ = function (id) { return document.getElementById(id); };
  let current = null;

  function allowed() {
    return ORDER.filter(function (k) { return A.views[k].roles.indexOf(A.session.rol) !== -1; });
  }

  function renderNav() {
    $('nav').innerHTML = allowed().map(function (k) {
      const v = A.views[k];
      return `<a href="#/${k}" data-v="${k}"><span class="ico" aria-hidden="true">${v.icon}</span>${A.esc(v.title)}</a>`;
    }).join('');
  }

  function openMenu(open) {
    $('sidebar').classList.toggle('open', open);
    $('backdrop').hidden = !open;
    $('menu-btn').setAttribute('aria-expanded', String(open));
  }

  function updateChrome() {
    const low = A.store.variantes.filter(A.isLow).length;
    $('low-count').textContent = low;
    $('bell-mini').querySelector('b').textContent = low;
    const canInv = A.app.can('inventario');
    $('bell').hidden = !canInv;
    $('bell-mini').hidden = !canInv;
    const src = A.api.sourceLabel();
    const pill = $('data-source');
    pill.textContent = src.text;
    pill.className = 'pill ' + src.cls;
    pill.title = A.store.apiOnline
      ? 'API conectada. Los recursos sin endpoint usan datos de respaldo.'
      : 'API no disponible: se muestran datos de prueba del seed.';
  }

  function show(view) {
    const list = allowed();
    if (list.indexOf(view) === -1) view = list[0];
    current = view;
    const v = A.views[view];

    document.querySelectorAll('#nav a').forEach(function (a) {
      const on = a.dataset.v === view;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    $('view-title').textContent = v.title;
    document.title = v.title + ' · ATELIER';

    // Contenedor nuevo en cada render: los listeners de la vista anterior se descartan
    const root = document.createElement('div');
    root.className = 'view-root';
    root.innerHTML = v.render();
    $('screen').replaceChildren(root);
    if (v.bind) v.bind(root);

    updateChrome();
    openMenu(false);
    if (location.hash !== '#/' + view) history.replaceState(null, '', '#/' + view);
  }

  function route() {
    if (!A.session) return;
    show(location.hash.replace(/^#\/?/, '') || 'dashboard');
  }

  async function enterApp() {
    $('login').hidden = true;
    $('app').hidden = false;
    $('user-name').textContent = A.session.nombre;
    $('user-role').textContent = A.session.rol + ' · sesión activa';
    renderNav();
    $('screen').innerHTML = '<div class="empty">Cargando datos…</div>';
    await A.api.load();
    route();
  }

  function logout() {
    A.session = null;
    A.store.cart = [];
    A.storage.remove('atelier.session');
    $('app').hidden = true;
    $('login').hidden = false;
    history.replaceState(null, '', location.pathname);
    $('correo').focus();
  }

  A.app = {
    refresh: function () { if (current) show(current); },
    can: function (view) { return !!A.session && A.views[view].roles.indexOf(A.session.rol) !== -1; },
  };

  document.addEventListener('DOMContentLoaded', function () {
    A.login.init(function (user) {
      A.session = user;
      A.storage.set('atelier.session', user);
      enterApp();
    });

    $('menu-btn').addEventListener('click', function () { openMenu(!$('sidebar').classList.contains('open')); });
    $('backdrop').addEventListener('click', function () { openMenu(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') openMenu(false); });
    $('logout-btn').addEventListener('click', logout);
    window.addEventListener('hashchange', route);

    // Recuperar sesión de la pestaña (solo datos públicos del usuario, nunca la contraseña)
    const saved = A.storage.get('atelier.session');
    const valid = saved && A.mock.usuarios.find(function (u) { return u.correo === saved.correo; });
    if (valid) {
      A.session = valid;
      enterApp();
    } else {
      $('login').hidden = false;
    }
  });
})(window.Atelier);
