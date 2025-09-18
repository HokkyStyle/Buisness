-- Таблицы PostgreSQL для проекта ToolRent

CREATE TABLE IF NOT EXISTS inventory (
  id text PRIMARY KEY,
  name text NOT NULL,
  daily_price numeric,
  weekend_price numeric,
  deposit numeric,
  availability text DEFAULT 'in_stock',
  quantity integer DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviews (
  id bigserial PRIMARY KEY,
  author text,
  platform text,
  text text,
  url text,
  date date,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id bigserial PRIMARY KEY,
  customer_name text NOT NULL,
  contact text NOT NULL,
  tool_id text NOT NULL REFERENCES inventory(id) ON DELETE SET NULL,
  tool_name text,
  date_from date,
  date_to date,
  notes text,
  addons jsonb,
  created_at timestamptz DEFAULT now()
);
