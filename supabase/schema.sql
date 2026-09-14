-- ────────────────────────────────────────────────────────────────────────────
-- 0. EXTENSIONS
-- ────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";      -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- fuzzy / trigram search
CREATE EXTENSION IF NOT EXISTS "unaccent";      -- accent-insensitive search


-- ────────────────────────────────────────────────────────────────────────────
-- 1. CUSTOM TYPES
-- ────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM ('customer', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.product_type AS ENUM ('full_size', 'decant');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.order_status AS ENUM ('pending', 'received', 'shipped', 'denied');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.stock_movement_reason AS ENUM (
    'manual_adjustment',
    'order_placed',
    'order_cancelled',
    'restock',
    'correction',
    'return'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. CORE TABLES
-- ────────────────────────────────────────────────────────────────────────────

-- 2.1  PROFILES (extends auth.users)
-- ────────────────────────────────────────────────────────────────────────────
-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  full_name text,
  phone text,
  avatar_url text,
  role USER-DEFINED NOT NULL DEFAULT 'customer'::user_role,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  experience_points integer NOT NULL DEFAULT 0 CHECK (experience_points >= 0),
  username text CHECK (username IS NULL OR username ~ '^[A-Za-z0-9][A-Za-z0-9._]{1,18}[A-Za-z0-9]$'),
  show_in_ranking boolean NOT NULL DEFAULT false CHECK (show_in_ranking = false OR username IS NOT NULL),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.brands (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  logo_url text,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT brands_pkey PRIMARY KEY (id)
);
CREATE TABLE public.categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  description text,
  image_url text,
  parent_id uuid,
  position integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT categories_pkey PRIMARY KEY (id),
  CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.categories(id)
);
CREATE TABLE public.products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  brand_id uuid NOT NULL,
  description text,
  notes_top text,
  notes_middle text,
  notes_base text,
  gender text CHECK (gender = ANY (ARRAY['masculine'::text, 'feminine'::text, 'unisex'::text])),
  concentration text CHECK (concentration = ANY (ARRAY['EDT'::text, 'EDP'::text, 'Parfum'::text, 'Cologne'::text, 'Other'::text])),
  featured_variant_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  decant_stock_ml numeric NOT NULL DEFAULT 0 CHECK (decant_stock_ml >= 0::numeric),
  CONSTRAINT products_pkey PRIMARY KEY (id),
  CONSTRAINT products_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id),
  CONSTRAINT fk_featured_variant FOREIGN KEY (featured_variant_id) REFERENCES public.product_variants(id)
);
CREATE TABLE public.product_categories (
  product_id uuid NOT NULL,
  category_id uuid NOT NULL,
  CONSTRAINT product_categories_pkey PRIMARY KEY (product_id, category_id),
  CONSTRAINT product_categories_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id),
  CONSTRAINT product_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id)
);
CREATE TABLE public.product_variants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  product_type USER-DEFINED NOT NULL,
  size_ml numeric NOT NULL CHECK (size_ml > 0::numeric),
  price numeric NOT NULL CHECK (price > 0::numeric),
  offer_price numeric CHECK (offer_price IS NULL OR offer_price > 0::numeric),
  is_on_offer boolean NOT NULL DEFAULT false,
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  sku text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT product_variants_pkey PRIMARY KEY (id),
  CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id)
);
CREATE TABLE public.product_images (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  url text NOT NULL,
  alt_text text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  variant_id uuid,
  CONSTRAINT product_images_pkey PRIMARY KEY (id),
  CONSTRAINT product_images_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id),
  CONSTRAINT product_images_variant_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id),
  CONSTRAINT product_images_variant_fkey FOREIGN KEY (product_id) REFERENCES public.product_variants(product_id)
);
CREATE TABLE public.addresses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  province text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  canton text NOT NULL DEFAULT ''::text,
  district text NOT NULL DEFAULT ''::text,
  exact_address text NOT NULL DEFAULT ''::text,
  references text,
  CONSTRAINT addresses_pkey PRIMARY KEY (id),
  CONSTRAINT addresses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.cart_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT cart_items_pkey PRIMARY KEY (id),
  CONSTRAINT cart_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT cart_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id)
);
CREATE TABLE public.orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_number bigint GENERATED ALWAYS AS IDENTITY NOT NULL UNIQUE,
  user_id uuid,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  shipping_address text NOT NULL,
  shipping_canton text NOT NULL,
  shipping_province text NOT NULL,
  shipping_reference text,
  subtotal numeric NOT NULL CHECK (subtotal >= 0::numeric),
  shipping_cost numeric NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0::numeric),
  tax numeric NOT NULL DEFAULT 0 CHECK (tax >= 0::numeric),
  discount numeric NOT NULL DEFAULT 0 CHECK (discount >= 0::numeric),
  total numeric NOT NULL CHECK (total >= 0::numeric),
  order_status USER-DEFINED NOT NULL DEFAULT 'pending'::order_status,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  customer_email text,
  shipping_district text NOT NULL,
  shipping_method text,
  payment_status USER-DEFINED NOT NULL DEFAULT 'pending'::payment_status,
  payment_provider text,
  payment_reference text,
  paid_at timestamp with time zone,
  source text NOT NULL DEFAULT 'web'::text,
  created_by_admin_id uuid,
  CONSTRAINT orders_pkey PRIMARY KEY (id),
  CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT orders_created_by_admin_id_fkey FOREIGN KEY (created_by_admin_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.order_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  variant_id uuid,
  product_name text NOT NULL,
  brand_name text NOT NULL,
  product_type USER-DEFINED NOT NULL,
  size_ml numeric NOT NULL,
  sku text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric NOT NULL CHECK (unit_price >= 0::numeric),
  line_total numeric NOT NULL CHECK (line_total >= 0::numeric),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT order_items_pkey PRIMARY KEY (id),
  CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id),
  CONSTRAINT order_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id)
);
CREATE TABLE public.stock_movements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  variant_id uuid,
  previous_stock integer,
  new_stock integer,
  delta integer,
  reason USER-DEFINED NOT NULL,
  reference_id uuid,
  notes text,
  performed_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  product_id uuid,
  previous_ml numeric,
  new_ml numeric,
  ml_delta numeric,
  CONSTRAINT stock_movements_pkey PRIMARY KEY (id),
  CONSTRAINT stock_movements_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id),
  CONSTRAINT stock_movements_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES public.profiles(id),
  CONSTRAINT stock_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id)
);
CREATE TABLE public.shipping_zones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  base_cost numeric NOT NULL CHECK (base_cost >= 0::numeric),
  free_shipping_threshold numeric CHECK (free_shipping_threshold IS NULL OR free_shipping_threshold > 0::numeric),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT shipping_zones_pkey PRIMARY KEY (id)
);
CREATE TABLE public.shipping_zone_cantons (
  canton_code text NOT NULL,
  canton_name text NOT NULL,
  province_code text NOT NULL,
  province_name text NOT NULL,
  zone_id uuid NOT NULL,
  CONSTRAINT shipping_zone_cantons_pkey PRIMARY KEY (canton_code),
  CONSTRAINT shipping_zone_cantons_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES public.shipping_zones(id)
);
CREATE TABLE public.processed_webhooks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_id text NOT NULL,
  payload_hash text,
  processed_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT processed_webhooks_pkey PRIMARY KEY (id)
);
CREATE TABLE public.decant_transformations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  source_variant_id uuid NOT NULL,
  quantity_used integer NOT NULL CHECK (quantity_used > 0),
  ml_generated numeric NOT NULL CHECK (ml_generated > 0::numeric),
  performed_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT decant_transformations_pkey PRIMARY KEY (id),
  CONSTRAINT dt_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id),
  CONSTRAINT dt_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES public.profiles(id),
  CONSTRAINT dt_source_variant_fkey FOREIGN KEY (source_variant_id) REFERENCES public.product_variants(id),
  CONSTRAINT dt_source_variant_fkey FOREIGN KEY (product_id) REFERENCES public.product_variants(product_id)
);
CREATE TABLE public.profile_experience_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  order_id uuid NOT NULL UNIQUE,
  xp_earned integer NOT NULL CHECK (xp_earned >= 0),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT profile_experience_events_pkey PRIMARY KEY (id),
  CONSTRAINT profile_experience_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT profile_experience_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id)
);

