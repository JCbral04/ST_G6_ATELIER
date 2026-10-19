/* =============================================================
   Vista: Inventario — estado de existencias por variante (RF-09, RF-10)
   ============================================================= */
(function (A) {
  'use strict';
  const esc = A.esc;

  let soloBajo = false;

  A.views.inventario = {
    title: 'Inventario',
    roles: ['administrador', 'vendedor'],

    render() {
      const all = A.store.variantes;
      const rows = soloBajo ? all.filter(A.isLow) : all;
      const max = Math.max.apply(null, all.map(function (v) { return v.stock; }).concat([1]));
      const unidades = all.reduce(function (t, v) { return t + v.stock; }, 0);
      const bajos = all.filter(A.isLow).length;

      return `
      <div class="kpis">
        <div><div class="k">Variantes</div><div class="v">${all.length}</div></div>
        <div><div class="k">Unidades en bodega</div><div class="v">${unidades.toLocaleString('es-CO')}</div></div>
        <div><div class="k">Por reponer</div><div class="v ${bajos ? 'alert' : ''}">${bajos}</div></div>
        <div><div class="k">Valor a precio de venta</div><div class="v">${A.fmt(all.reduce(function (t, v) { return t + v.stock * v.precio; }, 0))}</div></div>
      </div>
      <div class="sec-head">
        <h3 class="sec">Existencias por variante</h3>
        <label class="check"><input type="checkbox" id="solo-bajo" ${soloBajo ? 'checked' : ''}> Mostrar solo lo que hay que reponer</label>
      </div>
      <p class="sec-note">El stock se actualiza solo con cada venta y cada compra recibida.</p>
      ${rows.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>SKU</th><th>Producto</th><th>Talla</th><th>Color</th>
          <th class="num">Stock</th><th class="num">Mínimo</th><th>Nivel</th><th>Estado</th></tr></thead>
        <tbody>
        ${rows.map(function (v) {
          const low = A.isLow(v);
          const pct = Math.round(Math.min(100, v.stock / max * 100));
          return `<tr class="${low ? 'low' : ''}">
            <td class="sku">${esc(v.sku)}</td><td>${esc(v.producto)}</td><td>${esc(v.talla)}</td>
            <td><span class="swatch" style="background:${esc(v.codigo_hex || '#ccc')}"></span>${esc(v.color)}</td>
            <td class="num"><b>${esc(v.stock)}</b></td><td class="num">${esc(v.stock_minimo)}</td>
            <td><div class="stockbar" title="${pct}%"><i style="width:${pct}%"></i></div></td>
            <td>${low ? '<span class="pill pill-warn">Reponer</span>' : '<span class="pill pill-ok">Suficiente</span>'}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table></div>` : '<div class="all-good">No hay nada por reponer.</div>'}`;
    },

    bind(root) {
      root.querySelector('#solo-bajo').addEventListener('change', function (e) {
        soloBajo = e.target.checked;
        A.app.refresh();
      });
    },
  };
})(window.Atelier);
