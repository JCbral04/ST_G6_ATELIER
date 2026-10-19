/* =============================================================
   Vista: Catálogo con filtros — categoría, talla, color y precio
   (RF-06 consulta de productos, RF-07 filtros)
   ============================================================= */
(function (A) {
  'use strict';
  const esc = A.esc, fmt = A.fmt;

  const EMPTY = { q: '', categoria: '', talla: '', color: '', min: '', max: '' };
  let f = Object.assign({}, EMPTY);

  function uniq(list) {
    return list.filter(function (x, i) { return x && list.indexOf(x) === i; });
  }

  function options(values, selected, allLabel) {
    return `<option value="">${allLabel}</option>` + values.map(function (v) {
      return `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(v)}</option>`;
    }).join('');
  }

  // Agrupa variantes por producto aplicando los filtros
  function filtrar() {
    const q = f.q.trim().toLowerCase();
    const min = f.min === '' ? -Infinity : Number(f.min);
    const max = f.max === '' ? Infinity : Number(f.max);
    const prods = {};

    A.store.variantes.forEach(function (v) {
      if (f.categoria && v.categoria !== f.categoria) return;
      if (f.talla && v.talla !== f.talla) return;
      if (f.color && v.color !== f.color) return;
      if (v.precio < min || v.precio > max) return;
      if (q && (v.producto + ' ' + v.sku).toLowerCase().indexOf(q) === -1) return;
      const p = prods[v.id_producto] || (prods[v.id_producto] = {
        nombre: v.producto, categoria: v.categoria, precio: v.precio, vars: [],
      });
      p.vars.push(v);
    });
    return Object.keys(prods).map(function (k) { return prods[k]; });
  }

  function resultsHtml() {
    const list = filtrar();
    if (!list.length) {
      return '<div class="empty">Ningún producto coincide con los filtros. Prueba ampliando el rango de precio o limpiando los filtros.</div>';
    }
    return `
      <div class="result-count">${list.length} producto(s) encontrados</div>
      <div class="prod-grid">
      ${list.map(function (p) {
        const disp = p.vars.reduce(function (t, v) { return t + v.stock; }, 0);
        return `<div class="pcard">
          <div class="cat">${esc(String(p.categoria || '').toUpperCase())}</div>
          <h4>${esc(p.nombre)}</h4>
          <div class="prc">${fmt(p.precio)}</div>
          ${p.vars.map(function (v) {
            return `<span class="chip ${A.isLow(v) ? 'low' : ''}" title="${esc(v.sku)}">
              <span class="swatch" style="background:${esc(v.codigo_hex || '#ccc')}"></span>${esc(v.talla)} · ${esc(v.stock)} uds</span>`;
          }).join('')}
          <div class="result-count" style="margin:8px 0 0">${disp} uds. disponibles</div>
        </div>`;
      }).join('')}
      </div>`;
  }

  A.views.catalogo = {
    title: 'Catálogo',
    icon: '◈',
    roles: ['administrador', 'vendedor', 'cliente'],

    render() {
      const vs = A.store.variantes;
      const tallasOrden = A.mock.tallas;
      const tallas = uniq(vs.map(function (v) { return v.talla; }))
        .sort(function (a, b) { return tallasOrden.indexOf(a) - tallasOrden.indexOf(b); });

      return `
      <form class="filters" id="cat-filters" role="search">
        <div class="f-search"><label for="f-q">BUSCAR</label>
          <input id="f-q" name="q" placeholder="Nombre o SKU…" value="${esc(f.q)}"></div>
        <div><label for="f-categoria">CATEGORÍA</label>
          <select id="f-categoria" name="categoria">${options(uniq(vs.map(function (v) { return v.categoria; })).sort(), f.categoria, 'Todas')}</select></div>
        <div><label for="f-talla">TALLA</label>
          <select id="f-talla" name="talla">${options(tallas, f.talla, 'Todas')}</select></div>
        <div><label for="f-color">COLOR</label>
          <select id="f-color" name="color">${options(uniq(vs.map(function (v) { return v.color; })).sort(), f.color, 'Todos')}</select></div>
        <div><label for="f-min">PRECIO MÍN.</label>
          <input id="f-min" name="min" type="number" min="0" step="1000" inputmode="numeric" placeholder="$0" value="${esc(f.min)}"></div>
        <div><label for="f-max">PRECIO MÁX.</label>
          <input id="f-max" name="max" type="number" min="0" step="1000" inputmode="numeric" placeholder="Sin límite" value="${esc(f.max)}"></div>
        <div><button type="button" class="btn-mini" id="f-clear">Limpiar</button></div>
      </form>
      <div id="cat-results">${resultsHtml()}</div>`;
    },

    bind(root) {
      const form = root.querySelector('#cat-filters');
      const out = root.querySelector('#cat-results');
      function update(e) {
        f[e.target.name] = e.target.value;
        out.innerHTML = resultsHtml();   // solo resultados: no se pierde el foco del input
      }
      form.addEventListener('submit', function (e) { e.preventDefault(); });
      form.addEventListener('input', update);
      form.addEventListener('change', update);
      root.querySelector('#f-clear').addEventListener('click', function () {
        f = Object.assign({}, EMPTY);
        A.app.refresh();
      });
    },
  };
})(window.Atelier);
