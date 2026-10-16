import type { NextConfig } from "next";
const config:NextConfig={images:{unoptimized:true},devIndicators:false,serverExternalPackages:['exceljs','pizzip','playwright-core'],outputFileTracingExcludes:{'/*':['./.data/**/*','./test-results/**/*']}};
export default config;
