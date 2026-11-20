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
    if (!A.session) return [];
    return ORDER.filter(function (k) { return A.views[k].roles.indexOf(A.session.rol) !== -1; });
  }

  function renderNav() {
    $('nav').innerHTML = '<span class="nav-slider" aria-hidden="true"></span>' + allowed().map(function (k) {
      const v = A.views[k];
      return `<a href="#/${k}" data-v="${k}">${A.esc(v.nav || v.title)}</a>`;
    }).join('');
  }

  // Mueve el fondo negro hasta la sección activa
  function moverBroche() {
    const on = document.querySelector('#nav a.on');
    const slider = document.querySelector('#nav .nav-slider');
    if (!on || !slider) return;
    slider.style.width = on.offsetWidth + 'px';
    slider.style.transform = 'translateX(' + on.offsetLeft + 'px)';
  }

  function updateChrome() {
    const low = A.store.variantes.filter(A.isLow).length;
    $('low-count').textContent = low;
    // Sin inventario real no se puede afirmar cuánto hay por reponer
    $('bell').hidden = !A.app.can('inventario') || !A.api.disponible('variantes');
    const src = A.api.sourceLabel();
    const pill = $('data-source');
    pill.textContent = src.text;
    pill.className = 'pill ' + src.cls;
    pill.title = src.title;
    $('demo-banner').hidden = !A.api.esDemo();
  }

  function show(view) {
    const list = allowed();
    if (!list.length) return;
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

  async function enterApp(sesion) {
    A.api.iniciar(sesion);
    // Defensa extra: un rol sin vistas no entra al panel
    if (!allowed().length) {
      await logout();
      $('login-error').textContent = 'Tu cuenta no tiene acceso al panel de la tienda.';
      return;
    }
    $('login').hidden = true;
    $('app').hidden = false;
    $('user-name').textContent = A.session.nombre;
    $('user-role').textContent = A.session.rol;
    $('demo-banner').hidden = !A.api.esDemo();
    renderNav();
    $('screen').innerHTML = '<div class="empty">Cargando datos…</div>';
    try {
      await A.api.load();
    } catch (e) {
      return;   // la sesión venció mientras cargaba: ya está en el login
    }
    route();
  }

  async function logout() {
    await A.api.logout();
    salir();
  }

  function salir() {
    current = null;
    $('app').hidden = true;
    $('login').hidden = false;
    $('screen').replaceChildren();
    history.replaceState(null, '', location.pathname);
    $('correo').focus();
  }

  A.app = {
    refresh: function () { if (current && A.session) show(current); },
    can: function (view) { return !!A.session && A.views[view].roles.indexOf(A.session.rol) !== -1; },
    // Token vencido o revocado: volver al login con un aviso, sin pasar a demo
    sesionVencida: function () {
      if (!A.session) return;
      A.api.olvidarSesion();
      salir();
      $('login-error').textContent = 'Tu sesión venció. Vuelve a iniciar sesión.';
    },
  };

  document.addEventListener('DOMContentLoaded', function () {
    A.login.init(enterApp);

    $('logout-btn').addEventListener('click', logout);
    window.addEventListener('hashchange', route);
    window.addEventListener('resize', function () { if (A.session) moverBroche(); });
    // Las fuentes cambian el ancho de las secciones: recolocar el broche cuando carguen
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (A.session) moverBroche(); });
    // Los avisos de "por reponer" abren el inventario ya filtrado
    $('bell').addEventListener('click', function () {
      A.views.inventario.soloPorReponer();
      if (current === 'inventario') A.app.refresh();
    });

    // Recuperar la sesión de la pestaña (usuario y token, nunca la contraseña)
    A.api.recuperarSesion().then(function (s) {
      if (s) enterApp(s);
      else $('login').hidden = false;
    }, function (err) {
      $('login').hidden = false;
      $('login-error').textContent = err.message;
    });
  });
})(window.Atelier);
