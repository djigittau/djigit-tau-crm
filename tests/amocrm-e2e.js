// Сквозной тест воронок «как в amoCRM»: node tests/amocrm-e2e.js "$PWD" /tmp  (нужен playwright с chromium)
const {chromium,devices}=require('playwright');
const URL='file://'+process.argv[2]+'/index.html';
const OUT=process.argv[3];
const results=[];const errs=[];
async function step(name,fn){try{await fn();results.push(['OK',name])}catch(e){results.push(['FAIL',name,e.message.split('\n')[0]])}}
const eq=(a,b,m)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(`${m}: ожидалось ${JSON.stringify(b)}, получено ${JSON.stringify(a)}`)};
const ok=(c,m)=>{if(!c)throw new Error(m)};
// Вход директором (временный пароль уже сменён)
async function login(p){await p.goto(URL);await p.waitForTimeout(500);await p.evaluate(()=>{const u=users.find(x=>x.role==='Руководитель');delete u.mustChange;u.pass='Dir-2026!';persistNow(true)});await p.fill('#lg_p','director@djigittau.kz');await p.fill('#lg_w','Dir-2026!');await p.click('#lgForm button[type=submit]');await p.waitForTimeout(500)}
(async()=>{const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1440,height:900}});const p=await ctx.newPage();
p.on('pageerror',e=>errs.push('pageerror: '+e.message));p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});
await login(p);
await p.evaluate(()=>{demoSeed();persist();init()});await p.waitForTimeout(400);
const E=(f,a)=>p.evaluate(f,a);
const drag=async(i,stage)=>{const dt=await p.evaluateHandle(i=>{const d=new DataTransfer();d.setData('text/plain',String(i));return d},i);
  await p.locator(`.lead[data-id="${i}"]`).dispatchEvent('dragstart',{dataTransfer:dt});const t=p.locator(`.colbody[data-stage="${stage}"]`);
  await t.dispatchEvent('dragover',{dataTransfer:dt});await t.dispatchEvent('drop',{dataTransfer:dt});await p.waitForTimeout(300)};
const go=n=>E(n2=>go(n2),n).then(()=>p.waitForTimeout(300));
await go("Заявки и воронка");

