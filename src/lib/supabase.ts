import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
export const supabaseReady = Boolean(supabaseUrl && key)
export const supabase = supabaseReady ? createClient(supabaseUrl!, key!) : null
