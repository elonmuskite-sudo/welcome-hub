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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      conversations: {
        Row: {
          created_at: string
          id: string
          kind: string
          last_message: string | null
          last_message_at: string
          user_a: string
          user_b: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          last_message?: string | null
          last_message_at?: string
          user_a: string
          user_b?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          last_message?: string | null
          last_message_at?: string
          user_a?: string
          user_b?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          encrypted: boolean
          file_name: string | null
          file_url: string | null
          id: string
          sender_id: string | null
          sender_kind: string
          type: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          encrypted?: boolean
          file_name?: string | null
          file_url?: string | null
          id?: string
          sender_id?: string | null
          sender_kind?: string
          type?: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          encrypted?: boolean
          file_name?: string | null
          file_url?: string | null
          id?: string
          sender_id?: string | null
          sender_kind?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string
          created_at: string
          first_name: string
          full_name: string
          id: string
          interests: string[]
          last_name: string
          nexus_id: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string
          created_at?: string
          first_name?: string
          full_name?: string
          id: string
          interests?: string[]
          last_name?: string
          nexus_id: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string
          created_at?: string
          first_name?: string
          full_name?: string
          id?: string
          interests?: string[]
          last_name?: string
          nexus_id?: string
        }
        Relationships: []
      }
      saved_contacts: {
        Row: {
          contact_id: string
          created_at: string
          nickname: string | null
          owner_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          nickname?: string | null
          owner_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          nickname?: string | null
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      support_requests: {
        Row: {
          admin_id: string | null
          claimed_at: string | null
          closed_at: string | null
          conversation_id: string
          created_at: string
          id: string
          reason: string | null
          status: string
          user_id: string
          waiting_since: string | null
        }
        Insert: {
          admin_id?: string | null
          claimed_at?: string | null
          closed_at?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          reason?: string | null
          status?: string
          user_id: string
          waiting_since?: string | null
        }
        Update: {
          admin_id?: string | null
          claimed_at?: string | null
          closed_at?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          reason?: string | null
          status?: string
          user_id?: string
          waiting_since?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_requests_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      members: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          first_name: string | null
          full_name: string | null
          id: string | null
          interests: string[] | null
          last_name: string | null
          member_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string | null
          interests?: string[] | null
          last_name?: string | null
          member_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string | null
          interests?: string[] | null
          last_name?: string | null
          member_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      can_view_conversation: {
        Args: { _conv: string; _user: string }
        Returns: boolean
      }
      claim_support_request: { Args: { p_request: string }; Returns: string }
      close_support_request: {
        Args: { p_conversation: string }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_conversation_member: {
        Args: { _conv: string; _user: string }
        Returns: boolean
      }
      lookup_member_by_nexus_id: {
        Args: { p_nexus_id: string }
        Returns: {
          avatar_url: string
          first_name: string
          full_name: string
          id: string
          last_name: string
          nexus_id: string
        }[]
      }
      request_live_agent: {
        Args: { p_conversation: string; p_reason?: string }
        Returns: undefined
      }
      shares_conversation: {
        Args: { _a: string; _b: string }
        Returns: boolean
      }
      start_direct_conversation: { Args: { p_other: string }; Returns: string }
      start_support_conversation: { Args: never; Returns: string }
    }
    Enums: {
      app_role: "admin" | "user"
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
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
