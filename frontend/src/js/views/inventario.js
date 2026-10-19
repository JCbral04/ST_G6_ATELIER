/* =============================================================
   Vista: Inventario — estado de existencias por variante (RF-09, RF-10)
   ============================================================= */
(function (A) {
  'use strict';
  const esc = A.esc;

  let soloBajo = false;

  A.views.inventario = {
    title: 'Inventario',
    icon: '▤',
    roles: ['administrador', 'vendedor'],

    render() {
      const all = A.store.variantes;
      const rows = soloBajo ? all.filter(A.isLow) : all;
      const max = Math.max.apply(null, all.map(function (v) { return v.stock; }).concat([1]));
      const unidades = all.reduce(function (t, v) { return t + v.stock; }, 0);
      const bajos = all.filter(A.isLow).length;

      return `
      <div class="kpis">
        <div><div class="k">VARIANTES</div><div class="v">${all.length}</div></div>
        <div><div class="k">UNIDADES EN STOCK</div><div class="v">${unidades.toLocaleString('es-CO')}</div></div>
        <div><div class="k">STOCK BAJO</div><div class="v ${bajos ? 'alert' : ''}">${bajos}</div></div>
        <div><div class="k">VALOR A PRECIO VENTA</div><div class="v">${A.fmt(all.reduce(function (t, v) { return t + v.stock * v.precio; }, 0))}</div></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px">
        <h3 class="sec" style="margin:0">STOCK POR VARIANTE — ACTUALIZADO POR TRIGGERS EN CADA VENTA Y COMPRA</h3>
        <label style="display:flex;gap:8px;align-items:center;margin:0;cursor:pointer">
          <input type="checkbox" id="solo-bajo" style="width:auto" ${soloBajo ? 'checked' : ''}> SOLO STOCK BAJO
        </label>
      </div>
      ${rows.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>SKU</th><th>Producto</th><th>Talla</th><th>Color</th>
          <th class="num">Stock</th><th class="num">Mínimo</th><th>Nivel</th><th>Estado</th></tr></thead>
        <tbody>
        ${rows.map(function (v) {
          const low = A.isLow(v);
          const pct = Math.round(Math.min(100, v.stock / max * 100));
          return `<tr class="${low ? 'low' : ''}">
            <td><b>${esc(v.sku)}</b></td><td>${esc(v.producto)}</td><td>${esc(v.talla)}</td>
            <td><span class="swatch" style="background:${esc(v.codigo_hex || '#ccc')}"></span>${esc(v.color)}</td>
            <td class="num"><b>${esc(v.stock)}</b></td><td class="num">${esc(v.stock_minimo)}</td>
            <td><div class="stockbar" title="${pct}%"><i style="width:${pct}%"></i></div></td>
            <td>${low ? '<span class="pill pill-warn">Stock bajo</span>' : '<span class="pill pill-ok">OK</span>'}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table></div>` : '<div class="empty">No hay variantes con stock bajo.</div>'}`;
    },

    bind(root) {
      root.querySelector('#solo-bajo').addEventListener('change', function (e) {
        soloBajo = e.target.checked;
        A.app.refresh();
      });
    },
  };
})(window.Atelier);
