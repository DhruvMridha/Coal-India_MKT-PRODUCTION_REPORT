import {PostgrestClient} from '@supabase/postgrest-js';
export const createBrowserClient=(url:string,key:string)=>new PostgrestClient(url,{headers:{apikey:key,Authorization:'Bearer '+process.env.TOKEN}});
