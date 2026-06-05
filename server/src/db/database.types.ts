// Auto-generated database types for Supabase
// Generated from schema: server/src/db/supabase-production-schema.sql

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          user_id: string
          email: string
          full_name: string | null
          phone: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          email: string
          full_name?: string | null
          phone?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          email?: string
          full_name?: string | null
          phone?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_keys: {
        Row: {
          id: string
          user_id: string
          provider: string
          encrypted_key: string
          key_preview: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          provider: string
          encrypted_key: string
          key_preview: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          provider?: string
          encrypted_key?: string
          key_preview?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      unified_keys: {
        Row: {
          id: string
          user_id: string
          key: string
          created_at: string
          last_rotated: string
        }
        Insert: {
          id?: string
          user_id: string
          key: string
          created_at?: string
          last_rotated?: string
        }
        Update: {
          id?: string
          user_id?: string
          key?: string
          created_at?: string
          last_rotated?: string
        }
        Relationships: [
          {
            foreignKeyName: "unified_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_logs: {
        Row: {
          id: string
          user_id: string
          provider: string
          model: string
          input_tokens: number
          output_tokens: number
          total_tokens: number
          request_date: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          provider: string
          model: string
          input_tokens: number
          output_tokens: number
          total_tokens: number
          request_date: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          provider?: string
          model?: string
          input_tokens?: number
          output_tokens?: number
          total_tokens?: number
          request_date?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_settings: {
        Row: {
          id: string
          user_id: string
          key: string
          value: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          key: string
          value: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          key?: string
          value?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      dev_users: {
        Row: {
          id: string
          email: string
          password_hash: string
          created_at: string
        }
        Insert: {
          id?: string
          email: string
          password_hash: string
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          password_hash?: string
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