let id;
await step('Создание заявки через «+ Заявка»',async()=>{
  await p.click('[data-act="newlead"]');await p.waitForTimeout(300);
  await p.fill('#mainForm [name=name]','Тестова Зарина');await p.fill('#mainForm [name=phone]','+7 700 999-88-77');
  await p.fill('#mainForm [name=price]','28000');
  await p.click('#mainForm button[type=submit]');await p.waitForTimeout(500);
  id=await E(()=>db.leads.find(x=>x.name==='Тестова Зарина')?.id);ok(id,'заявка не создана');
  ok(await p.locator('#deal.on').count(),'карточка не открылась');
  eq(await E(i=>findDeal(i).stage,id),'Новая заявка','этап');
});
await step('Роботы на «Новой заявке»: задача по нормативу + приветствие',async()=>{
  const r=await E(i=>({t:db.tasks.filter(t=>t.dealId===i&&!t.done).map(t=>t.text),m:findDeal(i).feed.filter(f=>f.type==='msg').map(f=>f.tplName)}),id);
  ok(r.t.includes('Связаться с клиентом'),'нет задачи: '+r.t);ok(r.m.includes('Приветствие бота'),'нет приветствия: '+r.m);
});
await step('Защита от дублей по телефону',async()=>{
  await p.keyboard.press('Escape');await p.click('[data-act="newlead"]');await p.waitForTimeout(300);
  await p.fill('#mainForm [name=name]','Дубль');await p.fill('#mainForm [name=phone]','87009998877');
  await p.click('#mainForm button[type=submit]');await p.waitForTimeout(300);
  ok(await p.locator('#askbg').evaluate(e=>e.style.display==='grid'),'нет вопроса о дубле');
  await p.click('#askNo');await p.click('#formCancel');await p.waitForTimeout(200);
  eq(await E(()=>db.leads.filter(x=>x.name==='Дубль').length),0,'дубль создан');
});
await step('Перетаскивание карточки в «Связались»',async()=>{
  await go("Заявки и воронка");
  await drag(id,'Связались');await p.waitForTimeout(400);
  eq(await E(i=>findDeal(i).stage,id),'Связались','этап после drag');
  ok(await E(i=>findDeal(i).feed.some(f=>f.tplName==='Приглашение на пробное'),id),'нет приглашения');
  ok(await p.locator(`.colbody[data-stage="Связались"] .lead[data-id="${id}"]`).count(),'карточка не в колонке');
});
await step('Смена этапа в карточке → «Пробное занятие»',async()=>{
  await p.click(`.lead[data-id="${id}"]`);await p.waitForTimeout(300);
  await p.selectOption('#d_stage','Пробное занятие');await p.waitForTimeout(400);
  const r=await E(i=>({s:findDeal(i).stage,tr:findDeal(i).trial,t:db.tasks.filter(t=>t.dealId===i&&!t.done).map(t=>t.text)}),id);
  eq(r.s,'Пробное занятие','этап');ok(r.tr,'дата пробного не поставлена');ok(r.t.includes('Напомнить о пробном'),'нет задачи-напоминания');
  ok(await p.locator('#deal.on').count(),'карточка закрылась');
});
await step('Редактирование полей карточки (бюджет, ответственный, теги)',async()=>{
  await p.fill('#d_price','30000');await p.locator('#d_price').dispatchEvent('change');
  await p.fill('#d_manager','Айгерим');await p.locator('#d_manager').dispatchEvent('change');
  await p.fill('#d_tags','vip, #выходные, vip');await p.locator('#d_tags').dispatchEvent('change');await p.waitForTimeout(300);
  const x=await E(i=>findDeal(i),id);eq(x.price,30000,'бюджет');eq(x.manager,'Айгерим','ответственный');eq(x.tags,['vip','выходные'],'теги');
});
await step('Примечание в ленте',async()=>{
  await p.click('#deal [data-mode="note"]');await p.fill('#cText','Мама просит группу по субботам');await p.click('#cForm button.btn');await p.waitForTimeout(300);
  ok(await E(i=>findDeal(i).feed.some(f=>f.type==='note'&&f.text.includes('субботам')),id),'нет примечания');
  ok((await p.locator('#feed').innerText()).includes('субботам'),'не видно в ленте');
});
await step('Ручная задача + выполнение в ленте',async()=>{
  await p.click('#deal [data-mode="task"]');await p.fill('#cText','Перезвонить маме');await p.click('#cForm button.btn');await p.waitForTimeout(300);
  const tid=await E(i=>db.tasks.find(t=>t.dealId===i&&t.text==='Перезвонить маме')?.id,id);ok(tid,'задача не создана');
  await p.check(`#deal [data-tdone="${tid}"]`);await p.waitForTimeout(300);
  ok(await E(t=>db.tasks.find(x=>x.id===t).done,tid),'задача не выполнена');
});
await step('WhatsApp: шаблон подставляет имя, отправка помечает «отправлено»',async()=>{
  await p.click('#deal [data-mode="wa"]');await p.selectOption('#cTpl','confirm');
  const txt=await p.inputValue('#cText');ok(txt.includes('Зарина')&&!txt.includes('{'),'плохая подстановка: '+txt);
  const before=await E(i=>findDeal(i).feed.filter(f=>f.type==='msg'&&!f.sent).length,id);
  const a=p.locator('#feed a[data-sent]').first();ok(await a.count(),'нет кнопки «Отправить в WhatsApp»');
  await a.click({modifiers:[]}).catch(()=>{});await p.waitForTimeout(400);
  const after=await E(i=>findDeal(i).feed.filter(f=>f.type==='msg'&&!f.sent).length,id);ok(after<before,'не помечено отправленным');
  await p.bringToFront();await p.click('#deal [data-mode="note"]');
});
await step('«Купили абонемент»: ученик в базе, авто-задачи закрыты',async()=>{
  await p.click('#deal [data-set="Купили абонемент"]');await p.waitForTimeout(400);
  const r=await E(i=>({s:findDeal(i).stage,st:db.students.some(s=>s.name==='Тестова Зарина'),t:db.tasks.filter(t=>t.dealId===i&&!t.done&&t.auto).length,w:findDeal(i).feed.some(f=>f.tplName==='Добро пожаловать')}),id);
  eq(r.s,'Купили абонемент','этап');ok(r.st,'ученик не создан');eq(r.t,0,'открытые авто-задачи');ok(r.w,'нет приветствия');
  await p.keyboard.press('Escape');
});
let id2;
await step('Отказ с обязательной причиной и возврат в работу',async()=>{
  id2=await E(()=>db.leads.find(x=>x.stage==='Связались').id);
  await go("Заявки и воронка");await p.click(`.lead[data-id="${id2}"]`);await p.waitForTimeout(300);
  await p.click('#deal [data-set="Отказ"]');await p.waitForTimeout(200);
  ok(await p.locator('#reasonbg').evaluate(e=>e.style.display==='grid'),'нет окна причины');
  await p.click('#reasonNo');eq(await E(i=>findDeal(i).stage,id2),'Связались','отмена всё равно закрыла');
  await p.click('#deal [data-set="Отказ"]');await p.selectOption('#reasonSel','Дорого');await p.fill('#reasonTxt','ищут дешевле');
  await p.click('#reasonForm button[type=submit]');await p.waitForTimeout(400);
  const x=await E(i=>findDeal(i),id2);eq(x.stage,'Отказ','этап');eq(x.reason,'Дорого','причина');
  await p.keyboard.press('Escape');await p.waitForTimeout(200);
  ok((await p.locator('#content').innerText()).includes('Отказы'),'нет блока «Отказы»');
  await p.click(`#content button.mini[data-open="${id2}"]`);await p.waitForTimeout(300);
  await p.click('#deal [data-set="Новая заявка"]');await p.waitForTimeout(300);
  eq(await E(i=>findDeal(i).stage,id2),'Новая заявка','не вернулась');await p.keyboard.press('Escape');
});
await step('Перетаскивание в зону «Отказ» внизу экрана',async()=>{
  await go("Заявки и воронка");
  const id3=await E(()=>db.leads.find(x=>x.stage==='Новая заявка').id);
  const dt=await p.evaluateHandle(i=>{const d=new DataTransfer();d.setData('text/plain',String(i));return d},id3);
  await p.locator(`.lead[data-id="${id3}"]`).dispatchEvent('dragstart',{dataTransfer:dt});
  await p.locator('[data-drop="lost"]').dispatchEvent('drop',{dataTransfer:dt});
  await p.waitForTimeout(200);ok(await p.locator('#reasonbg').evaluate(e=>e.style.display==='grid'),'нет окна причины');
  await p.click('#reasonForm button[type=submit]');await p.waitForTimeout(300);eq(await E(i=>findDeal(i).stage,id3),'Отказ','этап');
});
await step('Фильтры-чипы: счётчики совпадают с карточками',async()=>{
  await go("Заявки и воронка");
  for(const f of ['inbox','notask','late','today','trialall']){
    await p.click(`[data-lf="${f}"]`);await p.waitForTimeout(250);
    const n=+(await p.locator(`[data-lf="${f}"] b`).innerText());
    const cards=await p.locator('.columns .lead').count();
    const more=await p.locator('[data-more]').count();
    ok(more||n===cards,`${f}: на чипе ${n}, карточек ${cards}`);
  }
  await p.click('[data-lf="all"]');await p.waitForTimeout(250);
});
await step('Поиск по имени и телефону',async()=>{
  await p.fill('[data-pf="q"]','Тестова');await p.waitForTimeout(500);
  eq(await p.locator('.columns .lead').count(),1,'по имени');
  await p.fill('[data-pf="q"]','9998877');await p.waitForTimeout(500);
  eq(await p.locator('.columns .lead').count(),1,'по телефону');
  await p.fill('[data-pf="q"]','');await p.waitForTimeout(500);
});
await step('Список: массовый тег, ответственный, перенос этапа',async()=>{
  await p.click('[data-view="list"]');await p.waitForTimeout(300);
  const ids=await p.locator('[data-sel]').evaluateAll(es=>es.map(e=>+e.dataset.sel).filter(i=>!db.leads.find(x=>x.id===i&&/Тестова/.test(x.name))).slice(0,3));
  const selAll=async()=>{for(const i of ids){if(!(await p.locator(`[data-sel="${i}"]`).isChecked())){await p.check(`[data-sel="${i}"]`);await p.waitForTimeout(150)}}};
  await selAll();await p.fill('#bkTag','акция');await p.click('[data-bulk="tag"]');await p.waitForTimeout(200);
  await selAll();await p.fill('#bkMgr','Бекзат');await p.click('[data-bulk="mgr"]');await p.waitForTimeout(200);
  const r=await E(is=>is.map(i=>findDeal(i)).map(x=>[x.tags||[],x.manager]),ids);
  ok(r.every(([t,m])=>t.includes('акция')&&m==='Бекзат'),'массовые: '+JSON.stringify(r));
  await selAll();await p.selectOption('#bkStage','Связались');await p.waitForTimeout(300);
  ok((await E(is=>is.map(i=>findDeal(i).stage),ids)).every(s=>s==='Связались'),'перенос');
  await p.click('[data-view="kanban"]');await p.waitForTimeout(200);
});
await step('Сохранённый вид фильтра',async()=>{
  await p.fill('[data-pf="q"]','Тестова');await p.waitForTimeout(500);
  const sv=p.locator('[data-act="pfsave"]');ok(await sv.count(),'нет кнопки сохранения');await sv.click();
  await p.fill('#pvName','Моя Зарина');await p.click('#pvOk');await p.waitForTimeout(300);
  ok(await E(()=>settings.views.some(v=>v.name==='Моя Зарина')),'не сохранён');
  await p.click('[data-act="pfreset"]');await p.waitForTimeout(300);
  await p.locator('[data-pview]',{hasText:'Моя Зарина'}).click();await p.waitForTimeout(300);
  eq(await p.locator('.columns .lead').count(),1,'вид не применился');await p.click('[data-act="pfreset"]');await p.waitForTimeout(200);
});
await step('Продления: «Ждём оплату» → «Продлили» создаёт абонемент и доход',async()=>{
  await p.click('[data-pipe="renew"]');await p.waitForTimeout(300);
  const rid=await E(()=>db.renewals.find(x=>x.stage==='Скоро окончание'&&x.student&&inBranch(x)).id);
  const m0=await E(()=>[db.memberships.length,db.payments.length]);
  await drag(rid,'Ждём оплату');await p.waitForTimeout(300);
  eq(await E(i=>findDeal(i).stage,rid),'Ждём оплату','этап');
  ok(await E(i=>findDeal(i).feed.some(f=>f.type==='msg'&&/оплат/i.test(f.tplName||'')),rid),'нет сообщения со ссылкой на оплату');
  await drag(rid,'Продлили');await p.waitForTimeout(300);
  const m1=await E(()=>[db.memberships.length,db.payments.length]);
  eq([m1[0]-m0[0],m1[1]-m0[1]],[1,1],'абонемент/доход');
  await p.click('[data-pipe="sales"]');await p.waitForTimeout(200);
});
await step('Раздел «Задачи»: выполнение и переход в сделку',async()=>{
  await go("Задачи");const c=p.locator('#content [data-tdone]').first();const tid=+(await c.getAttribute('data-tdone'));
  await c.check();await p.waitForTimeout(300);ok(await E(t=>db.tasks.find(x=>x.id===t).done,tid),'не выполнена');
  await p.locator('#content [data-open]').first().click();await p.waitForTimeout(300);ok(await p.locator('#deal.on').count(),'карточка из задач не открылась');await p.keyboard.press('Escape');
});
await step('Выключенный робот не ставит задачу',async()=>{
  await go("Автоматизация");await p.locator('[data-robot="r_new"]').evaluate(e=>e.click());await p.waitForTimeout(300);
  ok(await E(()=>settings.robots.r_new===false),'не выключился');
  await go("Заявки и воронка");await p.click('[data-act="newlead"]');await p.waitForTimeout(200);
  await p.fill('#mainForm [name=name]','Без Робота');await p.fill('#mainForm [name=phone]','+7 701 000-00-01');await p.click('#mainForm button[type=submit]');await p.waitForTimeout(400);
  eq(await E(()=>{const x=db.leads.find(l=>l.name==='Без Робота');return db.tasks.filter(t=>t.dealId===x.id).length}),0,'задач');
  await p.keyboard.press('Escape');await go("Автоматизация");await p.locator('[data-robot="r_new"]').evaluate(e=>e.click());await p.waitForTimeout(200);
});
await step('Неявка: робот через сутки после пробного',async()=>{
  const r=await E(()=>{const x=db.leads.find(l=>l.stage==='Пробное занятие');x.trial=new Date(Date.now()-2*864e5).toISOString();x.noshowDone=false;runRobots();return {d:x.noshowDone,t:db.tasks.some(t=>t.dealId===x.id&&/Неявка/.test(t.text)&&!t.done)}});
  ok(r.d&&r.t,'сценарий неявки не сработал');
});
await step('Удаление сделки руководителем',async()=>{
  const did=await E(()=>db.leads.find(l=>l.name==='Без Робота').id);
  await go("Заявки и воронка");await p.click(`.lead[data-id="${did}"]`);await p.waitForTimeout(200);await p.click('#deal [data-del]');await p.click('#askYes');await p.waitForTimeout(300);
  ok(!(await E(i=>!!findDeal(i),did)),'не удалена');ok(!(await p.locator('#deal.on').count()),'карточка не закрылась');
});
await step('Данные сохраняются после перезагрузки',async()=>{
  await p.waitForTimeout(800);await p.reload();await p.waitForTimeout(800);
  ok(await E(()=>db.leads.some(x=>x.name==='Тестова Зарина'&&x.stage==='Купили абонемент'&&x.manager==='Айгерим')),'данные потерялись');
});
await step('Старт по ТЗ: 5 тестовых аккаунтов по email, вход с пустым логином не проходит',async()=>{
  await E(()=>logout());await p.waitForTimeout(300);
  eq((await E(()=>users.filter(x=>x.email).map(x=>x.email))).sort().join(','),'admin@djigittau.kz,director@djigittau.kz,manager@djigittau.kz,sales@djigittau.kz,trainer@djigittau.kz','аккаунты');
  await p.fill('#lg_p','');await p.fill('#lg_w','DJigitTest2026!');await p.click('#lgForm button[type=submit]');await p.waitForTimeout(200);
  ok(await p.locator('#login').count(),'вошёл с пустым логином');
});
await step('Руководитель создаёт аккаунт; второго руководителя создать нельзя',async()=>{
  await login(p,0);await go("Команда");
  eq(await p.locator('#nu_role option',{hasText:'Руководитель'}).count(),0,'роль «Руководитель» в списке');
  await p.fill('#nu_name','Бекзат');await p.fill('#nu_phone','+7 705 111 22 33');await p.fill('#nu_pass','12');
  await p.selectOption('#nu_role','Отдел продаж');await p.click('[data-act="adduser"]');await p.waitForTimeout(200);
  ok(!(await E(()=>users.some(x=>x.phone==="77051112233"))),'создан с паролем из 2 символов');
  await p.fill('#nu_pass','bek2026');await p.click('[data-act="adduser"]');await p.waitForTimeout(300);
  eq(await E(()=>users.find(x=>x.phone==="77051112233")?.role),'Отдел продаж','роль');
  await p.click('[data-eduser="77051112233"]');await p.fill('#af_pass','bek2027');await p.locator('.modalbg form').last().locator('button.btn:not(.secondary)').click();await p.waitForTimeout(300);
  eq(await E(()=>users.find(x=>x.phone==="77051112233").pass),'bek2027','новый пароль');
});
await step('Руководитель меняет свой пароль — подсказка на входе исчезает',async()=>{
  await p.click('[data-act="mylogin"]');await p.fill('#af_pass','Boss-777');await p.fill('#af_pass2','Boss-777');
  await p.locator('.modalbg form').last().locator('button.btn:not(.secondary)').click();await p.waitForTimeout(400);
  eq(await E(()=>me.pass),'Boss-777','пароль');
  await E(()=>logout());await p.waitForTimeout(300);
  await p.fill('#lg_p','director@djigittau.kz');await p.fill('#lg_w','Dir-2026!');await p.click('#lgForm button[type=submit]');await p.waitForTimeout(300);
  ok(await p.locator('#login').count(),'вошёл со старым паролем');
});
await step('Сотрудник «Отдел продаж» входит: меню по ТЗ, «Сотрудников» нет',async()=>{
  await p.fill('#lg_p','+7 705 111 22 33');await p.fill('#lg_w','bek2027');await p.click('#lgForm button[type=submit]');await p.waitForTimeout(500);
  eq(await E(()=>me?.name),'Бекзат','вход');
  eq(await p.locator('#nav [data-page="Команда"]').count(),0,'раздел «Сотрудники» виден');
  eq((await p.$$eval('#nav button span:first-of-type',e=>e.map(x=>x.textContent))).join('|'),'Профиль|Смена|Заполнение пробников|Обработка пробников','меню отдела продаж');
});
await step('Мобильная версия: воронка и карточка',async()=>{
  const m=await b.newContext({...devices['iPhone 13']});const mp=await m.newPage();mp.on('pageerror',e=>errs.push('mobile pageerror: '+e.message));
  await mp.goto(URL);await mp.waitForTimeout(400);await mp.evaluate(()=>{const u=users.find(x=>x.role==='Руководитель');delete u.mustChange;enter(u)});await mp.waitForTimeout(400);
  await mp.evaluate(()=>{demoSeed();persist();init();go("Заявки и воронка")});await mp.waitForTimeout(400);
  const ow=await mp.evaluate(()=>document.documentElement.scrollWidth-innerWidth);ok(ow<=1,'горизонтальный скролл страницы: '+ow+'px');
  await mp.screenshot({path:OUT+'/m-pipe.png'});
  await mp.locator('.columns .lead').first().tap();await mp.waitForTimeout(400);
  const box=await mp.locator('#deal').boundingBox();ok(box&&box.width<=391,'карточка шире экрана: '+box?.width);
  await mp.screenshot({path:OUT+'/m-deal.png'});await m.close();
});
await step('Имя для обращения в шаблонах',async()=>{
  const r=await E(()=>["Тестова Зарина","Алиева Сабина","Мурат Нурланов","Пушкин Иван","Амина","Мамедов Самир (брат Амины)","Иванова Мария Петровна","Карина Ильина","Гаджиев Магомед оглы","Тимур"].map(firstName));
  eq(r,["Зарина","Сабина","Мурат","Иван","Амина","Самир","Мария","Карина","Магомед","Тимур"],'имена');
});
console.log(results.map(r=>r.join(' | ')).join('\n'));
console.log('\nERRORS:\n'+[...new Set(errs)].join('\n'));
await b.close()})();
