const { pool } = require('../config/db');

// 1. Obtener listado de productos con su stock actual (Tarea 2 del Issue)
async function getProductosConStock(req, res) {
  try {
    const query = `
      SELECT 
        p.id_producto,
        p.nombre AS producto,
        p.descripcion,
        p.precio,
        c.nombre AS categoria,
        COALESCE(SUM(v.stock), 0) AS stock_total
      FROM producto p
      JOIN categoria c ON p.id_categoria = c.id_categoria
      LEFT JOIN variante_producto v ON p.id_producto = v.id_producto
      WHERE p.activo = TRUE
      GROUP BY p.id_producto, c.nombre
      ORDER BY p.id_producto;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener productos:', err.message);
    res.status(500).json({ error: 'Error interno del servidor al consultar productos' });
  }
}

// 2. Obtener alertas de variantes con stock bajo o igual al stock mínimo (Tarea 3 del Issue)
async function getAlertasStockBajo(req, res) {
  try {
    const query = `
      SELECT 
        v.id_variante,
        v.sku,
        p.nombre AS producto,
        t.etiqueta AS talla,
        col.nombre AS color,
        v.stock AS stock_actual,
        p.stock_minimo
      FROM variante_producto v
      JOIN producto p ON v.id_producto = p.id_producto
      JOIN talla t ON v.id_talla = t.id_talla
      JOIN color col ON v.id_color = col.id_color
      WHERE v.stock <= p.stock_minimo
      ORDER BY v.stock ASC;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener alertas de stock:', err.message);
    res.status(500).json({ error: 'Error interno del servidor al consultar alertas de stock' });
  }
}

module.exports = {
  getProductosConStock,
  getAlertasStockBajo
};