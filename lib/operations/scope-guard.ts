import { AppError } from './errors';
import { isOwnerScoped } from './permissions';
import type { Staff } from './types';

// Division Heads and SOAs may call ONLY these routes (whitelist). Everything else, including every route added in the future, answers 403 for them
// without touching any data. The route handler calls assertOwnerScopedRoute right after sign-in, before any lookup.
//   GET   bootstrap | sample-form | pdf-worker | my-clients | my-clients/:id | my-clients/:id/proposal | my-clients/:id/report/:reportId | my-team
//   POST  logout | account-settings | notifications | intake | intake-fields | my-clients/:id/progress-report | push/subscribe|unsubscribe|mute (own phone only)
//         my-team/create | my-team/:id/deactivate | my-team/:id/reset-password (pass the whitelist for both owner roles; division-team.ts answers 403 unless the caller is a Division Head)
//   GET   push (own phone settings)
const segment=(value:string|undefined)=>!!value&&value.length<=200;
export function ownerRouteAllowed(method:'GET'|'POST',route:string[]):boolean{
  const [a,b,c,d]=route;
  if(method==='GET'){
    if(route.length===1)return ['bootstrap','sample-form','pdf-worker','my-clients','push','my-team'].includes(a);
    if(a!=='my-clients'||!segment(b))return false;
    if(route.length===2)return true;
    if(route.length===3)return c==='proposal';
    return route.length===4&&c==='report'&&segment(d);
  }
  if(route.length===1)return ['logout','account-settings','notifications','intake','intake-fields','problem-reports'].includes(a);
  if(route.length===2&&a==='push')return ['subscribe','unsubscribe','mute','test'].includes(b);
  if(route.length===2&&a==='uploads')return b==='start';
  if(route.length===2&&a==='my-team')return b==='create';
  if(route.length===3&&a==='my-team')return segment(b)&&['deactivate','reset-password'].includes(c);
  return route.length===3&&a==='my-clients'&&segment(b)&&c==='progress-report';
}
export function assertOwnerScopedRoute(user:Pick<Staff,'role'>,method:'GET'|'POST',route:string[]){
  if(isOwnerScoped(user)&&!ownerRouteAllowed(method,route))throw new AppError('Your account cannot use this part of the workspace.',403);
}
