/* =============================================================
   Vista: Inventario interno — existencias por variante (RF-06, RF-07, RF-09, RF-10)
   Reemplaza al antiguo catálogo. Dos vistas:
   - Fichas: una por prenda, con su foto y una cuadrícula talla × color
   - Lista: tabla por variante con SKU, talla, color, stock y mínimo
   Filtros por búsqueda, categoría, talla, color y estado.
   ============================================================= */
(function (A) {
  'use strict';
  const esc = A.esc;

  const EMPTY = { q: '', categoria: '', talla: '', color: '', estado: '' };
  let f = Object.assign({}, EMPTY);
  let vista = 'fichas';   // 'fichas' (talla × color) o 'lista' (tabla por variante)

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
    if (!rows.length) return vacioHtml();
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

  // Vista de fichas: una por producto, con cuadrícula talla × color
  function fichasHtml() {
    const pasan = filtrar();
    if (!pasan.length) return vacioHtml();
    const orden = A.mock.tallas;
    const grupos = {};
    pasan.forEach(function (v) { grupos[v.id_producto] = true; });

    return `<div class="fichas">${Object.keys(grupos).map(function (id) {
      const vars = A.store.variantes.filter(function (v) { return String(v.id_producto) === id; });
      const p = vars[0];
      const tallas = uniq(vars.map(function (v) { return v.talla; })).sort(function (a, b) { return orden.indexOf(a) - orden.indexOf(b); });
      const colores = uniq(vars.map(function (v) { return v.color; }));
      const total = vars.reduce(function (t, v) { return t + v.stock; }, 0);
      const reponer = vars.filter(A.isLow).length;
      const max = Math.max.apply(null, vars.map(function (v) { return v.stock; }).concat([1]));
      const foto = vars.find(function (v) { return pasan.indexOf(v) !== -1; }) || p;

      return `<article class="ficha">
        <div class="ficha-foto">${A.prenda.de(foto, 'ficha-img')}</div>
        <div class="ficha-cuerpo">
          <header class="ficha-head">
            <div>
              <h3>${esc(p.producto)}</h3>
              <p class="desc">${esc(p.categoria)}. ${total.toLocaleString('es-CO')} unidades en bodega${reponer ? `, <b class="violeta">${reponer} por reponer</b>` : ''}.</p>
            </div>
          </header>
          <div class="table-wrap matriz-wrap"><table class="matriz">
            <thead><tr><th scope="col"><span class="sr-only">Color</span></th>${tallas.map(function (t) { return `<th scope="col">${esc(t)}</th>`; }).join('')}</tr></thead>
            <tbody>${colores.map(function (c) {
              const muestra = vars.find(function (v) { return v.color === c; });
              return `<tr><th scope="row"><span class="swatch" style="background:${esc(muestra.codigo_hex || '#ccc')}"></span>${esc(c)}</th>${tallas.map(function (t) {
                const v = vars.find(function (x) { return x.color === c && x.talla === t; });
                if (!v) return '<td class="celda vacia" title="No se fabrica en esta combinación">—</td>';
                const cls = v.stock === 0 ? 'agotada' : (A.isLow(v) ? 'low' : '');
                const fuera = pasan.indexOf(v) === -1 ? ' fuera' : '';
                const pct = Math.round(Math.min(100, v.stock / max * 100));
                return `<td class="celda ${cls}${fuera}" title="${esc(v.sku)}: ${esc(v.stock)} en bodega, mínimo ${esc(v.stock_minimo)}">
                  <b>${esc(v.stock)}</b><small>mín ${esc(v.stock_minimo)}</small><span class="hilo"><i style="width:${pct}%"></i></span></td>`;
              }).join('')}</tr>`;
            }).join('')}</tbody>
          </table></div>
        </div>
      </article>`;
    }).join('')}</div>`;
  }

  function vacioHtml() {
    return f.estado === 'reponer' && !f.q && !f.categoria && !f.talla && !f.color
      ? '<div class="all-good">No hay nada por reponer.</div>'
      : '<div class="empty">Ninguna variante coincide con estos filtros. Prueba quitando alguno.</div>';
  }

  function resultadosHtml() { return vista === 'lista' ? tablaHtml() : fichasHtml(); }

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
      const cats = uniq(all.map(function (v) { return v.categoria; })).sort();
      const chip = function (name, value, label) {
        return `<button type="button" class="chip-btn" data-f="${name}" data-val="${esc(value)}" aria-pressed="${f[name] === value}">${esc(label)}</button>`;
      };

      return `
      <p class="inv-resumen"><b>${unidades.toLocaleString('es-CO')}</b> unidades en bodega en <b>${all.length}</b> variantes.
        ${bajos ? `<b class="violeta">${bajos} por reponer.</b>` : 'Nada por reponer.'}</p>

      <form class="inv-tools" id="inv-filters" role="search">
        <input class="search" id="f-q" name="q" type="search" placeholder="Busca por nombre o SKU" value="${esc(f.q)}" aria-label="Buscar">
        <div class="cat-chips" role="group" aria-label="Categoría">
          ${chip('categoria', '', 'Todo')}${cats.map(function (c) { return chip('categoria', c, c); }).join('')}
        </div>
        <div class="inv-tools-fila">
          <label class="mini-select">Talla <select id="f-talla" name="talla">${options(tallas, f.talla, 'Todas')}</select></label>
          <label class="mini-select">Color <select id="f-color" name="color">${options(uniq(all.map(function (v) { return v.color; })).sort(), f.color, 'Todos')}</select></label>
          <div class="cat-chips" role="group" aria-label="Estado">
            ${chip('estado', '', 'Todo el stock')}${chip('estado', 'reponer', 'Por reponer')}
          </div>
          <div class="vista-toggle" role="group" aria-label="Vista">
            <button type="button" data-vista="fichas" aria-pressed="${vista === 'fichas'}">Fichas</button>
            <button type="button" data-vista="lista" aria-pressed="${vista === 'lista'}">Lista</button>
          </div>
        </div>
      </form>

      <div id="inv-results">${resultadosHtml()}</div>
      <p class="sec-note inv-nota">El stock se actualiza solo con cada venta y cada compra recibida.</p>`;
    },

    bind(root) {
      const form = root.querySelector('#inv-filters');
      const out = root.querySelector('#inv-results');
      function pintar() { out.innerHTML = resultadosHtml(); }
      form.addEventListener('submit', function (e) { e.preventDefault(); });
      form.addEventListener('input', function (e) { if (e.target.name) { f[e.target.name] = e.target.value; pintar(); } });
      form.addEventListener('change', function (e) { if (e.target.name) { f[e.target.name] = e.target.value; pintar(); } });
      form.addEventListener('click', function (e) {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.f) {
          f[b.dataset.f] = b.dataset.val;
          form.querySelectorAll('[data-f="' + b.dataset.f + '"]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        } else if (b.dataset.vista) {
          vista = b.dataset.vista;
          form.querySelectorAll('[data-vista]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        }
        pintar();
      });
    },

    // Permite abrir el inventario ya filtrado (p. ej. desde "por reponer")
    soloPorReponer() { f = Object.assign({}, EMPTY, { estado: 'reponer' }); },
  };
})(window.Atelier);
