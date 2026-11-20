-- =============================================================
-- ATELIER - Migración 005: Eliminación de módulo e-commerce
-- Issue #16: Depurar carrito de compras y deshabilitar rol cliente
-- Idempotente: aplicable tanto a bases existentes como nuevas.
-- =============================================================

-- 1. Eliminar tablas del carrito en orden de dependencia (sin CASCADE indiscriminado)
DROP TABLE IF EXISTS item_carrito;
DROP TABLE IF EXISTS carrito_compra;

-- 2. Revocar sesiones activas de cuentas con rol legado 'cliente' (si existe tabla de sesiones)
DO $$ BEGIN IF to_regclass('public.sesion_usuario') IS NOT NULL THEN UPDATE sesion_usuario SET fecha_revocacion = NOW() WHERE fecha_revocacion IS NULL AND id_usuario IN (SELECT id_usuario FROM usuario WHERE rol = 'cliente'); END IF; END $$;

-- 3. Retirar cuentas 'cliente' sin historial operativo y restringir CHECK si no quedan registros legados
DO $$ DECLARE tiene_auditoria BOOLEAN := to_regclass('public.auditoria') IS NOT NULL; clientes_restantes INT; BEGIN IF tiene_auditoria THEN DELETE FROM usuario u WHERE u.rol = 'cliente' AND NOT EXISTS (SELECT 1 FROM pedido p WHERE p.id_usuario = u.id_usuario) AND NOT EXISTS (SELECT 1 FROM movimiento_inventario m WHERE m.id_usuario = u.id_usuario) AND NOT EXISTS (SELECT 1 FROM auditoria a WHERE a.id_usuario = u.id_usuario); ELSE DELETE FROM usuario u WHERE u.rol = 'cliente' AND NOT EXISTS (SELECT 1 FROM pedido p WHERE p.id_usuario = u.id_usuario) AND NOT EXISTS (SELECT 1 FROM movimiento_inventario m WHERE m.id_usuario = u.id_usuario); END IF;    SELECT COUNT(*) INTO clientes_restantes FROM usuario WHERE rol = 'cliente';    IF clientes_restantes = 0 THEN ALTER TABLE usuario DROP CONSTRAINT IF EXISTS usuario_rol_check; ALTER TABLE usuario ADD CONSTRAINT usuario_rol_check CHECK (rol IN ('vendedor', 'administrador')); END IF; END $$;