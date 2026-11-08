-- ==============================================================================
-- ESQUEMA DE BASE DE DATOS PARA SISTEMA BG (SUPABASE / POSTGRESQL)
-- ==============================================================================
-- Copia y pega este script en el "SQL Editor" de tu panel de Supabase y haz clic en "RUN".

-- 1. EXTENSIÓN PARA UUIDs (Generador de IDs únicos)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABLA: PRODUCTOS E INVENTARIO
CREATE TABLE IF NOT EXISTS productos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku VARCHAR(50) UNIQUE NOT NULL,
    nombre VARCHAR(255) NOT NULL,
    categoria VARCHAR(100) NOT NULL,
    precio_costo NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    precio_venta NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    stock_actual INT NOT NULL DEFAULT 0,
    stock_minimo INT NOT NULL DEFAULT 5,
    unidad_medida VARCHAR(20) DEFAULT 'unidades',
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. TABLA: MOVIMIENTOS DE INVENTARIO (KARDEX)
CREATE TABLE IF NOT EXISTS movimientos_inventario (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    producto_id UUID REFERENCES productos(id) ON DELETE CASCADE,
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('ingreso', 'salida', 'ajuste')),
    cantidad INT NOT NULL,
    motivo VARCHAR(255),
    usuario VARCHAR(100) DEFAULT 'Gabriel Admin',
    fecha TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. TABLA: VENTAS Y ÓRDENES
CREATE TABLE IF NOT EXISTS ventas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo_orden VARCHAR(50) UNIQUE NOT NULL,
    cliente VARCHAR(150) NOT NULL DEFAULT 'Consumidor Final',
    canal VARCHAR(50) NOT NULL DEFAULT 'Local' CHECK (canal IN ('Local', 'Delivery', 'WhatsApp', 'Web')),
    metodo_pago VARCHAR(50) NOT NULL DEFAULT 'Efectivo',
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    impuesto NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    estado VARCHAR(30) DEFAULT 'completada' CHECK (estado IN ('completada', 'pendiente', 'cancelada')),
    usuario VARCHAR(100) DEFAULT 'Gabriel',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. TABLA: DETALLE DE VENTAS (PRODUCTOS POR VENTA)
CREATE TABLE IF NOT EXISTS detalle_ventas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    venta_id UUID REFERENCES ventas(id) ON DELETE CASCADE,
    producto_id UUID REFERENCES productos(id),
    cantidad INT NOT NULL,
    precio_unitario NUMERIC(12, 2) NOT NULL,
    subtotal NUMERIC(12, 2) NOT NULL
);

-- 6. TABLA: GASTOS Y EGRESOS
CREATE TABLE IF NOT EXISTS gastos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo VARCHAR(50) UNIQUE,
    descripcion VARCHAR(255) NOT NULL,
    categoria VARCHAR(100) NOT NULL,
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('fijo', 'variable')),
    monto NUMERIC(12, 2) NOT NULL,
    metodo_pago VARCHAR(50) DEFAULT 'Transferencia',
    estado VARCHAR(30) DEFAULT 'pagado' CHECK (estado IN ('pagado', 'pendiente')),
    fecha DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. TABLA: CUENTAS POR COBRAR Y POR PAGAR
CREATE TABLE IF NOT EXISTS cuentas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('cobrar', 'pagar')),
    tercero VARCHAR(150) NOT NULL,
    concepto VARCHAR(255) NOT NULL,
    monto_total NUMERIC(12, 2) NOT NULL,
    monto_pagado NUMERIC(12, 2) DEFAULT 0.00,
    saldo_pendiente NUMERIC(12, 2) GENERATED ALWAYS AS (monto_total - monto_pagado) STORED,
    fecha_emision DATE DEFAULT CURRENT_DATE,
    fecha_vencimiento DATE NOT NULL,
    estado VARCHAR(30) DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagado', 'vencido')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. TABLA: CONFIGURACIÓN GENERAL DEL COMERCIO Y CUENTA
CREATE TABLE IF NOT EXISTS configuracion (
    id VARCHAR(50) PRIMARY KEY DEFAULT 'config_global',
    nombre_comercial VARCHAR(255) NOT NULL DEFAULT 'Auto Repuestos BG III C.A.',
    rif VARCHAR(50) DEFAULT 'J-40615751-1',
    telefono VARCHAR(50) DEFAULT '+58 412-1234567',
    email VARCHAR(150) DEFAULT 'autorepuestosbg3@gmail.com',
    direccion TEXT DEFAULT 'Calle Principal, Local Auto Repuestos BG III',
    moneda VARCHAR(20) DEFAULT 'USD',
    tasa_cambio NUMERIC(12, 2) DEFAULT 39.50,
    iva NUMERIC(5, 2) DEFAULT 16.00,
    ancho_impresora VARCHAR(10) DEFAULT '80mm',
    pie_factura TEXT DEFAULT '¡Gracias por su compra en Auto Repuestos BG III C.A.! Vuelva pronto.',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. POLÍTICAS DE ACCESO PÚBLICO (Row-Level Security abierto para desarrollo)
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_inventario ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_ventas ENABLE ROW LEVEL SECURITY;
ALTER TABLE gastos ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuentas ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Acceso total productos" ON productos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acceso total movimientos" ON movimientos_inventario FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acceso total ventas" ON ventas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acceso total detalle_ventas" ON detalle_ventas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acceso total gastos" ON gastos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acceso total cuentas" ON cuentas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acceso total configuracion" ON configuracion FOR ALL USING (true) WITH CHECK (true);

-- 10. DATOS INICIALES DE PRUEBA (Opcional para ver datos reales de inmediato)
INSERT INTO configuracion (id, nombre_comercial, rif, telefono, email, direccion, moneda, tasa_cambio, iva)
VALUES ('config_global', 'Auto Repuestos BG III C.A.', 'J-40615751-1', '+58 412-1234567', 'autorepuestosbg3@gmail.com', 'Calle Principal, Local Auto Repuestos BG III', 'USD', 39.50, 16.00)
ON CONFLICT (id) DO UPDATE SET
  nombre_comercial = EXCLUDED.nombre_comercial,
  rif = EXCLUDED.rif;

INSERT INTO productos (sku, nombre, categoria, precio_costo, precio_venta, stock_actual, stock_minimo, unidad_medida) VALUES
('HAM-001', 'Hamburguesa Doble BG', 'Comida', 3.50, 8.50, 42, 10, 'unidades'),
('PAP-002', 'Papas Rústicas Crispy', 'Acompañantes', 0.80, 2.50, 8, 15, 'unidades'),
('REF-003', 'Refresco Cola 500ml', 'Bebidas', 0.60, 1.75, 65, 20, 'unidades'),
('SAL-004', 'Salsa Especial BG 250ml', 'Salsas', 1.20, 3.00, 3, 5, 'unidades')
ON CONFLICT (sku) DO NOTHING;

