import os

SQL = '''
WITH ventas_diarias AS (
    SELECT d.id_variante, p.fecha::date AS dia, SUM(d.cantidad) AS unidades
    FROM detalle_pedido d JOIN pedido p ON p.id_pedido=d.id_pedido
    JOIN usuario u ON u.id_usuario=p.id_usuario
    WHERE p.estado <> 'cancelado' AND u.rol IN ('vendedor','administrador')
      AND p.fecha >= CURRENT_DATE - 90 AND p.fecha < CURRENT_DATE
    GROUP BY d.id_variante,p.fecha::date
), ventas AS (
    SELECT id_variante,jsonb_object_agg(dia::text,unidades) AS ventas
    FROM ventas_diarias GROUP BY id_variante
), transito AS (
    SELECT d.id_variante,SUM(d.cantidad) AS cantidad
    FROM detalle_compra d JOIN compra c ON c.id_compra=d.id_compra
    WHERE c.estado='pendiente' GROUP BY d.id_variante
)
SELECT v.id_variante,v.sku,p.nombre AS producto,c.nombre AS categoria,
       v.stock,p.stock_minimo,COALESCE(t.cantidad,0) AS transito,
       COALESCE(s.ventas,'{}'::jsonb) AS ventas
FROM variante_producto v JOIN producto p ON p.id_producto=v.id_producto
JOIN categoria c ON c.id_categoria=p.id_categoria
LEFT JOIN ventas s ON s.id_variante=v.id_variante
LEFT JOIN transito t ON t.id_variante=v.id_variante
WHERE p.activo ORDER BY v.id_variante
'''


def fetch_rows():
    import psycopg
    from psycopg.rows import dict_row
    with psycopg.connect(os.environ['AI_DATABASE_URL'], row_factory=dict_row, connect_timeout=int(os.getenv('AI_DB_CONNECT_TIMEOUT', '3'))) as conn:
        with conn.cursor() as cur:
            cur.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            cur.execute(
                "SELECT set_config('statement_timeout', %s, true)",
                (os.getenv('AI_DB_STATEMENT_TIMEOUT_MS', '2000'),)
            )
            cur.execute('SELECT CURRENT_DATE AS fecha')
            today=cur.fetchone()['fecha']
            cur.execute(SQL)
            return cur.fetchall(), today
