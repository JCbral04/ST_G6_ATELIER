/* =============================================================
   Vista: Compras a proveedores (RF-16..18)
   - Pedir al proveedor: arma una orden de compra (proveedor, prendas,
     cantidades y costo) y la envía con POST /api/compras
   - Órdenes de compra: lo que viene en camino y lo que ya llegó;
     "Recibir mercancía" suma el stock (PATCH /api/compras/:id)
   - Directorio de proveedores
   En sesión real todo depende de GET /api/compras, /api/proveedores e
   /api/inventario (PR #44 y #15); si alguno falta, la parte que lo usa
   se desactiva y se explica por qué. En modo demo se simula.
   ============================================================= */
(function (A) {
  'use strict';
  const esc = A.esc, fmt = A.fmt;

  const PILL = { recibida: 'pill-ok', pendiente: 'pill-warn', cancelada: 'pill-muted' };
  const ESTADO = { recibida: 'recibida', pendiente: 'por recibir', cancelada: 'cancelada' };

  // Borrador de la orden: se conserva al cambiar de sección
  let borrador = { id_proveedor: '', lineas: [] };   // lineas: { id_variante, cantidad, costo }
  let filtro = 'pendiente';

  function variante(id) { return A.store.variantes.find(function (v) { return v.id_variante === Number(id); }); }
  function varianteSku(sku) { return A.store.variantes.find(function (v) { return v.sku === sku; }); }

  // Unidades que ya vienen en camino por variante (órdenes por recibir)
  function enCamino(id) {
    return A.store.compras.filter(function (c) { return c.estado === 'pendiente'; })
      .reduce(function (t, c) {
        return t + (c.items || []).reduce(function (u, it) {
          const v = it.id_variante ? variante(it.id_variante) : varianteSku(it.sku);
          return u + (v && v.id_variante === id ? Number(it.cantidad) : 0);
        }, 0);
      }, 0);
  }

  // Último costo pagado por la variante, para proponerlo en la orden
  function ultimoCosto(id) {
    const compras = A.store.compras.slice().sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); });
    for (const c of compras) {
      for (const it of (c.items || [])) {
        const v = it.id_variante ? variante(it.id_variante) : varianteSku(it.sku);
        if (v && v.id_variante === id) return Number(it.costo_unitario);
      }
    }
    return '';
  }

  // Regla fija del panel (no es la predicción del servicio de IA):
  // llegar al doble del mínimo, descontando lo que ya viene en camino.
  // Si lo que viene en camino ya alcanza, la sugerencia es 0 y no se agrega.
  function sugerido(v) {
    return Math.max(0, v.stock_minimo * 2 - v.stock - enCamino(v.id_variante));
  }
  function porPedir() {
    return A.store.variantes.filter(function (v) { return A.isLow(v) && sugerido(v) > 0; });
  }

  function agregar(id, cantidad) {
    const v = variante(id);
    if (!v) return;
    const l = borrador.lineas.find(function (x) { return x.id_variante === v.id_variante; });
    if (l) { l.cantidad += cantidad || 1; return; }
    borrador.lineas.push({ id_variante: v.id_variante, cantidad: cantidad || 1, costo: ultimoCosto(v.id_variante) });
  }

  function totalBorrador() {
    return borrador.lineas.reduce(function (t, l) { return t + (Number(l.cantidad) || 0) * (Number(l.costo) || 0); }, 0);
  }

  /* ---------- Pedir al proveedor ---------- */

  function opcionesPrendas() {
    const usados = borrador.lineas.map(function (l) { return l.id_variante; });
    return A.store.variantes.map(function (v) {
      const bajo = A.isLow(v) ? ', por reponer' : '';
      return `<option value="${esc(v.id_variante)}" ${usados.indexOf(v.id_variante) !== -1 ? 'disabled' : ''}>
        ${esc(v.producto)}, talla ${esc(v.talla)}, ${esc(String(v.color).toLowerCase())} (${esc(v.sku)}: ${esc(v.stock)} en bodega${bajo})</option>`;
    }).join('');
  }

  function lineasHtml() {
    if (!borrador.lineas.length) {
      return `<div class="orden-vacia">Agrega las prendas que necesitas. Puedes empezar con lo que hay que reponer.</div>`;
    }
    return borrador.lineas.map(function (l, i) {
      const v = variante(l.id_variante);
      const camino = enCamino(v.id_variante);
      return `<div class="orden-linea" data-i="${i}">
        ${A.prenda.de(v, 'venta-thumb')}
        <div class="orden-info">
          <div>${esc(v.producto)}</div>
          <div class="sub">${esc(v.sku)}, talla ${esc(v.talla)}, ${esc(String(v.color).toLowerCase())}.
            ${esc(v.stock)} en bodega${camino ? ', ' + esc(camino) + ' en camino' : ''}.
            ${A.isLow(v) ? '<b class="violeta">Por reponer</b>' : ''}</div>
          <div class="orden-campos">
            <label>Cantidad <input type="number" min="1" step="1" inputmode="numeric" data-campo="cantidad" data-i="${i}" value="${esc(l.cantidad)}"></label>
            <label>Costo unitario <input type="number" min="1" step="100" inputmode="numeric" data-campo="costo" data-i="${i}" value="${esc(l.costo)}" placeholder="$"></label>
            <button type="button" class="qty-btn del" data-quitar="${i}">Quitar</button>
          </div>
        </div>
        <div class="price" data-sub="${i}">${fmt((Number(l.cantidad) || 0) * (Number(l.costo) || 0))}</div>
      </div>`;
    }).join('');
  }

  function ordenHtml() {
    const s = A.store;
    const puede = A.api.puede('comprar');
    if (!puede.ok) {
      return `<section class="orden" aria-labelledby="orden-titulo">
        <h3 id="orden-titulo">Pedir al proveedor</h3>
        ${A.noDisponible('Los pedidos a proveedores están desactivados.', puede.motivo + ' Las órdenes solo se arman con prendas y proveedores reales.')}
      </section>`;
    }
    const bajos = porPedir();
    return `
    <section class="orden" aria-labelledby="orden-titulo">
      <h3 id="orden-titulo">Pedir al proveedor</h3>
      <p class="orden-ayuda">Arma la orden y envíala. Quedará en "Por recibir" hasta que llegue la mercancía.</p>

      <label class="orden-campo">Proveedor
        <select id="orden-proveedor">
          <option value="">Elige un proveedor</option>
          ${s.proveedores.map(function (p) {
            return `<option value="${esc(p.id_proveedor)}" ${String(p.id_proveedor) === String(borrador.id_proveedor) ? 'selected' : ''}>${esc(p.nombre)}</option>`;
          }).join('')}
        </select>
      </label>

      <div class="orden-agregar">
        <select id="orden-prenda" aria-label="Prenda para agregar">
          <option value="">Agregar una prenda…</option>${opcionesPrendas()}
        </select>
        <button type="button" class="btn-mini" id="orden-reponer" ${bajos.length ? '' : 'disabled'}
          title="Regla fija: completa hasta el doble del stock mínimo">
          Completar al doble del mínimo (${bajos.length})</button>
      </div>

      <div id="orden-lineas">${lineasHtml()}</div>

      <div class="venta-total"><span>Total de la orden</span><span id="orden-total">${fmt(totalBorrador())}</span></div>
      <p class="form-error" id="orden-error" role="alert"></p>
      <div class="orden-acciones">
        <button type="button" class="link-btn oscuro" id="orden-limpiar" ${borrador.lineas.length ? '' : 'hidden'}>Vaciar orden</button>
        <button type="button" class="btn" id="orden-enviar">Enviar pedido al proveedor</button>
      </div>
      <p class="sec-note">El botón de reponer usa una regla fija del panel, no la predicción de la IA: a cada prenda por reponer le pide lo que falta para llegar al doble de su stock mínimo, descontando lo que ya viene en camino. Si lo que viene en camino ya alcanza, esa prenda no se agrega.</p>
      ${A.api.esDemo() ? '<p class="regla-fija">Modo demo: la orden se simula y no se envía a ningún proveedor ni se guarda.</p>' : ''}
    </section>`;
  }

  /* ---------- Órdenes de compra ---------- */

  function ordenesHtml() {
    if (!A.api.disponible('compras')) return A.noDisponible('No se pudieron cargar las órdenes de compra.', A.frase(A.api.motivo('compras')));
    const recibir = A.api.puede('recibir').ok;
    const lista = A.store.compras
      .filter(function (c) { return !filtro || c.estado === filtro; })
      .sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); });
    if (!lista.length) {
      return `<div class="empty">${filtro === 'pendiente' ? 'No hay mercancía en camino.' : 'No hay órdenes en esta lista.'}</div>`;
    }
    return lista.map(function (c) {
      return `<article class="tiquete remision">
        <div class="tiquete-fila"><b>Orden ${esc(c.id_compra)}</b><span class="pill ${PILL[c.estado] || 'pill-muted'}">${esc(ESTADO[c.estado] || c.estado)}</span></div>
        <div class="tiquete-fila sub"><span>${esc(c.proveedor)}</span><span>${esc(A.fecha(c.fecha))}</span></div>
        <ul class="remision-items">${(c.items || []).map(function (it) {
          const v = it.id_variante ? variante(it.id_variante) : varianteSku(it.sku);
          return `<li>${v ? A.prenda.de(v, 'inv-thumb') : ''}<span>${esc(it.cantidad)} × ${esc(it.sku || (v && v.sku))}</span>
            <span class="sub">${fmt(it.costo_unitario)} c/u</span></li>`;
        }).join('')}</ul>
        <div class="remision-pie">
          <span class="tiquete-total">${fmt(c.total)}</span>
          ${c.estado === 'pendiente' && recibir ? `<button class="btn-mini" data-recibir="${esc(c.id_compra)}">Recibir mercancía</button>` : ''}
        </div>
      </article>`;
    }).join('');
  }

  A.views.compras = {
    title: 'Compras y proveedores',
    nav: 'Compras',
    roles: ['administrador'],

    render() {
      const s = A.store;
      const pendientes = s.compras.filter(function (c) { return c.estado === 'pendiente'; });
      const valor = pendientes.reduce(function (t, c) { return t + c.total; }, 0);
      const chip = function (val, label) {
        return `<button type="button" class="chip-btn" data-filtro="${val}" aria-pressed="${filtro === val}">${label}</button>`;
      };

      return `
      <p class="inv-resumen">${!A.api.disponible('compras') ? '' : pendientes.length
        ? `<b>${pendientes.length}</b> ${pendientes.length === 1 ? 'orden' : 'órdenes'} en camino por <b>${fmt(valor)}</b>.`
        : 'No hay mercancía en camino.'}
        ${A.api.disponible('variantes') && s.variantes.filter(A.isLow).length ? `<b class="violeta">${s.variantes.filter(A.isLow).length} variantes por reponer.</b>` : ''}</p>

      <div class="compras-cols">
        <div id="orden-cont">${ordenHtml()}</div>
        <section aria-labelledby="ordenes-titulo">
          <div class="sec-head">
            <h3 class="sec" id="ordenes-titulo">Órdenes de compra</h3>
            ${A.api.disponible('compras') ? `<div class="cat-chips" role="group" aria-label="Estado">${chip('pendiente', 'Por recibir')}${chip('recibida', 'Recibidas')}${chip('', 'Todas')}</div>` : ''}
          </div>
          <div class="tiquetes" id="ordenes">${ordenesHtml()}</div>
        </section>
      </div>

      <h3 class="sec sec-gap">Proveedores</h3>
      ${!A.api.disponible('proveedores') ? A.noDisponible('No se pudieron cargar los proveedores.', A.frase(A.api.motivo('proveedores'))) : `<div class="table-wrap"><table>
        <thead><tr><th>Proveedor</th><th>Contacto</th><th>Correo</th><th>Teléfono</th></tr></thead>
        <tbody>
        ${s.proveedores.map(function (p) {
          return `<tr><td class="sku">${esc(p.nombre)}</td><td>${esc(p.contacto || '—')}</td>
            <td>${esc(p.correo || '—')}</td><td>${esc(p.telefono || '—')}</td></tr>`;
        }).join('')}
        </tbody>
      </table></div>`}`;
    },

    bind(root) {
      const cont = root.querySelector('#orden-cont');
      function pintarOrden() { cont.innerHTML = ordenHtml(); }
      function error(msg) { root.querySelector('#orden-error').textContent = msg || ''; }

      cont.addEventListener('change', function (e) {
        if (e.target.id === 'orden-proveedor') { borrador.id_proveedor = e.target.value; error(''); }
        if (e.target.id === 'orden-prenda' && e.target.value) { agregar(e.target.value, 1); pintarOrden(); }
      });

      // Cantidad y costo: actualiza subtotal y total sin repintar (no se pierde el foco)
      cont.addEventListener('input', function (e) {
        const i = e.target.dataset.i;
        if (i === undefined || !e.target.dataset.campo) return;
        const l = borrador.lineas[Number(i)];
        l[e.target.dataset.campo] = e.target.value === '' ? '' : Number(e.target.value);
        cont.querySelector('[data-sub="' + i + '"]').textContent = fmt((Number(l.cantidad) || 0) * (Number(l.costo) || 0));
        cont.querySelector('#orden-total').textContent = fmt(totalBorrador());
        error('');
      });

      cont.addEventListener('click', async function (e) {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.quitar !== undefined) {
          borrador.lineas.splice(Number(b.dataset.quitar), 1);
          pintarOrden();
        } else if (b.id === 'orden-reponer') {
          porPedir().forEach(function (v) {
            if (!borrador.lineas.some(function (l) { return l.id_variante === v.id_variante; })) agregar(v.id_variante, sugerido(v));
          });
          pintarOrden();
        } else if (b.id === 'orden-limpiar') {
          borrador = { id_proveedor: borrador.id_proveedor, lineas: [] };
          pintarOrden();
        } else if (b.id === 'orden-enviar') {
          if (!borrador.id_proveedor) { error('Elige el proveedor al que le vas a pedir la mercancía.'); cont.querySelector('#orden-proveedor').focus(); return; }
          if (!borrador.lineas.length) { error('Agrega al menos una prenda a la orden.'); return; }
          const mala = borrador.lineas.findIndex(function (l) {
            return !Number.isInteger(Number(l.cantidad)) || Number(l.cantidad) <= 0 || !(Number(l.costo) > 0);
          });
          if (mala !== -1) {
            error('Revisa la línea ' + (mala + 1) + ': la cantidad debe ser un número entero mayor a 0 y el costo unitario mayor a $0.');
            const campo = cont.querySelector('[data-i="' + mala + '"][data-campo="' + (Number(borrador.lineas[mala].cantidad) > 0 ? 'costo' : 'cantidad') + '"]');
            if (campo) campo.focus();
            return;
          }
          b.disabled = true;
          try {
            const r = await A.api.crearCompra({
              id_proveedor: Number(borrador.id_proveedor),
              items: borrador.lineas.map(function (l) {
                return { id_variante: l.id_variante, cantidad: Number(l.cantidad), costo_unitario: Number(l.costo) };
              }),
            });
            borrador = { id_proveedor: '', lineas: [] };
            filtro = 'pendiente';
            A.toast(r.demo
              ? '<b>Pedido simulado.</b> La orden ' + esc(r.id_compra) + ' por ' + fmt(r.total) + ' quedó por recibir en la demo; no se guardó.'
              : '<b>Pedido guardado.</b> La orden ' + esc(r.id_compra) + ' por ' + fmt(r.total) + ' quedó por recibir.');
            A.app.refresh();
          } catch (err) {
            if (err.vencida || err.obsoleta) return;   // la sesión cambió: nada que mostrar
            b.disabled = false;
            error('No se pudo guardar el pedido. ' + A.frase(err.message));
          }
        }
      });

      root.querySelectorAll('[data-filtro]').forEach(function (b) {
        b.addEventListener('click', function () {
          filtro = b.dataset.filtro;
          root.querySelectorAll('[data-filtro]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
          root.querySelector('#ordenes').innerHTML = ordenesHtml();
        });
      });

      const ordenes = root.querySelector('#ordenes');
      if (ordenes) ordenes.addEventListener('click', async function (e) {
        const btn = e.target.closest('[data-recibir]');
        if (!btn) return;
        const id = Number(btn.dataset.recibir);
        btn.disabled = true;
        try {
          const r = await A.api.recibirCompra(id);
          A.toast(r && r.demo
            ? '<b>Recepción simulada.</b> La orden ' + esc(id) + ' se sumó al inventario de prueba; no se guardó.'
            : '<b>Mercancía recibida.</b> La orden ' + esc(id) + ' ya se sumó al inventario.');
          A.app.refresh();
        } catch (err) {
          if (err.vencida || err.obsoleta) return;   // la sesión cambió: nada que mostrar
          btn.disabled = false;
          A.toast('<b>No se pudo recibir la orden.</b> ' + esc(A.frase(err.message)));
        }
      });
    },
  };
})(window.Atelier);
