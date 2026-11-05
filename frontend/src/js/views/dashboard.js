/* =============================================================
   Vista: Resumen del día (RF-10)
   - Lo vendido hoy en una etiqueta de precio grande
   - Lo que hay que reponer como muestras clavadas con alfiler
   - Las últimas ventas como tiquetes de caja apilados
   ============================================================= */
(function (A) {
  'use strict';
  const esc = A.esc, fmt = A.fmt;

  function hoyLargo() {
    return new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  A.views.dashboard = {
    title: 'Resumen',
    nav: 'Resumen',
    roles: ['administrador', 'vendedor'],

    render() {
      const s = A.store;
      const bajos = s.variantes.filter(A.isLow).sort(function (a, b) { return a.stock - b.stock; });
      const hoy = new Date().toDateString();
      const ventasHoy = s.pedidos.filter(function (p) {
        return p.estado !== 'cancelado' && new Date(p.fecha).toDateString() === hoy;
      });
      const totalHoy = ventasHoy.reduce(function (t, p) { return t + p.total; }, 0);
      const promedio = ventasHoy.length ? Math.round(totalHoy / ventasHoy.length) : 0;
      const porRecibir = s.compras.filter(function (c) { return c.estado === 'pendiente'; });
      const ultimas = s.pedidos.slice().sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); }).slice(0, 5);

      return `
      <div class="resumen-top">
        <div class="tag-grande">
          <span class="tag-grande-ojal" aria-hidden="true"></span>
          <p class="tag-grande-fecha">Vendido hoy, ${esc(hoyLargo())}</p>
          <p class="tag-grande-total">${fmt(totalHoy)}</p>
          <dl class="tag-grande-datos">
            <div><dt>Ventas</dt><dd>${ventasHoy.length}</dd></div>
            <div><dt>Promedio por venta</dt><dd>${fmt(promedio)}</dd></div>
          </dl>
        </div>

        <div class="resumen-avisos">
          <a class="aviso ${bajos.length ? 'aviso-violeta' : ''}" href="#/inventario" data-reponer>
            <b>${bajos.length}</b><span>${bajos.length === 1 ? 'variante por reponer' : 'variantes por reponer'}</span>
          </a>
          ${A.app.can('compras') ? `<a class="aviso" href="#/compras">
            <b>${porRecibir.length}</b><span>${porRecibir.length === 1 ? 'compra por recibir' : 'compras por recibir'}</span>
          </a>` : ''}
        </div>
      </div>

      <div class="resumen-cols">
        <section>
          <h3 class="sec">Por reponer</h3>
          ${bajos.length ? `<div class="clavadas">${bajos.map(function (v, i) {
            const pct = Math.max(4, Math.min(100, Math.round(v.stock / Math.max(1, v.stock_minimo) * 100)));
            return `<article class="clavada" style="--giro:${(i % 3 - 1) * 1.6}deg">
              <span class="alfiler" aria-hidden="true"></span>
              <div class="clavada-foto">${A.prenda.de(v, 'clavada-img')}</div>
              <div class="clavada-info">
                <div class="sku">${esc(v.sku)}</div>
                <div class="desc">${esc(v.producto)}, talla ${esc(v.talla)}, ${esc(String(v.color).toLowerCase())}</div>
                <div class="quedan"><b>${v.stock === 0 ? 'Agotada' : 'Quedan ' + esc(v.stock)}</b> de ${esc(v.stock_minimo)} mínimo</div>
                <div class="hilo" aria-hidden="true"><i style="width:${v.stock === 0 ? 0 : pct}%"></i></div>
              </div>
            </article>`;
          }).join('')}</div>` : '<div class="all-good">Todo el inventario está por encima del mínimo.</div>'}
        </section>

        <section>
          <h3 class="sec">Últimas ventas</h3>
          ${ultimas.length ? `<div class="tiquetes">${ultimas.map(function (p) {
            return `<article class="tiquete">
              <div class="tiquete-fila"><b>Pedido ${esc(p.id_pedido)}</b><span>${esc(A.hora(p.fecha))}</span></div>
              <div class="tiquete-fila sub"><span>${esc(p.usuario)}</span><span class="pill ${p.estado === 'cancelado' ? 'pill-warn' : 'pill-ok'}">${esc(p.estado)}</span></div>
              <div class="tiquete-total">${fmt(p.total)}</div>
            </article>`;
          }).join('')}</div>` : '<div class="empty">Todavía no hay ventas. Regístralas desde Vender.</div>'}
        </section>
      </div>`;
    },

    bind(root) {
      const link = root.querySelector('[data-reponer]');
      if (link) link.addEventListener('click', function () { A.views.inventario.soloPorReponer(); });
    },
  };
})(window.Atelier);
