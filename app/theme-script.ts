// Runs in <head> before the first paint, so a dark-mode device never flashes the light theme (pilot plan item 8).
// The choice ("light", "dark" or "system") is saved per device in localStorage; "system" follows the device setting
// and keeps following it while the app is open. app/operations-theme.tsx calls window.__rmc2ApplyTheme after a change.
export const THEME_KEY = 'rmc2-theme';
export const themeScript = `(function(){var d=document.documentElement,m=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)');
function pref(){try{var p=localStorage.getItem('${THEME_KEY}');return p==='light'||p==='dark'?p:'system'}catch(e){return 'system'}}
function apply(){var p=pref(),t=p==='system'?(m&&m.matches?'dark':'light'):p;d.setAttribute('data-theme',t);d.setAttribute('data-theme-choice',p);}
apply();window.__rmc2ApplyTheme=apply;if(m){try{m.addEventListener('change',apply)}catch(e){m.addListener&&m.addListener(apply)}}})();`;
