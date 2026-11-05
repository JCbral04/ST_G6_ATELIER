/* =============================================================
   ATELIER — shell de la aplicación: sesión, navegación y router
   Rutas por hash: #/pos (principal), #/dashboard, #/inventario, #/compras
   ============================================================= */
(function (A) {
  'use strict';

  const ORDER = ['pos', 'dashboard', 'inventario', 'compras'];   // el POS es la vista principal
  const $ = function (id) { return document.getElementById(id); };
  let current = null;

  function allowed() {
    return ORDER.filter(function (k) { return A.views[k].roles.indexOf(A.session.rol) !== -1; });
  }

  function renderNav() {
    $('nav').innerHTML = '<span class="nav-slider" aria-hidden="true"></span>' + allowed().map(function (k) {
      const v = A.views[k];
      return `<a href="#/${k}" data-v="${k}">${A.esc(v.nav || v.title)}</a>`;
    }).join('');
  }

  // Mueve el broche del metro hasta la sección activa
  function moverBroche() {
    const on = document.querySelector('#nav a.on');
    const slider = document.querySelector('#nav .nav-slider');
    if (!on || !slider) return;
    slider.style.width = on.offsetWidth + 'px';
    slider.style.transform = 'translateX(' + on.offsetLeft + 'px)';
  }

  // Números del metro: uno por cada rayita larga (cada 40px)
  function numerarMetro() {
    const cont = $('tape-num');
    const n = Math.ceil(cont.offsetWidth / 40);
    let html = '';
    for (let i = 1; i <= n; i++) html += '<span style="left:' + (i * 40) + 'px">' + i + '</span>';
    cont.innerHTML = html;
  }

  function updateChrome() {
    const low = A.store.variantes.filter(A.isLow).length;
    $('low-count').textContent = low;
    const canInv = A.app.can('inventario');
    $('bell').hidden = !canInv;
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
    document.title = v.title + ' – Atelier';

    // Contenedor nuevo en cada render: los listeners de la vista anterior se descartan
    const root = document.createElement('div');
    root.className = 'view-root';
    root.innerHTML = v.render();
    $('screen').replaceChildren(root);
    if (v.bind) v.bind(root);

    updateChrome();
    moverBroche();
    if (location.hash !== '#/' + view) history.replaceState(null, '', '#/' + view);
  }

  function route() {
    if (!A.session) return;
    show(location.hash.replace(/^#\/?/, '') || 'pos');
  }

  async function enterApp() {
    $('login').hidden = true;
    $('app').hidden = false;
    $('user-name').textContent = A.session.nombre;
    $('user-role').textContent = A.session.rol;
    renderNav();
    numerarMetro();
    $('screen').innerHTML = '<div class="empty">Cargando datos…</div>';
    await A.api.load();
    route();
  }

  function logout() {
    A.session = null;
    A.store.venta = [];
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

    $('logout-btn').addEventListener('click', logout);
    window.addEventListener('hashchange', route);
    window.addEventListener('resize', function () { if (A.session) { numerarMetro(); moverBroche(); } });
    // Los avisos de "por reponer" abren el inventario ya filtrado
    $('bell').addEventListener('click', function () {
      A.views.inventario.soloPorReponer();
      if (current === 'inventario') A.app.refresh();
    });

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