CREATE INDEX IF NOT EXISTS idx_stock_mv_variant   ON public.stock_movements (variant_id);
CREATE INDEX IF NOT EXISTS idx_stock_mv_created   ON public.stock_movements (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_mv_reason    ON public.stock_movements (reason);


-- ────────────────────────────────────────────────────────────────────────────
-- 3. HELPER FUNCTIONS
-- ────────────────────────────────────────────────────────────────────────────

-- 3.1  Check if current user is admin
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;


-- 3.2  Auto-update `updated_at` trigger function
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- 3.3  Auto-create profile on signup
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', ''),
    'customer'
  );
  RETURN NEW;
END;
$$;


-- 3.4  Record stock movement when variant stock changes
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.log_stock_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.stock IS DISTINCT FROM NEW.stock THEN
    INSERT INTO public.stock_movements (
      variant_id, previous_stock, new_stock, delta, reason, performed_by
    ) VALUES (
      NEW.id,
      OLD.stock,
      NEW.stock,
      NEW.stock - OLD.stock,
      'manual_adjustment',
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;


-- 3.5  Decrease stock when order item is inserted
--      (Called from the place_order function — not a direct trigger)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.decrease_variant_stock(
  p_variant_id  UUID,
  p_quantity    INT,
  p_order_id    UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_stock INT;
BEGIN
  -- Lock the row to prevent race conditions
  SELECT stock INTO v_current_stock
  FROM public.product_variants
  WHERE id = p_variant_id
  FOR UPDATE;

  IF v_current_stock IS NULL THEN
    RAISE EXCEPTION 'Variant % does not exist.', p_variant_id;
  END IF;

  IF v_current_stock < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock for variant %. Available: %, requested: %.',
      p_variant_id, v_current_stock, p_quantity;
  END IF;

  -- Update stock
  UPDATE public.product_variants
  SET stock = stock - p_quantity
  WHERE id = p_variant_id;

  -- Log the movement (bypass the manual_adjustment trigger via direct insert)
  INSERT INTO public.stock_movements (
    variant_id, previous_stock, new_stock, delta, reason, reference_id, performed_by
  ) VALUES (
    p_variant_id,
    v_current_stock,
    v_current_stock - p_quantity,
    -p_quantity,
    'order_placed',
    p_order_id,
    auth.uid()
  );
END;
$$;


-- 3.6  PLACE ORDER — atomic transaction
-- ────────────────────────────────────────────────────────────────────────────
-- Creates the order, snapshots items, decreases stock, clears the cart.

CREATE OR REPLACE FUNCTION public.place_order(
  p_address_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_order_id      UUID;
  v_subtotal      NUMERIC(12,2) := 0;
  v_address       RECORD;
  v_item          RECORD;
  v_effective_price NUMERIC(12,2);
  v_line_total    NUMERIC(12,2);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User must be authenticated to place an order.';
  END IF;

  -- Fetch the delivery address
  SELECT * INTO v_address
  FROM public.addresses
  WHERE id = p_address_id AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Address not found or does not belong to user.';
  END IF;

  -- Create the order shell
  INSERT INTO public.orders (
    user_id,
    shipping_full_name, shipping_phone,
    shipping_address_line1, shipping_address_line2,
    shipping_city, shipping_province, shipping_postal_code,
    shipping_country, shipping_instructions,
    subtotal, total, status
  ) VALUES (
    v_user_id,
    v_address.full_name, v_address.phone,
    v_address.address_line1, v_address.address_line2,
    v_address.city, v_address.province, v_address.postal_code,
    v_address.country, v_address.instructions,
    0, 0, 'pending'
  )
  RETURNING id INTO v_order_id;

  -- Iterate cart items, create order_items, decrease stock
  FOR v_item IN
    SELECT
      ci.variant_id,
      ci.quantity,
      pv.price,
      pv.offer_price,
      pv.is_on_offer,
      pv.product_type,
      pv.size_ml,
      pv.sku,
      p.name   AS product_name,
      b.name   AS brand_name
    FROM public.cart_items ci
    JOIN public.product_variants pv ON pv.id = ci.variant_id
    JOIN public.products p          ON p.id  = pv.product_id
    JOIN public.brands b            ON b.id  = p.brand_id
    WHERE ci.user_id = v_user_id
  LOOP
    -- Determine effective price
    IF v_item.is_on_offer AND v_item.offer_price IS NOT NULL THEN
      v_effective_price := v_item.offer_price;
    ELSE
      v_effective_price := v_item.price;
    END IF;

    v_line_total := v_effective_price * v_item.quantity;
    v_subtotal   := v_subtotal + v_line_total;

    -- Snapshot order item
    INSERT INTO public.order_items (
      order_id, variant_id,
      product_name, brand_name, product_type, size_ml, sku,
      quantity, unit_price, line_total
    ) VALUES (
      v_order_id, v_item.variant_id,
      v_item.product_name, v_item.brand_name, v_item.product_type,
      v_item.size_ml, v_item.sku,
      v_item.quantity, v_effective_price, v_line_total
    );

    -- Decrease stock (will raise if insufficient)
    PERFORM public.decrease_variant_stock(v_item.variant_id, v_item.quantity, v_order_id);
  END LOOP;

  IF v_subtotal = 0 THEN
    RAISE EXCEPTION 'Cart is empty — cannot place an order.';
  END IF;

  -- Finalize totals
  UPDATE public.orders
  SET subtotal = v_subtotal,
      total    = v_subtotal   -- extend later: + shipping - discount + tax
  WHERE id = v_order_id;

  -- Clear the cart
  DELETE FROM public.cart_items WHERE user_id = v_user_id;

  RETURN v_order_id;
END;
$$;


-- 3.7  SEARCH PRODUCTS — fuzzy trigram search
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.search_products(
  p_query   TEXT,
  p_limit   INT DEFAULT 20,
  p_offset  INT DEFAULT 0
)
RETURNS TABLE (
  id          UUID,
  name        TEXT,
  slug        TEXT,
  brand_name  TEXT,
  similarity  REAL
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    p.id,
    p.name,
    p.slug,
    b.name AS brand_name,
    similarity(p.name, p_query) AS similarity
  FROM public.products p
  JOIN public.brands b ON b.id = p.brand_id
  WHERE p.is_active = TRUE
    AND (
      p.name % p_query                    -- trigram match on product name
      OR b.name % p_query                 -- trigram match on brand name
      OR p.name ILIKE '%' || p_query || '%'
      OR b.name ILIKE '%' || p_query || '%'
    )
  ORDER BY similarity DESC
  LIMIT p_limit
  OFFSET p_offset;
$$;


-- 3.8  ANALYTICS HELPERS
-- ────────────────────────────────────────────────────────────────────────────

-- Best-selling variants (by units sold)
CREATE OR REPLACE FUNCTION public.analytics_best_sellers(
  p_limit INT DEFAULT 10,
  p_since TIMESTAMPTZ DEFAULT now() - INTERVAL '30 days'
)
RETURNS TABLE (
  variant_id    UUID,
  product_name  TEXT,
  brand_name    TEXT,
  product_type  public.product_type,
  size_ml       NUMERIC,
  sku           TEXT,
  total_units   BIGINT,
  total_revenue NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    oi.variant_id,
    oi.product_name,
    oi.brand_name,
    oi.product_type,
    oi.size_ml,
    oi.sku,
    SUM(oi.quantity)::BIGINT    AS total_units,
    SUM(oi.line_total)          AS total_revenue
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE o.status NOT IN ('denied')
    AND o.created_at >= p_since
  GROUP BY oi.variant_id, oi.product_name, oi.brand_name,
           oi.product_type, oi.size_ml, oi.sku
  ORDER BY total_units DESC
  LIMIT p_limit;
$$;

-- Revenue summary
CREATE OR REPLACE FUNCTION public.analytics_revenue_summary(
  p_since TIMESTAMPTZ DEFAULT now() - INTERVAL '30 days'
)
RETURNS TABLE (
  total_orders    BIGINT,
  gross_revenue   NUMERIC,
  total_units     BIGINT,
  avg_order_value NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*)::BIGINT                          AS total_orders,
    COALESCE(SUM(total), 0)                   AS gross_revenue,
    COALESCE(SUM(s.units), 0)::BIGINT         AS total_units,
    COALESCE(AVG(total), 0)                   AS avg_order_value
  FROM public.orders o
  LEFT JOIN LATERAL (
    SELECT SUM(quantity) AS units FROM public.order_items WHERE order_id = o.id
  ) s ON TRUE
  WHERE o.status NOT IN ('denied')
    AND o.created_at >= p_since;
$$;

-- Low stock alerts
CREATE OR REPLACE FUNCTION public.analytics_low_stock(
  p_threshold INT DEFAULT 5
)
RETURNS TABLE (
  variant_id   UUID,
  product_name TEXT,
  sku          TEXT,
  stock        INT,
  product_type public.product_type,
  size_ml      NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pv.id         AS variant_id,
    p.name        AS product_name,
    pv.sku,
    pv.stock,
    pv.product_type,
    pv.size_ml
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
  WHERE pv.is_active = TRUE
    AND pv.stock <= p_threshold
  ORDER BY pv.stock ASC;
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. TRIGGERS
-- ────────────────────────────────────────────────────────────────────────────

-- 4.1  updated_at triggers
DO $$ BEGIN
  CREATE TRIGGER set_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_brands_updated_at
    BEFORE UPDATE ON public.brands
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_categories_updated_at
    BEFORE UPDATE ON public.categories
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_products_updated_at
    BEFORE UPDATE ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_variants_updated_at
    BEFORE UPDATE ON public.product_variants
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_addresses_updated_at
    BEFORE UPDATE ON public.addresses
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_cart_items_updated_at
    BEFORE UPDATE ON public.cart_items
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_orders_updated_at
    BEFORE UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4.2  Auto-create profile on auth signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4.3  Stock change audit (for manual admin edits via UPDATE)
DO $$ BEGIN
  CREATE TRIGGER on_variant_stock_change
    AFTER UPDATE OF stock ON public.product_variants
    FOR EACH ROW
    WHEN (OLD.stock IS DISTINCT FROM NEW.stock)
    EXECUTE FUNCTION public.log_stock_change();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────

-- Enable RLS on all tables
ALTER TABLE public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brands            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.addresses         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements   ENABLE ROW LEVEL SECURITY;


-- ── PROFILES ──────────────────────────────────────────────────────────────

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_admin());


-- ── BRANDS ────────────────────────────────────────────────────────────────

CREATE POLICY "Anyone can view active brands"
  ON public.brands FOR SELECT
  USING (is_active = TRUE);

CREATE POLICY "Admins can view all brands"
  ON public.brands FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can manage brands"
  ON public.brands FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── CATEGORIES ────────────────────────────────────────────────────────────

CREATE POLICY "Anyone can view active categories"
  ON public.categories FOR SELECT
  USING (is_active = TRUE);

CREATE POLICY "Admins can view all categories"
  ON public.categories FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can manage categories"
  ON public.categories FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── PRODUCTS ──────────────────────────────────────────────────────────────

CREATE POLICY "Anyone can view active products"
  ON public.products FOR SELECT
  USING (is_active = TRUE);

CREATE POLICY "Admins can view all products"
  ON public.products FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can manage products"
  ON public.products FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── PRODUCT_CATEGORIES ───────────────────────────────────────────────────

CREATE POLICY "Anyone can view product categories"
  ON public.product_categories FOR SELECT
  USING (TRUE);

CREATE POLICY "Admins can manage product categories"
  ON public.product_categories FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── PRODUCT_VARIANTS ─────────────────────────────────────────────────────

CREATE POLICY "Anyone can view active variants"
  ON public.product_variants FOR SELECT
  USING (is_active = TRUE);

CREATE POLICY "Admins can view all variants"
  ON public.product_variants FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can manage variants"
  ON public.product_variants FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── PRODUCT_IMAGES ───────────────────────────────────────────────────────

CREATE POLICY "Anyone can view product images"
  ON public.product_images FOR SELECT
  USING (TRUE);

CREATE POLICY "Admins can manage product images"
  ON public.product_images FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── ADDRESSES ─────────────────────────────────────────────────────────────

CREATE POLICY "Users can manage own addresses"
  ON public.addresses FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all addresses"
  ON public.addresses FOR SELECT
  USING (public.is_admin());


-- ── CART_ITEMS ─────────────────────────────────────────────────────────────

CREATE POLICY "Users can manage own cart"
  ON public.cart_items FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ── ORDERS ────────────────────────────────────────────────────────────────

CREATE POLICY "Users can view own orders"
  ON public.orders FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own orders"
  ON public.orders FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all orders"
  ON public.orders FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can update orders"
  ON public.orders FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── ORDER_ITEMS ───────────────────────────────────────────────────────────

CREATE POLICY "Users can view own order items"
  ON public.order_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE orders.id = order_items.order_id
        AND orders.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can view all order items"
  ON public.order_items FOR SELECT
  USING (public.is_admin());


-- ── STOCK_MOVEMENTS ──────────────────────────────────────────────────────

CREATE POLICY "Admins can view stock movements"
  ON public.stock_movements FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can insert stock movements"
  ON public.stock_movements FOR INSERT
  WITH CHECK (public.is_admin());


-- ────────────────────────────────────────────────────────────────────────────
-- 6. STORAGE BUCKETS
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('product-images', 'product-images', TRUE),
  ('brand-logos',    'brand-logos',    TRUE),
  ('avatars',        'avatars',        FALSE)
ON CONFLICT (id) DO NOTHING;

-- Public read for product images and brand logos
CREATE POLICY "Public read product images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');

CREATE POLICY "Public read brand logos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'brand-logos');

-- Admins can upload product images and brand logos
CREATE POLICY "Admins upload product images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'product-images' AND public.is_admin());

CREATE POLICY "Admins manage product images"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'product-images' AND public.is_admin());

CREATE POLICY "Admins delete product images"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'product-images' AND public.is_admin());

CREATE POLICY "Admins upload brand logos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'brand-logos' AND public.is_admin());

-- Users can manage their own avatars
CREATE POLICY "Users upload own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

CREATE POLICY "Users read own avatar"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

CREATE POLICY "Users update own avatar"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );


-- ────────────────────────────────────────────────────────────────────────────
-- 7. SEED DATA (optional — remove in production)
-- ────────────────────────────────────────────────────────────────────────────

-- Example brands
INSERT INTO public.brands (name, slug) VALUES
  ('Chanel',       'chanel'),
  ('Dior',         'dior'),
  ('Tom Ford',     'tom-ford'),
  ('Creed',        'creed'),
  ('Lattafa',      'lattafa'),
  ('Armaf',        'armaf'),
  ('Versace',      'versace'),
  ('Paco Rabanne', 'paco-rabanne')
ON CONFLICT (slug) DO NOTHING;

-- Example categories
INSERT INTO public.categories (name, slug, position) VALUES
  ('Hombre',     'hombre',     1),
  ('Mujer',      'mujer',      2),
  ('Unisex',     'unisex',     3),
  ('Árabe',      'arabe',      4),
  ('Nicho',      'nicho',      5),
  ('Diseñador',  'disenador',  6),
  ('Decant',     'decant',     7)
ON CONFLICT (slug) DO NOTHING;


-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION
-- ════════════════════════════════════════════════════════════════════════════