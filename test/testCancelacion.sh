#!/usr/bin/env bash
set -Eeuo pipefail

# Pruebas transaccionales Automatizadas
# Issue #25

api_url="${api_url:-http://localhost:3000/api}"
db_host="${db_host:-127.0.0.1}"
db_port="${db_port:-5433}"
db_name="${db_name:-atelier_db}"
db_user="${db_user:-postgres}"

# En CI utilizar PGPASSWORD; localmente cargar backend/.env.
if [[ -z "${PGPASSWORD:-}" ]]; then
    env_file="$(dirname "$0")/../backend/.env"
    if [[ ! -f "$env_file" ]]; then
        echo "ERROR: configura PGPASSWORD o backend/.env"
        exit 1
    fi

    db_password=$(
        grep -m1 '^DB_PASSWORD=' "$env_file" |
        cut -d '=' -f2-
    ) || {
        echo "ERROR: DB_PASSWORD no encontrada en backend/.env"
        exit 1
    }

    if [[ -z "$db_password" ]]; then
        echo "ERROR: DB_PASSWORD está vacía"
        exit 1
    fi

    export PGPASSWORD="$db_password"
    unset db_password
fi


admin_id=1
vendedor_id=3
variante_id=1
cantidad=2

pass=0
fail=0

verde='\033[0;32m'
rojo='\033[0;31m'
reset='\033[0m'

ok(){
    printf "${verde}[pass]${reset} %s\n" "$1"
    pass=$((pass + 1))
}

fail(){
    printf "${rojo}[fail]${reset} %s\n" "$1"
    fail=$((fail + 1))
}

sql(){
    psql -X -qAt \
        -h "$db_host" \
        -p "$db_port" \
        -U "$db_user" \
        -d "$db_name" \
        -v ON_ERROR_STOP=1 \
        -c "$1"
}

check(){
    local descripcion="$1"
    local esperado="$2"
    local obtenido="$3"

    if [[ "$esperado" == "$obtenido" ]]; then
        ok "$descripcion"
    else
        fail "$descripcion (esperado: $esperado, obtenido: $obtenido)"
    fi
}


# Obtener token de acceso a partir de credenciales
login() {
    local correo="$1"
    local contrasena="$2"
    local respuesta
    local codigo
    local cuerpo

    respuesta=$(curl -sS -w '\n%{http_code}' \
        -X POST "$api_url/auth/login" \
        -H "Content-Type: application/json" \
        --data-binary @- <<< "$(jq -n \
            --arg correo "$correo" \
            --arg contrasena "$contrasena" \
            '{correo: $correo, contrasena: $contrasena}')")

    codigo=$(printf '%s\n' "$respuesta" | tail -n 1)
    cuerpo=$(printf '%s\n' "$respuesta" | sed '$d')

    if [[ "$codigo" == "429" ]]; then
        echo "ERROR: límite de intentos de login alcanzado (HTTP 429)." >&2
        echo "Consulta el encabezado RateLimit-Reset antes de reintentar." >&2
        return 1
    fi

    if [[ "$codigo" != "200" ]]; then
        echo "ERROR: autenticación rechazada para $correo (HTTP $codigo)." >&2
        return 1
    fi

    printf '%s' "$cuerpo" | jq -er '.token'
}


# Entonces comprobamos la conexión y las dependencias

for comando in curl jq psql; do
    command -v "$comando" >/dev/null || {
        echo "Falta instalar: $comando"
        exit 1
    }
done

curl -fsS "$api_url/health" >/dev/null || {
    echo "El backend no esta disponible"
    exit 1
}

sql "SELECT 1" >/dev/null

# Usar credenciales de aplicación del entorno; no guardarlas en Git.
admin_correo="${admin_correo:-admin@atelier.com}"
vendedor_correo="${vendedor_correo:-vendedor@atelier.com}"

# Cargar credenciales mock desde un archivo local ignorado por Git
credenciales_locales="$(dirname "$0")/.env.test.local"

if [[ -f "$credenciales_locales" ]] &&
   { [[ -z "${admin_password:-}" ]] || [[ -z "${vendedor_password:-}" ]]; }; then
    # shellcheck source=/dev/null
    source "$credenciales_locales"
