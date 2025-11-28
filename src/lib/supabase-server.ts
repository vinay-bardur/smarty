import { createClient } from '@supabase/supabase-js'

const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL') || ''
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || ''

export const createServiceClient = () => {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })
}

export const getUserFromRequest = async (req: Request, allowDemo = false) => {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
  const apikeyHeader = req.headers.get('apikey') || req.headers.get('x-api-key')
  
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const providedKey = token || apikeyHeader
  
  if (!providedKey) {
    if (allowDemo) return null
    throw new Error('Missing authorization token. Pass user JWT in Authorization: Bearer <token> OR use service_role via Authorization+apikey headers for admin tests.')
  }
  
  // Service role path - return admin user
  if (providedKey.startsWith('service_role_') || providedKey === supabaseServiceKey) {
    console.log('Admin access via service_role')
    return { id: 'admin', email: 'admin@system', role: 'service_role' }
  }
  
  // User JWT path
  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const { data: { user }, error } = await supabase.auth.getUser(token!)
  
  if (error || !user) {
    throw new Error('Invalid or expired token')
  }
  
  return user
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
