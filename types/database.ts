export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      addresses: {
        Row: {
          canton: string
          created_at: string
          district: string
          exact_address: string
          id: string
          province: string
          references: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          canton?: string
          created_at?: string
          district?: string
          exact_address?: string
          id?: string
          province: string
          references?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          canton?: string
          created_at?: string
          district?: string
          exact_address?: string
          id?: string
          province?: string
          references?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "addresses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      cart_items: {
        Row: {
          created_at: string
          id: string
          quantity: number
          updated_at: string
          user_id: string
          variant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          quantity?: number
          updated_at?: string
          user_id: string
          variant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          quantity?: number
          updated_at?: string
          user_id?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          parent_id: string | null
          position: number
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          parent_id?: string | null
          position?: number
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          parent_id?: string | null
          position?: number
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      decant_transformations: {
        Row: {
          created_at: string
          id: string
          ml_generated: number
          performed_by: string
          product_id: string
          quantity_used: number
          source_variant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ml_generated: number
          performed_by: string
          product_id: string
          quantity_used: number
          source_variant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ml_generated?: number
          performed_by?: string
          product_id?: string
          quantity_used?: number
          source_variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dt_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dt_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dt_source_variant_fkey"
            columns: ["product_id", "source_variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["product_id", "id"]
          },
        ]
      }
      friend_requests: {
        Row: {
          created_at: string
          id: string
          receiver_id: string
          responded_at: string | null
          sender_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          receiver_id: string
          responded_at?: string | null
          sender_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          receiver_id?: string
          responded_at?: string | null
          sender_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "friend_requests_receiver_id_fkey"
            columns: ["receiver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friend_requests_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friendships: {
        Row: {
          created_at: string
          friend_request_id: string | null
          id: string
          user_id_1: string
          user_id_2: string
        }
        Insert: {
          created_at?: string
          friend_request_id?: string | null
          id?: string
          user_id_1: string
          user_id_2: string
        }
        Update: {
          created_at?: string
          friend_request_id?: string | null
          id?: string
          user_id_1?: string
          user_id_2?: string
        }
        Relationships: [
          {
            foreignKeyName: "friendships_friend_request_id_fkey"
            columns: ["friend_request_id"]
            isOneToOne: false
            referencedRelation: "friend_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_user_id_1_fkey"
            columns: ["user_id_1"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_user_id_2_fkey"
            columns: ["user_id_2"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          brand_name: string
          created_at: string
          id: string
          line_total: number
          order_id: string
          product_name: string
          product_type: Database["public"]["Enums"]["product_type"]
          quantity: number
          size_ml: number
          sku: string
          unit_price: number
          variant_id: string | null
          was_wholesale_price: boolean
        }
        Insert: {
          brand_name: string
          created_at?: string
          id?: string
          line_total: number
          order_id: string
          product_name: string
          product_type: Database["public"]["Enums"]["product_type"]
          quantity: number
          size_ml: number
          sku: string
          unit_price: number
          variant_id?: string | null
          was_wholesale_price?: boolean
        }
        Update: {
          brand_name?: string
          created_at?: string
          id?: string
          line_total?: number
          order_id?: string
          product_name?: string
          product_type?: Database["public"]["Enums"]["product_type"]
          quantity?: number
          size_ml?: number
          sku?: string
          unit_price?: number
          variant_id?: string | null
          was_wholesale_price?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_notifications: {
        Row: {
          attempts: number
          created_at: string
          error_message: string | null
          id: string
          notification_type: string
          order_id: string
          provider_message_id: string | null
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          id?: string
          notification_type: string
          order_id: string
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          id?: string
          notification_type?: string
          order_id?: string
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_notifications_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          billing_company_name: string | null
          billing_tax_id: string | null
          created_at: string
          created_by_admin_id: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string
          discount: number
          id: string
          is_wholesale_order: boolean
          notes: string | null
          order_number: number
          order_status: Database["public"]["Enums"]["order_status"]
          paid_at: string | null
          payment_provider: string | null
          payment_reference: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          shipping_address: string
          shipping_canton: string
          shipping_cost: number
          shipping_district: string
          shipping_method: string | null
          shipping_province: string
          shipping_reference: string | null
          source: string
          subtotal: number
          tax: number
          total: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          billing_company_name?: string | null
          billing_tax_id?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          customer_email?: string | null
          customer_name: string
          customer_phone: string
          discount?: number
          id?: string
          is_wholesale_order?: boolean
          notes?: string | null
          order_number?: never
          order_status?: Database["public"]["Enums"]["order_status"]
          paid_at?: string | null
          payment_provider?: string | null
          payment_reference?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          shipping_address: string
          shipping_canton: string
          shipping_cost?: number
          shipping_district: string
          shipping_method?: string | null
          shipping_province: string
          shipping_reference?: string | null
          source?: string
          subtotal: number
          tax?: number
          total: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          billing_company_name?: string | null
          billing_tax_id?: string | null
          created_at?: string
          created_by_admin_id?: string | null
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string
          discount?: number
          id?: string
          is_wholesale_order?: boolean
          notes?: string | null
          order_number?: never
          order_status?: Database["public"]["Enums"]["order_status"]
          paid_at?: string | null
          payment_provider?: string | null
          payment_reference?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          shipping_address?: string
          shipping_canton?: string
          shipping_cost?: number
          shipping_district?: string
          shipping_method?: string | null
          shipping_province?: string
          shipping_reference?: string | null
          source?: string
          subtotal?: number
          tax?: number
          total?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_created_by_admin_id_fkey"
            columns: ["created_by_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      processed_webhooks: {
        Row: {
          event_id: string
          id: string
          payload_hash: string | null
          processed_at: string
          provider: string
        }
        Insert: {
          event_id: string
          id?: string
          payload_hash?: string | null
          processed_at?: string
          provider: string
        }
        Update: {
          event_id?: string
          id?: string
          payload_hash?: string | null
          processed_at?: string
          provider?: string
        }
        Relationships: []
      }
      product_categories: {
        Row: {
          category_id: string
          product_id: string
        }
        Insert: {
          category_id: string
          product_id: string
        }
        Update: {
          category_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_images: {
        Row: {
          alt_text: string | null
          created_at: string
          id: string
          position: number
          product_id: string
          url: string
          variant_id: string | null
        }
        Insert: {
          alt_text?: string | null
          created_at?: string
          id?: string
          position?: number
          product_id: string
          url: string
          variant_id?: string | null
        }
        Update: {
          alt_text?: string | null
          created_at?: string
          id?: string
          position?: number
          product_id?: string
          url?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_variant_fkey"
            columns: ["product_id", "variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["product_id", "id"]
          },
        ]
      }
      product_variants: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_on_offer: boolean
          is_wholesale_enabled: boolean
          min_wholesale_quantity: number | null
          offer_price: number | null
          position: number
          price: number
          product_id: string
          product_type: Database["public"]["Enums"]["product_type"]
          size_ml: number
          sku: string
          stock: number
          updated_at: string
          wholesale_price: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_on_offer?: boolean
          is_wholesale_enabled?: boolean
          min_wholesale_quantity?: number | null
          offer_price?: number | null
          position?: number
          price: number
          product_id: string
          product_type: Database["public"]["Enums"]["product_type"]
          size_ml: number
          sku: string
          stock?: number
          updated_at?: string
          wholesale_price?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_on_offer?: boolean
          is_wholesale_enabled?: boolean
          min_wholesale_quantity?: number | null
          offer_price?: number | null
          position?: number
          price?: number
          product_id?: string
          product_type?: Database["public"]["Enums"]["product_type"]
          size_ml?: number
          sku?: string
          stock?: number
          updated_at?: string
          wholesale_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          brand_id: string
          concentration: string | null
          created_at: string
          decant_stock_ml: number
          description: string | null
          featured_variant_id: string | null
          gender: string | null
          id: string
          is_active: boolean
          name: string
          notes_base: string | null
          notes_middle: string | null
          notes_top: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          concentration?: string | null
          created_at?: string
          decant_stock_ml?: number
          description?: string | null
          featured_variant_id?: string | null
          gender?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes_base?: string | null
          notes_middle?: string | null
          notes_top?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          concentration?: string | null
          created_at?: string
          decant_stock_ml?: number
          description?: string | null
          featured_variant_id?: string | null
          gender?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes_base?: string | null
          notes_middle?: string | null
          notes_top?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_featured_variant"
            columns: ["featured_variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_experience_events: {
        Row: {
          created_at: string
          id: string
          order_id: string
          user_id: string
          xp_earned: number
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          user_id: string
          xp_earned: number
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          user_id?: string
          xp_earned?: number
        }
        Relationships: [
          {
            foreignKeyName: "profile_experience_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_experience_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          experience_points: number
          full_name: string | null
          id: string
          is_profile_public: boolean
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          show_in_ranking: boolean
          updated_at: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          experience_points?: number
          full_name?: string | null
          id: string
          is_profile_public?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          show_in_ranking?: boolean
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          experience_points?: number
          full_name?: string | null
          id?: string
          is_profile_public?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          show_in_ranking?: boolean
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      shipping_zone_cantons: {
        Row: {
          canton_code: string
          canton_name: string
          province_code: string
          province_name: string
          zone_id: string
        }
        Insert: {
          canton_code: string
          canton_name: string
          province_code: string
          province_name: string
          zone_id: string
        }
        Update: {
          canton_code?: string
          canton_name?: string
          province_code?: string
          province_name?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_zone_cantons_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "shipping_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_zones: {
        Row: {
          base_cost: number
          code: string
          created_at: string
          free_shipping_threshold: number | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          base_cost: number
          code: string
          created_at?: string
          free_shipping_threshold?: number | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          base_cost?: number
          code?: string
          created_at?: string
          free_shipping_threshold?: number | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          created_at: string
          delta: number | null
          id: string
          ml_delta: number | null
          new_ml: number | null
          new_stock: number | null
          notes: string | null
          performed_by: string | null
          previous_ml: number | null
          previous_stock: number | null
          product_id: string | null
          reason: Database["public"]["Enums"]["stock_movement_reason"]
          reference_id: string | null
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          delta?: number | null
          id?: string
          ml_delta?: number | null
          new_ml?: number | null
          new_stock?: number | null
          notes?: string | null
          performed_by?: string | null
          previous_ml?: number | null
          previous_stock?: number | null
          product_id?: string | null
          reason: Database["public"]["Enums"]["stock_movement_reason"]
          reference_id?: string | null
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          delta?: number | null
          id?: string
          ml_delta?: number | null
          new_ml?: number | null
          new_stock?: number | null
          notes?: string | null
          performed_by?: string | null
          previous_ml?: number | null
          previous_stock?: number | null
          product_id?: string | null
          reason?: Database["public"]["Enums"]["stock_movement_reason"]
          reference_id?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      wholesale_profiles: {
        Row: {
          application_status: string
          business_activity: string | null
          company_name: string
          created_at: string
          tax_id: string
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          application_status?: string
          business_activity?: string | null
          company_name: string
          created_at?: string
          tax_id: string
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          application_status?: string
          business_activity?: string | null
          company_name?: string
          created_at?: string
          tax_id?: string
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wholesale_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_friend_request: { Args: { p_request_id: string }; Returns: string }
      admin_list_product_variants: {
        Args: { p_limit?: number; p_offset?: number; p_search?: string }
        Returns: {
          brand: string
          categories: Json
          description: string
          image_url: string
          is_active: boolean
          is_on_offer: boolean
          min_wholesale_quantity: number
          name: string
          offer_price: number
          price: number
          product_id: string
          product_type: Database["public"]["Enums"]["product_type"]
          size_ml: number
          sku: string
          stock: number
          total_count: number
          variant_id: string
          wholesale_price: number
        }[]
      }
      admin_list_stock_movements: {
        Args: { p_limit?: number; p_offset?: number; p_search?: string }
        Returns: {
          brand_name: string
          created_at: string
          delta: number
          id: string
          ml_delta: number
          new_ml: number
          new_stock: number
          notes: string
          performed_by_name: string
          previous_ml: number
          previous_stock: number
          product_id: string
          product_name: string
          product_type: Database["public"]["Enums"]["product_type"]
          reason: Database["public"]["Enums"]["stock_movement_reason"]
          size_ml: number
          sku: string
          total_count: number
          variant_id: string
        }[]
      }
      advance_order_status: {
        Args: { p_new_status: string; p_order_id: string }
        Returns: Json
      }
      analytics_best_sellers: {
        Args: { p_limit?: number; p_since?: string }
        Returns: {
          brand_name: string
          product_name: string
          product_type: Database["public"]["Enums"]["product_type"]
          size_ml: number
          sku: string
          total_revenue: number
          total_units: number
          variant_id: string
        }[]
      }
      analytics_low_stock: {
        Args: { p_threshold?: number }
        Returns: {
          product_name: string
          product_type: Database["public"]["Enums"]["product_type"]
          size_ml: number
          sku: string
          stock: number
          variant_id: string
        }[]
      }
      analytics_revenue_summary: {
        Args: { p_since?: string }
        Returns: {
          avg_order_value: number
          gross_revenue: number
          total_orders: number
          total_units: number
        }[]
      }
      backfill_guest_order_xp: {
        Args: never
        Returns: {
          orders_granted: number
          user_id: string
        }[]
      }
      calculate_shipping_cost: {
        Args: { p_canton_code: string; p_subtotal: number }
        Returns: Json
      }
      cancel_friend_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      claim_guest_orders: {
        Args: { p_email: string; p_user_id: string }
        Returns: number
      }
      claim_order_notification: {
        Args: { p_order_id: string; p_type: string }
        Returns: string
      }
      create_new_product: {
        Args: {
          p_brand_id: string
          p_category_ids: string[]
          p_concentration: string
          p_description: string
          p_gender: string
          p_image_url: string
          p_is_on_offer: boolean
          p_name: string
          p_notes_base: string
          p_notes_middle: string
          p_notes_top: string
          p_offer_price?: number
          p_price: number
          p_product_type: Database["public"]["Enums"]["product_type"]
          p_size_ml: number
          p_sku: string
          p_stock: number
        }
        Returns: Json
      }
      decrease_decant_pool: {
        Args: { p_ml: number; p_order_id: string; p_product_id: string }
        Returns: undefined
      }
      decrease_variant_stock: {
        Args: { p_order_id: string; p_quantity: number; p_variant_id: string }
        Returns: undefined
      }
      deny_order_admin: {
        Args: { p_order_id: string; p_reason: string }
        Returns: Json
      }
      finalize_order_notification: {
        Args: {
          p_error_message?: string
          p_id: string
          p_provider_message_id?: string
          p_status: string
        }
        Returns: undefined
      }
      get_friend_profile: {
        Args: { p_friend_user_id: string }
        Returns: {
          avatar_url: string
          experience_points: number
          full_name: string
          user_id: string
          username: string
        }[]
      }
      get_friend_purchased_products: {
        Args: { p_friend_user_id: string }
        Returns: {
          brand_name: string
          image_url: string
          product_id: string
          product_name: string
          product_slug: string
        }[]
      }
      get_friends: {
        Args: never
        Returns: {
          avatar_url: string
          experience_points: number
          friend_user_id: string
          friends_since: string
          friendship_id: string
          full_name: string
          username: string
        }[]
      }
      get_ranking_top: {
        Args: { p_limit?: number }
        Returns: {
          experience_points: number
          rank_position: number
          username: string
        }[]
      }
      get_received_friend_requests: {
        Args: never
        Returns: {
          avatar_url: string
          experience_points: number
          request_id: string
          requested_at: string
          user_id: string
          username: string
        }[]
      }
      get_sent_friend_requests: {
        Args: never
        Returns: {
          avatar_url: string
          request_id: string
          requested_at: string
          user_id: string
          username: string
        }[]
      }
      grant_order_xp: { Args: { p_order_id: string }; Returns: Json }
      increase_decant_pool: {
        Args: {
          p_ml: number
          p_order_id: string
          p_product_id: string
          p_reason: Database["public"]["Enums"]["stock_movement_reason"]
        }
        Returns: undefined
      }
      is_admin: { Args: never; Returns: boolean }
      mark_order_paid:
        | { Args: { p_order_id: string }; Returns: Json }
        | {
            Args: { p_note?: string; p_order_id: string; p_reference?: string }
            Returns: Json
          }
      place_admin_order: { Args: { p_payload: Json }; Returns: Json }
      place_order: { Args: { p_payload: Json }; Returns: Json }
      reconcile_profile_order_xp: {
        Args: { p_user_id: string }
        Returns: number
      }
      register_bulk_stock: { Args: { p_payload: Json }; Returns: Json }
      reject_friend_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      remove_friend: { Args: { p_friend_user_id: string }; Returns: boolean }
      restore_variant_stock: { Args: { p_order_id: string }; Returns: Json }
      review_wholesale_application: {
        Args: { p_decision: string; p_user_id: string }
        Returns: Json
      }
      search_products: {
        Args: { p_limit?: number; p_offset?: number; p_query: string }
        Returns: {
          brand_name: string
          id: string
          name: string
          similarity: number
          slug: string
        }[]
      }
      search_public_users: {
        Args: { p_limit?: number; p_offset?: number; p_query: string }
        Returns: {
          avatar_url: string
          relationship_status: string
          user_id: string
          username: string
        }[]
      }
      send_friend_request: {
        Args: { p_target_user_id: string }
        Returns: string
      }
      set_social_profile_visibility: {
        Args: { p_is_public: boolean }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      social_are_friends: {
        Args: { p_user_a: string; p_user_b: string }
        Returns: boolean
      }
      sweep_abandoned_orders: { Args: never; Returns: number }
      transform_to_decant: {
        Args: {
          p_notes?: string
          p_quantity: number
          p_source_variant_id: string
        }
        Returns: Json
      }
      unaccent: { Args: { "": string }; Returns: string }
    }
    Enums: {
      order_status: "pending" | "received" | "shipped" | "denied"
      payment_status: "pending" | "paid" | "failed" | "refunded"
      product_type: "full_size" | "decant" | "set"
      stock_movement_reason:
        | "manual_adjustment"
        | "order_placed"
        | "order_cancelled"
        | "restock"
        | "correction"
        | "return"
        | "transformed_to_decant"
      user_role: "customer" | "admin" | "wholesale"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      order_status: ["pending", "received", "shipped", "denied"],
      payment_status: ["pending", "paid", "failed", "refunded"],
      product_type: ["full_size", "decant", "set"],
      stock_movement_reason: [
        "manual_adjustment",
        "order_placed",
        "order_cancelled",
        "restock",
        "correction",
        "return",
        "transformed_to_decant",
      ],
      user_role: ["customer", "admin", "wholesale"],
    },
  },
} as const
