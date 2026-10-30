export async function navigate(page,view){
 await page.locator('.ops-sidebar').getByRole('button',{name:'Inquiries',exact:true}).waitFor();
 const sidebar=page.locator('.ops-shell-sidebar');if(!await sidebar.count()){await page.getByRole('button',{name:view,exact:true}).click();return;}
 if(view==='Notifications'){await page.getByRole('button',{name:'Notifications',exact:true}).click();if(await page.getByRole('button',{name:'See all notifications',exact:true}).count())await page.getByRole('button',{name:'See all notifications',exact:true}).click();return;}
 if(view==='Settings'){await page.getByRole('button',{name:'Account menu',exact:true}).click();await page.getByRole('button',{name:'Settings',exact:true}).click();return;}
 const target=['My Inquiries','Inquiries'].includes(view)?'Inquiries':['Archives','History'].includes(view)?'Closed':view;
 await sidebar.getByRole('button',{name:target,exact:true}).click();
 const tab={'My Inquiries':'Mine',Inquiries:'All',History:'Sent',Archives:'Archived'}[view];if(tab)await page.locator('.dir-status-filters').getByRole('button',{name:new RegExp('^'+tab+'\\b')}).click();
}


