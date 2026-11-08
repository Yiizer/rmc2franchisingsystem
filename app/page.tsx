import OperationsApp, { type AppEnvironment } from './operations-app';
// The login badge follows where mail actually goes: live only when production mail is switched on.
function environment(): AppEnvironment { if (!process.env.VERCEL) return 'local'; return process.env.RMC2_MAIL_ENV === 'production' ? 'live' : 'test'; }
export default function Home(){return <OperationsApp environment={environment()}/>;}
