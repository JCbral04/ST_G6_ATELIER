(function (A) {
  'use strict'

  A.views.ia = {
    title: 'Reposición inteligente',
    nav: 'IA',
    roles: ['administrador'],

    render: function () {
      if (A.api.esDemo()) {
        return `
          <div class="ia-panel">
            <h3>Inteligencia artificial de ATELIER</h3>
            <p>Las predicciones requieren una sesión real de administrador.</p>
            <p>El modo demo no consulta el microservicio ni PostgreSQL.</p>
          </div>`
      }

      return `
        <div class="ia-panel">
          <h3>Predicción de demanda e inventario</h3>
          <p>Obtén recomendaciones inteligentes para la reposición de productos.</p>

          <form id="ia-form" class="ia-controls">
            <label>Horizonte de predicción (días)
              <input id="ia-horizon" type="number"
                min="1" max="30" value="15" required>
            </label>

            <label>Tiempo de entrega (días)
              <input id="ia-lead" type="number"
                min="1" max="30" value="7" required>
            </label>

            <button id="ia-run" type="submit">
              Analizar inventario
            </button>
          </form>

          <p id="ia-status" role="status"></p>

          <div class="ia-scroll">
            <table class="ia-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th>Stock</th>
                  <th>Tránsito</th>
                  <th>Modelo</th>
                  <th>Demanda/día</th>
                  <th>Cobertura</th>
                  <th>Riesgo</th>
                  <th>Compra sugerida</th>
                </tr>
              </thead>
              <tbody id="ia-results"></tbody>
            </table>
          </div>

          <p class="ia-note">
            Las recomendaciones no generan órdenes de compra automáticamente.
          </p>
        </div>`
    },

    bind: function (root) {
      const form = root.querySelector('#ia-form')

      if (!form || A.api.esDemo()) return

      form.addEventListener('submit', async function (event) {
        event.preventDefault()

        if (!A.session ||
            A.session.rol !== 'administrador' ||
            A.api.esDemo()) return

        const ctx = A.api.contexto()
        const status = root.querySelector('#ia-status')
        const button = root.querySelector('#ia-run')
        const results = root.querySelector('#ia-results')

        if (button.disabled) return

        const vigente = () =>
          root.isConnected && A.api.vigente(ctx)

        const horizon = Number(
          root.querySelector('#ia-horizon').value
        )

        const lead = Number(
          root.querySelector('#ia-lead').value
        )

        if (!Number.isInteger(horizon) ||
            !Number.isInteger(lead) ||
            lead < 1 || horizon > 30 || lead > horizon) {
          status.textContent = 'Revisa los parámetros ingresados.'
          return
        }

        button.disabled = true
        results.replaceChildren()
        status.textContent = 'Consultando inteligencia artificial…'

        try {
          const data = await A.api.request(
            'POST',
            '/api/ia/reposicion',
            {
              horizon_days: horizon,
              lead_days: lead
            }
          )

          if (!vigente()) return

          if (!data ||
              !['prediccion', 'alerta_estatica'].includes(data.modo) ||
              !Array.isArray(data.items) ||
              !data.items.every(item =>
                item &&
                typeof item === 'object' &&
                typeof item.sku === 'string' &&
                typeof item.producto === 'string' &&
                ['stock', 'transito', 'cantidad_sugerida'].every(key =>
                  (typeof item[key] === 'number' ||
                    (typeof item[key] === 'string' && item[key].trim() !== '')) &&
                  Number.isFinite(Number(item[key])) &&
                  Number(item[key]) >= 0
                )
              )) {
            throw new Error('Respuesta de IA no válida.')
          }

          status.textContent = [
            data.modo === 'prediccion'
              ? 'Análisis de reposición. Corte: ' + (data.fecha_corte || 'no informado')
              : 'IA no disponible. Se muestran alertas estáticas.',
            ...(data.items.some(item => item.riesgo === 'SIN_HISTORIAL')
              ? ['Algunos productos no tienen historial suficiente; se muestran recomendaciones estáticas.']
              : []),
            ...(Array.isArray(data.advertencias)
              ? data.advertencias : [])
          ].join('\n')

          for (const item of data.items) {
            const row = document.createElement('tr')

            for (const key of [
              'sku', 'producto', 'stock', 'transito',
              'modelo', 'demanda_diaria',
              'cobertura_dias', 'riesgo',
              'cantidad_sugerida'
            ]) {
              const cell = document.createElement('td')
              cell.textContent = item[key] ?? '—'

              if (key === 'riesgo') {
                cell.dataset.riesgo = item[key]
              }

              row.appendChild(cell)
            }

            results.appendChild(row)
          }

          if (data.items.length === 0) {
            status.textContent += '\nNo hay recomendaciones disponibles.'
          }

        } catch (error) {
          if (vigente()) status.textContent = error.message
        } finally {
          if (vigente()) button.disabled = false
        }
      })
    }
  }
})(window.Atelier)
