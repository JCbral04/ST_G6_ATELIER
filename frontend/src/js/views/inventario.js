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
  let vista = 'fichas';   // 'fichas' (talla × color), 'lista' (tabla por variante) o 'movimientos'
  // Ajuste manual en curso (se conserva al cambiar filtros)
  let ajuste = { id_variante: '', tipo: 'salida', cantidad: '', motivo: '' };
  const MOTIVOS = { salida: ['Prenda dañada', 'Pérdida o robo', 'Devolución a proveedor', 'Conteo físico'],
                    entrada: ['Devolución de cliente', 'Conteo físico', 'Prenda encontrada'] };

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

  // Vista de movimientos: registrar un ajuste manual + historial (PR #30)
  function movimientosHtml() {
    const invOk = A.api.disponible('variantes');
    const ids = filtrar().map(function (v) { return v.id_variante; });
    // Sin inventario no hay con qué filtrar: se muestra todo el historial
    const hist = A.store.movimientos
      .filter(function (m) { return !invOk || ids.indexOf(Number(m.id_variante)) !== -1; })
      .sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha) || b.id_movimiento - a.id_movimiento; })
      .slice(0, 60);
    const v = A.store.variantes.find(function (x) { return x.id_variante === Number(ajuste.id_variante); });

    const puede = A.api.puede('ajustar');

    return `<div class="mov-cols">
      ${!puede.ok ? `<section class="orden ajuste">
        <h3>Registrar ajuste</h3>
        ${A.noDisponible('Los ajustes están desactivados.', puede.motivo)}
      </section>` : `<form class="orden ajuste" id="ajuste" novalidate>
        <h3>Registrar ajuste</h3>
        <p class="orden-ayuda">Para entradas o salidas que no son ventas ni compras: daños, pérdidas, conteos o devoluciones.</p>
        <label class="orden-campo">Prenda
          <select name="id_variante" required>
            <option value="">Elige la prenda</option>
            ${A.store.variantes.map(function (x) {
              return `<option value="${esc(x.id_variante)}" ${String(x.id_variante) === String(ajuste.id_variante) ? 'selected' : ''}>
                ${esc(x.producto)}, talla ${esc(x.talla)}, ${esc(String(x.color).toLowerCase())} (${esc(x.sku)}: ${esc(x.stock)})</option>`;
            }).join('')}
          </select>
        </label>
        ${v ? `<div class="ajuste-prenda">${A.prenda.de(v, 'venta-thumb')}<span>Hay <b>${esc(v.stock)}</b> en bodega, mínimo ${esc(v.stock_minimo)}.</span></div>` : ''}
        <div class="ajuste-fila">
          <div class="vista-toggle" role="group" aria-label="Tipo de movimiento">
            <button type="button" data-tipo="entrada" aria-pressed="${ajuste.tipo === 'entrada'}">Entrada</button>
            <button type="button" data-tipo="salida" aria-pressed="${ajuste.tipo === 'salida'}">Salida</button>
          </div>
          <label class="mini-select">Cantidad <input name="cantidad" type="number" min="1" step="1" inputmode="numeric" value="${esc(ajuste.cantidad)}" required></label>
        </div>
        <label class="orden-campo">Motivo
          <input name="motivo" maxlength="200" placeholder="¿Por qué entra o sale?" value="${esc(ajuste.motivo)}" required>
        </label>
        <div class="cat-chips motivos">${MOTIVOS[ajuste.tipo].map(function (m) {
          return `<button type="button" class="chip-btn" data-motivo="${esc(m)}">${esc(m)}</button>`;
        }).join('')}</div>
        <p class="form-error" id="ajuste-error" role="alert"></p>
        <button type="submit" class="btn btn-block">Registrar ${ajuste.tipo === 'entrada' ? 'entrada' : 'salida'}</button>
        ${A.api.esDemo() ? '<p class="regla-fija">Modo demo: el ajuste se simula y no se guarda.</p>' : ''}
      </form>`}

      <section>
        <h3 class="sec">Historial de movimientos</h3>
        ${!A.api.disponible('movimientos') ? A.noDisponible('No se pudo cargar el historial.', A.frase(A.api.motivo('movimientos'))) : hist.length ? `<ol class="historial">${hist.map(function (m) {
          const x = A.store.variantes.find(function (y) { return y.id_variante === Number(m.id_variante); }) || m;
          return `<li class="mov mov-${esc(m.tipo)}">
            ${A.prenda.de(x, 'inv-thumb')}
            <div class="mov-info">
              <div><b>${esc(m.sku)}</b> ${esc(m.producto)}, talla ${esc(m.talla)}, ${esc(String(m.color).toLowerCase())}</div>
              <div class="sub">${esc(m.motivo)}. ${esc(m.usuario)}, ${esc(A.fecha(m.fecha))} ${esc(A.hora(m.fecha))}</div>
            </div>
            <b class="mov-cant">${m.tipo === 'entrada' ? '+' : '−'}${esc(m.cantidad)}</b>
          </li>`;
        }).join('')}</ol>` : '<div class="empty">No hay movimientos para estos filtros.</div>'}
      </section>
    </div>`;
  }

  function resultadosHtml() {
    if (vista === 'movimientos') return movimientosHtml();
    if (!A.api.disponible('variantes')) return '';   // el aviso ya está arriba
    if (vista === 'lista') return tablaHtml();
    return fichasHtml();
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
      const cats = uniq(all.map(function (v) { return v.categoria; })).sort();
      const chip = function (name, value, label) {
        return `<button type="button" class="chip-btn" data-f="${name}" data-val="${esc(value)}" aria-pressed="${f[name] === value}">${esc(label)}</button>`;
      };

      return `
      ${A.api.disponible('variantes') ? `<p class="inv-resumen"><b>${unidades.toLocaleString('es-CO')}</b> unidades en bodega en <b>${all.length}</b> variantes.
        ${bajos ? `<b class="violeta">${bajos} por reponer.</b>` : 'Nada por reponer.'}</p>`
        : `<div class="inv-resumen">${A.noDisponible('No se pudo cargar el inventario.', A.frase(A.api.motivo('variantes')) + ' No se muestran datos de prueba en una sesión real.')}</div>`}

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
            <button type="button" data-vista="movimientos" aria-pressed="${vista === 'movimientos'}">Movimientos</button>
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

      // Formulario de ajuste manual (vista Movimientos)
      function err(msg) { const p = out.querySelector('#ajuste-error'); if (p) p.textContent = msg || ''; }
      out.addEventListener('input', function (e) {
        if (!e.target.closest('#ajuste') || !e.target.name) return;
        ajuste[e.target.name] = e.target.value;
        err('');
      });
      out.addEventListener('change', function (e) {
        if (e.target.name === 'id_variante') { ajuste.id_variante = e.target.value; pintar(); }
      });
      out.addEventListener('click', function (e) {
        const b = e.target.closest('#ajuste button[type=button]');
        if (!b) return;
        if (b.dataset.tipo) { ajuste.tipo = b.dataset.tipo; pintar(); }
        if (b.dataset.motivo) {
          ajuste.motivo = b.dataset.motivo;
          const m = out.querySelector('#ajuste [name=motivo]');
          m.value = ajuste.motivo; m.focus(); err('');
        }
      });
      out.addEventListener('submit', async function (e) {
        if (e.target.id !== 'ajuste') return;
        e.preventDefault();
        const cantidad = Number(ajuste.cantidad);
        const motivo = String(ajuste.motivo || '').trim();
        if (!ajuste.id_variante) { err('Elige la prenda del ajuste.'); return; }
        if (!Number.isInteger(cantidad) || cantidad <= 0) { err('La cantidad debe ser un número entero mayor a 0.'); out.querySelector('#ajuste [name=cantidad]').focus(); return; }
        if (!motivo) { err('Escribe el motivo del ajuste o elige uno de los sugeridos.'); out.querySelector('#ajuste [name=motivo]').focus(); return; }
        const btn = e.target.querySelector('[type=submit]');
        btn.disabled = true;
        try {
          const r = await A.api.registrarMovimiento({ id_variante: Number(ajuste.id_variante), tipo: ajuste.tipo, cantidad: cantidad, motivo: motivo });
          // El stock del mensaje es el que devuelve la API (stock_actual), no el de la pantalla
          const sku = r.sku || ((A.store.variantes.find(function (x) { return x.id_variante === Number(ajuste.id_variante); }) || {}).sku || '');
          A.toast('<b>' + (ajuste.tipo === 'entrada' ? 'Entrada' : 'Salida') + (r.demo ? ' simulada.' : ' registrada.') + '</b> ' +
            esc(sku) + ' ahora tiene ' + esc(r.stock_actual) + ' en bodega.' + (r.demo ? ' Es modo demo: no se guardó.' : ''));
          ajuste = { id_variante: ajuste.id_variante, tipo: ajuste.tipo, cantidad: '', motivo: '' };
          A.app.refresh();
        } catch (ex) {
          if (ex.vencida) return;
          btn.disabled = false;
          err(ex.status === 422 ? 'No hay suficiente stock para esa salida. ' + A.frase(ex.message) : 'No se pudo registrar el ajuste. ' + A.frase(ex.message));
        }
      });
    },

    // Permite abrir el inventario ya filtrado (p. ej. desde "por reponer")
    soloPorReponer() { f = Object.assign({}, EMPTY, { estado: 'reponer' }); },
  };
})(window.Atelier);