fi
# En una terminal interactiva, solicitar las contraseñas sin eco.
if [[ -z "${admin_password:-}" ]]; then
    if [[ ! -t 0 ]]; then
        echo "ERROR: configura admin_password para ejecución no interactiva"
        exit 1
    fi
    read -r -s -p "Contraseña administrador: " admin_password
    echo
fi
if [[ -z "${vendedor_password:-}" ]]; then
    if [[ ! -t 0 ]]; then
        echo "ERROR: configura vendedor_password para ejecución no interactiva"
        exit 1
    fi
    read -r -s -p "Contraseña vendedor: " vendedor_password
    echo
fi

token_admin=$(login "$admin_correo" "$admin_password")
token_vendedor=$(login "$vendedor_correo" "$vendedor_password")
unset admin_password vendedor_password

echo "Autenticación de prueba completada"

# Seguridad: las rutas protegidas no aceptan usuarios anónimos ni tokens inválidos.
echo
echo "--------------------------------------"
echo " PRUEBAS DE AUTENTICACIÓN"
echo "--------------------------------------"

codigo=$(curl -sS -o /dev/null -w '%{http_code}' "$api_url/pedidos")
check "Acceso sin autenticación rechazado" "401" "$codigo"

codigo=$(curl -sS -o /dev/null -w '%{http_code}' \
    "$api_url/pedidos" \
    -H "Authorization: Bearer token_invalido")
check "Token inválido rechazado" "401" "$codigo"

codigo=$(curl -sS -o /dev/null -w '%{http_code}' \
    "$api_url/pedidos" \
    -H "Authorization: Bearer $token_vendedor")
check "Vendedor autenticado correctamente" "200" "$codigo"

# Esta solicitud debe ser rechazada ANTES de consultar/modificar el pedido.
codigo=$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST "$api_url/pedidos/1/cancelar" \
    -H "Authorization: Bearer $token_vendedor")
check "Cancelación por vendedor rechazada" "403" "$codigo"


echo "-------------------------------------"
echo " Atelier Pruebas Transaccionales"
echo "-------------------------------------"

# 1. Consultar stock inicial
stock_inicial=$(sql "
    SELECT stock FROM variante_producto
    WHERE id_variante = $variante_id;
")

echo "Stock inicial: $stock_inicial"

# 2. Registramos venta

respuesta=$(curl -sS -w '\n%{http_code}' \
    -X POST "$api_url/pedidos" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token_vendedor" \
    -d "{
        \"items\": [{
            \"id_variante\": $variante_id,
            \"cantidad\": $cantidad
        }]
    }")

codigo=$(printf '%s\n' "$respuesta" | tail -n 1)
cuerpo=$(printf '%s\n' "$respuesta" | sed '$d')

check "Registro de venta" "201" "$codigo"

if [[ "$codigo" != "201" ]]; then
    echo "$cuerpo"
    exit 1
fi

id_pedido=$(printf '%s' "$cuerpo" | jq -er '.id_pedido')

echo "Pedido creado: #$id_pedido"

# Confirmar que la venta pertenece al vendedor autenticado.
usuario_venta=$(sql "SELECT id_usuario FROM pedido WHERE id_pedido = $id_pedido;")
check "Venta atribuida al vendedor autenticado" "$vendedor_id" "$usuario_venta"

