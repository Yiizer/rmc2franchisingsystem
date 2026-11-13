import type { NextConfig } from "next";
// The private proposal templates (resources/private, not in git) are bundled into the API function only
// (never public/); CLI deploys upload them from this PC via .vercelignore.
// Security headers on every response (security review 2026-11-13). Framing is allowed only from the app itself: the
// inquiry page shows an agent's submitted PDF from the app's own file route in an <iframe>.
const securityHeaders=[
  {key:'Content-Security-Policy',value:"frame-ancestors 'self'"},
  {key:'X-Frame-Options',value:'SAMEORIGIN'},
  {key:'X-Content-Type-Options',value:'nosniff'},
  {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
  {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=(), payment=()'},
  {key:'Strict-Transport-Security',value:'max-age=63072000; includeSubDomains'},
];
const config:NextConfig={async headers(){return [{source:'/:path*',headers:securityHeaders}];},images:{unoptimized:true},devIndicators:false,serverExternalPackages:['exceljs','pizzip','playwright-core','imapflow','mailparser','web-push'],outputFileTracingIncludes:{'/api/operations/[[...path]]':['./resources/private/**/*']},outputFileTracingExcludes:{'/*':['./.data/**/*','./test-results/**/*']}};
if(process.env.VERCEL)console.log('[rmc2] build env present:',['RMC2_DB','RMC2_DATABASE_URL','RMC2_STORAGE','RMC2_SUPABASE_SECRET_KEY'].map(name=>name+'='+Boolean(process.env[name])).join(' '));
export default config;
