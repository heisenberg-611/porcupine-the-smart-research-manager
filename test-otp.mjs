import { createClient } from 'npm:@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if(!SUPABASE_URL) {
    const fs = require('fs');
    const env = fs.readFileSync('.env.local', 'utf8');
    // very hacky dot env parse
    // i will just use bash
}