# 3. Verificamos descuento
stock_venta=$(sql "
    SELECT stock FROM variante_producto
    WHERE id_variante = $variante_id;
")

esperado=$((stock_inicial - cantidad))

check "Descuento automatico del inventario" \
    "$esperado" "$stock_venta"

# 4. Cancelamos venta
respuesta=$(curl -sS -w '\n%{http_code}' \
    -X POST "$api_url/pedidos/$id_pedido/cancelar" \
    -H "Authorization: Bearer $token_admin")

codigo=$(printf '%s\n' "$respuesta" | tail -n 1)

check "Cancelación de venta" "200" "$codigo"

# 5. Verificamos estado
estado=$(sql "
    SELECT estado FROM pedido
    WHERE id_pedido = $id_pedido;
")

check "Estado del pedido" "cancelado" "$estado"

# 6. Verificamos devolución
stock_final=$(sql "
    SELECT stock FROM variante_producto
    WHERE id_variante = $variante_id;
")

check "Devolucion de inventario" \
    "$stock_inicial" "$stock_final"

# 7. Verificamos movimientos registrados
movimientos=$(sql "
    SELECT COUNT(*) FROM movimiento_inventario
    WHERE motivo = 'Anulación de la venta #$id_pedido'
    AND id_variante = $variante_id
    AND tipo = 'entrada'
    AND cantidad = $cantidad;
")

check "Movimiento de devolucion unico" "1" "$movimientos"

# 8. Intentar cancelar nuevamente
codigo=$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST "$api_url/pedidos/$id_pedido/cancelar" \
    -H "Authorization: Bearer $token_admin")

check "Rechazo de cancelación duplicada" "409" "$codigo"

# 9. Comprobar que el segundo intento no alteró el stock
stock_posterior=$(sql "
    SELECT stock FROM variante_producto
    WHERE id_variante = $variante_id;
")

check "Inventario intacto tras rechazo" \
    "$stock_inicial" "$stock_posterior"

# 10. Comprobar que no se duplicó el movimiento
movimientos_finales=$(sql "
    SELECT COUNT(*) FROM movimiento_inventario
    WHERE motivo = 'Anulación de la venta #$id_pedido'
    AND id_variante = $variante_id;
")

check "Sin movimientos duplicados" \
    "1" "$movimientos_finales"


# 11. Prueba de concurrencia: dos cancelaciones simultáneas

echo
echo "--------------------------------------"
echo " PRUEBA DE CONCURRENCIA"
echo "--------------------------------------"

# Consultar el stock inicial
stock_inicial_concurrencia=$(sql "
    SELECT stock FROM variante_producto
    WHERE id_variante = $variante_id;
")

# Registrar una venta independiente
respuesta=$(curl -sS -w '\n%{http_code}' \
    -X POST "$api_url/pedidos" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token_vendedor" \
    -d "{
        \"items\": [{
            \"id_variante\": $variante_id,
            \"cantidad\": $cantidad
        }]
    }")

codigo=$(printf '%s\n' "$respuesta" | tail -n 1)
cuerpo=$(printf '%s\n' "$respuesta" | sed '$d')

check "Creación de venta para concurrencia" "201" "$codigo"

if [[ "$codigo" != "201" ]]; then
    echo "$cuerpo"
    exit 1
fi

id_pedido_concurrencia=$(printf '%s' "$cuerpo" | jq -er '.id_pedido')

echo "Pedido de concurrencia: #$id_pedido_concurrencia"

# Crear archivos temporales para capturar las respuestas
directorio_temporal=$(mktemp -d)
trap 'rm -rf "$directorio_temporal"' EXIT

# Enviar dos cancelaciones simultáneamente
curl -sS -o "$directorio_temporal/respuesta1" \
    -w '%{http_code}' \
    -X POST "$api_url/pedidos/$id_pedido_concurrencia/cancelar" \
    -H "Authorization: Bearer $token_admin" \
    > "$directorio_temporal/codigo1" &

pid1=$!

curl -sS -o "$directorio_temporal/respuesta2" \
    -w '%{http_code}' \
    -X POST "$api_url/pedidos/$id_pedido_concurrencia/cancelar" \
    -H "Authorization: Bearer $token_admin" \
    > "$directorio_temporal/codigo2" &

pid2=$!

# Esperar a que terminen ambas solicitudes
wait "$pid1" || {
    echo "Fallo de conexión en la primera solicitud"
    exit 1
}

wait "$pid2" || {
    echo "Fallo de conexión en la segunda solicitud"
    exit 1
}

codigo1=$(cat "$directorio_temporal/codigo1")
codigo2=$(cat "$directorio_temporal/codigo2")

echo "Primera solicitud: HTTP $codigo1"
echo "Segunda solicitud: HTTP $codigo2"

# Comprobar que una tiene éxito y la otra se rechaza
if [[ "$codigo1" == "200" && "$codigo2" == "409" ]] ||
   [[ "$codigo1" == "409" && "$codigo2" == "200" ]]; then
    ok "Cancelaciones concurrentes controladas"
else
    fail "Concurrencia: se esperaba HTTP 200 y 409"
fi

# Verificar el estado final del pedido
estado_concurrencia=$(sql "
    SELECT estado FROM pedido
    WHERE id_pedido = $id_pedido_concurrencia;
")

check "Estado final tras concurrencia" \
    "cancelado" "$estado_concurrencia"

# Verificar que el stock se devolvió una sola vez
stock_concurrencia=$(sql "
    SELECT stock FROM variante_producto
    WHERE id_variante = $variante_id;
")

check "Stock correcto tras concurrencia" \
    "$stock_inicial_concurrencia" "$stock_concurrencia"

# Verificar que solamente existe una devolución
movimientos_concurrencia=$(sql "
    SELECT COUNT(*) FROM movimiento_inventario
    WHERE motivo = 'Anulación de la venta #$id_pedido_concurrencia'
    AND id_variante = $variante_id
    AND tipo = 'entrada';
")

check "Una sola devolución concurrente" \
    "1" "$movimientos_concurrencia"


# 12. Prueba de atomicidad: rollback ante fallo SQL

echo
echo "--------------------------------------"
echo " PRUEBA DE ATOMICIDAD Y ROLLBACK"
echo "--------------------------------------"

# Consultar stock antes de crear la venta
stock_inicial_rollback=$(sql "
    SELECT stock FROM variante_producto
    WHERE id_variante = $variante_id;
")

# Crear una venta independiente para esta prueba
respuesta=$(curl -sS -w '\n%{http_code}' \
    -X POST "$api_url/pedidos" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token_vendedor" \
    -d "{
        \"items\": [{
            \"id_variante\": $variante_id,
            \"cantidad\": $cantidad
        }]
    }")

codigo=$(printf '%s\n' "$respuesta" | tail -n 1)
cuerpo=$(printf '%s\n' "$respuesta" | sed '$d')

check "Creación de venta para rollback" "201" "$codigo"

if [[ "$codigo" != "201" ]]; then
    echo "$cuerpo"
    exit 1
fi

id_pedido_rollback=$(printf '%s' "$cuerpo" | jq -er '.id_pedido')

echo "Pedido para rollback: #$id_pedido_rollback"

# Comprobar que la venta descontó el stock
stock_antes_rollback=$(sql "
    SELECT stock FROM variante_producto
    WHERE id_variante = $variante_id;
")

esperado_rollback=$((stock_inicial_rollback - cantidad))

check "Stock descontado antes del rollback" \
    "$esperado_rollback" "$stock_antes_rollback"

# Si el descuento inicial falló, no continuar
if [[ "$stock_antes_rollback" != "$esperado_rollback" ]]; then
    echo "No se puede continuar: inventario inicial inconsistente"
    exit 1
fi

# Ejecutar una transacción con un fallo SQL provocado.
# El UPDATE dispara el trigger que devuelve el stock.
# La inserción con cantidad NULL debe fallar y abortar la transacción.
#
# Esta sección espera expresamente un error SQL.
# No se utiliza ON_ERROR_STOP=1 para permitir ejecutar ROLLBACK.

salida_rollback=$(psql -X -qAt \
    -h "$db_host" \
    -p "$db_port" \
    -U "$db_user" \
    -d "$db_name" \
    2>&1 <<SQL
BEGIN;

UPDATE pedido
SET estado = 'cancelado'
WHERE id_pedido = $id_pedido_rollback
  AND estado = 'pendiente';

-- Evidenciar que el UPDATE se aplicó dentro de la transacción.
SELECT 'CANCELACION_TEMPORAL:' || estado
FROM pedido WHERE id_pedido = $id_pedido_rollback;

INSERT INTO movimiento_inventario
    (tipo, cantidad, motivo, id_variante, id_usuario)
VALUES
    ('entrada', NULL, 'Prueba ACID rollback #$id_pedido_rollback',
     $variante_id, $admin_id);

ROLLBACK;
SQL
)

# Comprobar que se produjo el error esperado
if [[ "$salida_rollback" == *"CANCELACION_TEMPORAL:cancelado"* &&
      "$salida_rollback" == *"violates not-null constraint"* ]]; then
    ok "Fallo SQL provocado correctamente"
else
    fail "No se confirmó la cancelación provisional y el error NOT NULL esperado"
    printf '%s\n' "$salida_rollback"
    exit 1
fi

# Verificar que el pedido sigue pendiente
estado_rollback=$(sql "
    SELECT estado FROM pedido
    WHERE id_pedido = $id_pedido_rollback;
")

check "Estado restaurado tras rollback" \
    "pendiente" "$estado_rollback"

# Verificar que el trigger no dejó stock devuelto
stock_despues_rollback=$(sql "
    SELECT stock FROM variante_producto
    WHERE id_variante = $variante_id;
")

check "Inventario restaurado tras rollback" \
    "$stock_antes_rollback" "$stock_despues_rollback"

# Verificar que el movimiento inválido no quedó registrado
movimientos_rollback=$(sql "
    SELECT COUNT(*) FROM movimiento_inventario
    WHERE motivo = 'Prueba ACID rollback #$id_pedido_rollback';
")

check "Sin movimientos huérfanos tras rollback" \
    "0" "$movimientos_rollback"


# 13. Pruebas de aislamiento de pedidos por usuario
echo
echo "--------------------------------------"
echo " PRUEBAS DE AISLAMIENTO DE PEDIDOS"
echo "--------------------------------------"

# Crear un pedido como administrador
respuesta=$(curl -sS -w '\n%{http_code}' \
    -X POST "$api_url/pedidos" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token_admin" \
    -d "{
        \"items\": [{
            \"id_variante\": $variante_id,
            \"cantidad\": $cantidad
        }]
    }")

codigo=$(printf '%s\n' "$respuesta" | tail -n 1)
cuerpo=$(printf '%s\n' "$respuesta" | sed '$d')

check "Administrador registra pedido propio" "201" "$codigo"

if [[ "$codigo" != "201" ]]; then
    printf '%s\n' "$cuerpo"
    exit 1
fi

id_pedido_admin=$(printf '%s' "$cuerpo" | jq -er '.id_pedido')

echo "Pedido administrativo: #$id_pedido_admin"

# Comprobar propietario en PostgreSQL
propietario_admin=$(sql "
    SELECT id_usuario FROM pedido
    WHERE id_pedido = $id_pedido_admin;
")

check "Pedido pertenece al administrador" \
    "$admin_id" "$propietario_admin"

# Administrador puede consultar su pedido
codigo=$(curl -sS -o /dev/null -w '%{http_code}' \
    "$api_url/pedidos/$id_pedido_admin" \
    -H "Authorization: Bearer $token_admin")

check "Administrador consulta su pedido" "200" "$codigo"

# Vendedor no puede consultar el pedido administrativo
codigo=$(curl -sS -o /dev/null -w '%{http_code}' \
    "$api_url/pedidos/$id_pedido_admin" \
    -H "Authorization: Bearer $token_vendedor")

check "Vendedor no consulta pedidos ajenos" "404" "$codigo"

# Verificar que el historial del vendedor no expone pedidos ajenos
respuesta=$(curl -fsS \
    "$api_url/pedidos" \
    -H "Authorization: Bearer $token_vendedor")

pedidos_ajenos=$(printf '%s' "$respuesta" | jq \
    --argjson id "$id_pedido_admin" \
    '[.[] | select(.id_pedido == $id)] | length')

check "Historial del vendedor sin pedidos ajenos" \
    "0" "$pedidos_ajenos"

# Cancelar el pedido de prueba para devolver el inventario
codigo=$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST "$api_url/pedidos/$id_pedido_admin/cancelar" \
    -H "Authorization: Bearer $token_admin")

check "Limpieza del pedido de aislamiento" "200" "$codigo"


echo
echo "--------------------------------------"
echo " PRUEBAS DE REVOCACIÓN DE SESIÓN"
echo "--------------------------------------"

# Cerrar la sesión del vendedor cuando ya finalizaron todas las ventas.
codigo=$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST "$api_url/auth/logout" \
    -H "Authorization: Bearer $token_vendedor")
check "Cierre de sesión del vendedor" "200" "$codigo"

codigo=$(curl -sS -o /dev/null -w '%{http_code}' \
    "$api_url/pedidos" \
    -H "Authorization: Bearer $token_vendedor")
check "Token revocado rechazado" "401" "$codigo"

echo
echo "--------------------------------------"
echo " RESULTADOS"
echo "--------------------------------------"
echo "pass: $pass"
echo "fail: $fail"
echo "Pedido utilizado: #$id_pedido"

if (( fail > 0 )); then
    exit 1
fi

echo "Todas las pruebas finalizaron correctamente."
