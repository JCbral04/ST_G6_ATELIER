/* =============================================================
   Vista: Inventario interno — existencias por variante (RF-06, RF-07, RF-09, RF-10)
   Reemplaza al antiguo catálogo: muestra SKU, talla, color, stock y
   stock mínimo, con filtros por categoría, talla, color y estado.
   ============================================================= */
(function (A) {
  'use strict';
  const esc = A.esc;

  const EMPTY = { q: '', categoria: '', talla: '', color: '', estado: '' };
  let f = Object.assign({}, EMPTY);

  function uniq(list) {
    return list.filter(function (x, i) { return x && list.indexOf(x) === i; });
  }

  function options(values, selected, allLabel) {
    return `<option value="">${allLabel}</option>` + values.map(function (v) {
      return `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(v)}</option>`;
    }).join('');
  }

  function filtrar() {
    const q = f.q.trim().toLowerCase();
    return A.store.variantes.filter(function (v) {
      if (f.categoria && v.categoria !== f.categoria) return false;
      if (f.talla && v.talla !== f.talla) return false;
      if (f.color && v.color !== f.color) return false;
      if (f.estado === 'reponer' && !A.isLow(v)) return false;
      if (f.estado === 'suficiente' && A.isLow(v)) return false;
      if (q && (v.producto + ' ' + v.sku).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function tablaHtml() {
    const all = A.store.variantes;
    const rows = filtrar();
    const max = Math.max.apply(null, all.map(function (v) { return v.stock; }).concat([1]));
    if (!rows.length) {
      return f.estado === 'reponer' && !f.q && !f.categoria && !f.talla && !f.color
        ? '<div class="all-good">No hay nada por reponer.</div>'
        : '<div class="empty">Ninguna variante coincide con estos filtros. Prueba quitando alguno.</div>';
    }
    return `
      <div class="result-count">${rows.length === 1 ? '1 variante' : rows.length + ' variantes'}</div>
      <div class="table-wrap"><table>
        <thead><tr><th>SKU</th><th>Producto</th><th>Categoría</th><th>Talla</th><th>Color</th>
          <th class="num">Stock</th><th class="num">Mínimo</th><th>Nivel</th><th>Estado</th></tr></thead>
        <tbody>
        ${rows.map(function (v) {
          const low = A.isLow(v);
          const pct = Math.round(Math.min(100, v.stock / max * 100));
          return `<tr class="${low ? 'low' : ''}">
            <td class="sku">${A.prenda.de(v, 'inv-thumb')}${esc(v.sku)}</td><td>${esc(v.producto)}</td><td>${esc(v.categoria)}</td>
            <td>${esc(v.talla)}</td>
            <td><span class="swatch" style="background:${esc(v.codigo_hex || '#ccc')}"></span>${esc(v.color)}</td>
            <td class="num"><b>${esc(v.stock)}</b></td><td class="num">${esc(v.stock_minimo)}</td>
            <td><div class="stockbar" title="${pct}%"><i style="width:${pct}%"></i></div></td>
            <td>${low ? '<span class="pill pill-warn">Reponer</span>' : '<span class="pill pill-ok">Suficiente</span>'}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table></div>`;
  }

  A.views.inventario = {
    title: 'Inventario',
    roles: ['administrador', 'vendedor'],

    render() {
      const all = A.store.variantes;
      const unidades = all.reduce(function (t, v) { return t + v.stock; }, 0);
      const bajos = all.filter(A.isLow).length;
      const tallasOrden = A.mock.tallas;
      const tallas = uniq(all.map(function (v) { return v.talla; }))
        .sort(function (a, b) { return tallasOrden.indexOf(a) - tallasOrden.indexOf(b); });

      return `
      <div class="kpis">
        <div><div class="k">Variantes</div><div class="v">${all.length}</div></div>
        <div><div class="k">Unidades en bodega</div><div class="v">${unidades.toLocaleString('es-CO')}</div></div>
        <div><div class="k">Por reponer</div><div class="v ${bajos ? 'alert' : ''}">${bajos}</div></div>
        <div><div class="k">Productos</div><div class="v">${uniq(all.map(function (v) { return String(v.id_producto); })).length}</div></div>
      </div>

      <form class="filters filters-inv" id="inv-filters" role="search">
        <div class="f-search"><label for="f-q">Buscar</label>
          <input id="f-q" name="q" placeholder="Nombre o SKU" value="${esc(f.q)}"></div>
        <div><label for="f-categoria">Categoría</label>
          <select id="f-categoria" name="categoria">${options(uniq(all.map(function (v) { return v.categoria; })).sort(), f.categoria, 'Todas')}</select></div>
        <div><label for="f-talla">Talla</label>
          <select id="f-talla" name="talla">${options(tallas, f.talla, 'Todas')}</select></div>
        <div><label for="f-color">Color</label>
          <select id="f-color" name="color">${options(uniq(all.map(function (v) { return v.color; })).sort(), f.color, 'Todos')}</select></div>
        <div><label for="f-estado">Estado</label>
          <select id="f-estado" name="estado">
            <option value="">Todos</option>
            <option value="reponer" ${f.estado === 'reponer' ? 'selected' : ''}>Por reponer</option>
            <option value="suficiente" ${f.estado === 'suficiente' ? 'selected' : ''}>Suficiente</option>
          </select></div>
        <div><button type="button" class="btn-mini" id="f-clear">Limpiar filtros</button></div>
      </form>

      <p class="sec-note">El stock se actualiza solo con cada venta y cada compra recibida.</p>
      <div id="inv-results">${tablaHtml()}</div>`;
    },

    bind(root) {
      const form = root.querySelector('#inv-filters');
      const out = root.querySelector('#inv-results');
      function update(e) {
        f[e.target.name] = e.target.value;
        out.innerHTML = tablaHtml();   // solo la tabla: no se pierde el foco del input
      }
      form.addEventListener('submit', function (e) { e.preventDefault(); });
      form.addEventListener('input', update);
      form.addEventListener('change', update);
      root.querySelector('#f-clear').addEventListener('click', function () {
        f = Object.assign({}, EMPTY);
        A.app.refresh();
      });
    },

    // Permite abrir el inventario ya filtrado (p. ej. desde "por reponer")
    soloPorReponer() { f = Object.assign({}, EMPTY, { estado: 'reponer' }); },
  };
})(window.Atelier);
