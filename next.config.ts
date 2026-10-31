import type { NextConfig } from "next";
// The private proposal templates (resources/private, not in git) are bundled into the API function only
// (never public/); CLI deploys upload them from this PC via .vercelignore.
const config:NextConfig={images:{unoptimized:true},devIndicators:false,serverExternalPackages:['exceljs','pizzip','playwright-core'],outputFileTracingIncludes:{'/api/operations/[[...path]]':['./resources/private/**/*']},outputFileTracingExcludes:{'/*':['./.data/**/*','./test-results/**/*']}};
if(process.env.VERCEL)console.log('[rmc2] build env present:',['RMC2_DB','RMC2_DATABASE_URL','RMC2_STORAGE','RMC2_SUPABASE_SECRET_KEY'].map(name=>name+'='+Boolean(process.env[name])).join(' '));
export default config;
