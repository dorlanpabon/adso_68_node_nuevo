-- =========================================================
--  adso_68_node_nuevo — Base de datos (XAMPP / MySQL)
-- Importar en phpMyAdmin o ejecutar con: npm run db:restaurar
-- (si tu base ya tiene una tabla usuarios antigua, usa `npm run db:restaurar`
--  que hace la migración automática y cifra las claves en texto plano)
-- =========================================================

CREATE DATABASE IF NOT EXISTS adso_68_node_nuevo
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE adso_68_node_nuevo;

-- ---------------------------------------------------------
-- USUARIOS (las claves se guardan cifradas con bcrypt)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  usuario VARCHAR(50) NOT NULL,
  clave VARCHAR(255) NOT NULL,
  rol ENUM('admin','vendedor') NOT NULL DEFAULT 'vendedor',
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usuario (usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------
-- PRODUCTOS (el stock actual vive aquí)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS productos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  descripcion TEXT NULL,
  precio DECIMAL(10,2) NOT NULL CHECK (precio >= 0),
  stock INT NOT NULL DEFAULT 0,
  categoria VARCHAR(50) NULL,
  estado TINYINT(1) NOT NULL DEFAULT 1, -- 1 activo, 0 inactivo
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_productos_nombre (nombre),
  INDEX idx_productos_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------
-- PEDIDOS (cabecera)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS pedidos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cliente VARCHAR(100) NOT NULL,
  usuario_id INT UNSIGNED NULL, -- usuario que registró el pedido
  estado ENUM('pendiente','confirmado','entregado','facturado','cancelado')
    NOT NULL DEFAULT 'pendiente',
  total DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pedidos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  INDEX idx_pedidos_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------
-- PEDIDO_DETALLE (líneas del pedido)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS pedido_detalle (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pedido_id INT UNSIGNED NOT NULL,
  producto_id INT UNSIGNED NOT NULL,
  cantidad INT NOT NULL CHECK (cantidad > 0),
  precio_unitario DECIMAL(10,2) NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_detalle_pedido FOREIGN KEY (pedido_id)
    REFERENCES pedidos (id) ON DELETE CASCADE,
  CONSTRAINT fk_detalle_producto FOREIGN KEY (producto_id)
    REFERENCES productos (id),
  INDEX idx_detalle_pedido (pedido_id),
  INDEX idx_detalle_producto (producto_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------
-- FACTURAS (una por pedido, con IVA del 19%)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS facturas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pedido_id INT UNSIGNED NOT NULL,
  numero VARCHAR(20) NULL, -- se rellena como F-000001 tras insertar
  subtotal DECIMAL(10,2) NOT NULL,
  iva DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  total DECIMAL(10,2) NOT NULL,
  estado ENUM('emitida','pagada') NOT NULL DEFAULT 'emitida',
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_factura_pedido (pedido_id),
  UNIQUE KEY uq_factura_numero (numero),
  CONSTRAINT fk_facturas_pedido FOREIGN KEY (pedido_id)
    REFERENCES pedidos (id) ON DELETE RESTRICT,
  INDEX idx_facturas_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------
-- INVENTARIO (kardex: historial de movimientos de stock)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventario (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  producto_id INT UNSIGNED NOT NULL,
  tipo ENUM('entrada','salida','ajuste') NOT NULL,
  cantidad INT NOT NULL, -- con signo: positivo entrada, negativo salida
  stock_anterior INT NOT NULL,
  stock_nuevo INT NOT NULL,
  referencia VARCHAR(100) NULL, -- ej: "Pedido #5"
  usuario_id INT UNSIGNED NULL, -- usuario que registró el movimiento
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_inventario_producto FOREIGN KEY (producto_id)
    REFERENCES productos (id),
  CONSTRAINT fk_inventario_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios (id) ON DELETE SET NULL,
  INDEX idx_inventario_producto (producto_id),
  INDEX idx_inventario_tipo (tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------
-- DATOS INICIALES
-- Claves en texto plano: admin123 (admin) y vendedor123 (vendedor)
-- (cifradas con bcrypt, nunca guardarlas en texto plano)
-- ---------------------------------------------------------
INSERT IGNORE INTO usuarios (nombre, usuario, clave, rol) VALUES
  ('Administrador', 'admin',    '$2b$10$Opn8yHghI8/xvRq79gkFfutANNBs9pikp5V5L9hnEuOIh1OQ4a2M.', 'admin'),
  ('Vendedor demo', 'vendedor', '$2b$10$Vpz9SogdtOzUESekzvbuOOCND9QFMzbXnKe5amXZDpd/SOxVWfP0K', 'vendedor');

INSERT IGNORE INTO productos (nombre, descripcion, precio, stock, categoria) VALUES
  ('Arroz x kilo',  'Arroz blanco empacado por kilo', 3200.00,  50, 'Abarrotes'),
  ('Aceite 1L',     'Aceite girasol botella de 1L',   9500.00,  40, 'Abarrotes'),
  ('Panela libra',  'Panela redonda por libra',       4500.00,  25, 'Dulces'),
  ('Huevos 30',     'Cubeta de 30 huevos AA',        16000.00,  60, 'Granos'),
  ('Cafe 500g',     'Café molido empaque de 500g',   18000.00,  30, 'Bebidas');
