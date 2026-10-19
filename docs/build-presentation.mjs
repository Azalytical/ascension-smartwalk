import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = 'C:/Users/Azalytical/OneDrive/Desktop/Hackathon/gdg2026-smartwalk';
const SKILL = 'C:/Users/Azalytical/.codex/plugins/cache/openai-primary-runtime/presentations/26.1017.11052/skills/presentations';
const RUNTIME = 'C:/Users/Azalytical/.cache/codex-runtimes/codex-primary-runtime/dependencies';
process.env.RUNTIME_NODE_MODULES=path.join(RUNTIME,'node/node_modules');
process.env.RUNTIME_NODE=path.join(RUNTIME,'node/bin/node.exe');
process.env.RUNTIME_PYTHON=path.join(RUNTIME,'python/python.exe');
const BUILD = path.join(BASE, 'docs/.build');
const OUT = path.join(BASE, 'deliverables');
const PREV = path.join(OUT, 'slide-previews');
await fs.mkdir(BUILD,{recursive:true});
await fs.mkdir(PREV,{recursive:true});
const {Presentation,PresentationFile} = await import(pathToFileURL(path.join(RUNTIME,'node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs')).href).catch(async()=>await import(pathToFileURL(path.join(RUNTIME,'node/node_modules/@oai/artifact-tool/dist/index.js')).href));
const C = {paper:'#F3F0E7',ink:'#153D3B',teal:'#1D8B82',mint:'#CDE4DB',line:'#CFD8CF',muted:'#52716B',orange:'#CF653E',white:'#FFFFFF',pale:'#E6ECE3'};
const FONT='Segoe UI';
const W=1280,H=720;
const p=Presentation.create({slideSize:{width:W,height:H}});
const notes=[];
function shape(s,g,x,y,w,h,fill,stroke='none',sw=0,name=''){return s.shapes.add({geometry:g,name,position:{left:x,top:y,width:w,height:h},fill,line:{style:'solid',fill:stroke,width:sw}});}
function txt(s,t,x,y,w,h,size=24,opts={}){const a=shape(s,'textbox',x,y,w,h,'none','none',0,opts.name||t.slice(0,35));a.text=t;a.text.style={fontSize:size,typeface:FONT,color:opts.color||C.ink,bold:!!opts.bold,italic:!!opts.italic,alignment:opts.align||'left',verticalAlignment:'top',insets:0,autoFit:'none',wrap:'square',lineSpacing:1.05};return a;}
function rect(s,x,y,w,h,c){return shape(s,'rect',x,y,w,h,c);}
function line(s,x,y,w,h,c=C.line,sw=2){const ww=Math.max(Math.abs(w),0.1),hh=Math.max(Math.abs(h),0.1);return s.shapes.add({geometry:'custom',position:{left:Math.min(x,x+w),top:Math.min(y,y+h),width:ww,height:hh},fill:'none',line:{style:'solid',fill:c,width:sw},customPaths:[{width:ww,height:hh,commands:[{moveTo:{x:w<0?ww:0,y:h<0?hh:0}},{lineTo:{x:w<0?0:ww,y:h<0?0:hh}}]}]});}
function circle(s,x,y,r,c,stroke='none',sw=0){return shape(s,'ellipse',x-r,y-r,r*2,r*2,c,stroke,sw);}
function map(s,x,y,w,h,dark=false){
  const col=dark?'#2F615C':C.line;
  for(let i=0;i<7;i++)line(s,x+i*w/6,y,0,h,col,1);
  for(let j=0;j<6;j++)line(s,x,y+j*h/5,w,0,col,1);
  const roads=[[0,.27,1,.67],[.12,0,.42,1],[0,.85,1,.17],[.73,0,.8,1]];
  for(const [a,b,c,d] of roads)line(s,x+a*w,y+b*h,(c-a)*w,(d-b)*h,dark?'#44756E':'#DADDD1',12);
}
function route(s,x,y,scale=1,dark=false){
  const pts=[[0,90],[80,90],[80,0],[230,0],[230,150],[130,150],[130,90],[0,90]].map(([a,b])=>[x+a*scale,y+b*scale]);
  for(let i=1;i<pts.length;i++)line(s,pts[i-1][0],pts[i-1][1],pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1],dark?C.mint:C.teal,6);
  circle(s,pts[0][0],pts[0][1],11,dark?C.paper:C.ink);
  circle(s,pts[3][0],pts[3][1],11,C.orange);
  circle(s,pts[4][0],pts[4][1],9,dark?C.paper:C.teal);
}
function base(n,title,subtitle='',dark=false){const s=p.slides.add();s.background.fill=dark?C.ink:C.paper;
  if(n!==1){txt(s,title,64,52,1152,100,46,{bold:true,color:dark?C.paper:C.ink});if(subtitle)txt(s,subtitle,64,158,1152,66,24,{color:dark?C.mint:C.muted});}
  line(s,64,661,1152,0,dark?'#38635D':C.line,1);
  txt(s,'ASCENSION',64,677,250,22,14,{bold:true,color:dark?C.mint:C.muted});
  txt(s,String(n).padStart(2,'0'),1154,674,62,28,18,{align:'right',color:dark?C.mint:C.muted});
  return s;}
function note(s,text){s.speakerNotes.text=text;notes.push(text);}

// 01
{
 const s=base(1,'');
 map(s,690,0,590,661);
 rect(s,0,0,660,660,C.paper);
 txt(s,'Build with AI 2026',64,55,600,28,21,{color:C.muted});
 txt(s,'Успею\nвернуться',60,146,650,250,88,{bold:true});
 txt(s,'Городская прогулка\nв вашем окне времени',64,438,580,100,34);
 txt(s,'Астана   /   Smart City',64,577,580,35,23,{color:C.muted});
 route(s,770,245,1.65);
 circle(s,1150,110,57,C.teal);line(s,1137,87,34,0,C.paper,5);line(s,1171,87,0,40,C.paper,5);line(s,1171,127,-44,0,C.paper,5);line(s,1127,127,11,-11,C.paper,5);line(s,1127,127,11,11,C.paper,5);
 txt(s,'Место. Визит. Возвращение.',742,558,480,63,28,{bold:true});
 txt(s,'Схематическая иллюстрация',742,610,480,25,16,{color:C.muted});
 note(s,'0:00-0:35. Команда Ascension. Концепция: короткие прогулки в Астане с учётом возвращения. Источник требований: hackathon-tasks.pdf, задача НИЦ Smart City, страницы 1-3. Дедлайны взяты из брифа команды, в самом PDF не указаны. Карта декоративная, не географический маршрут.');
}
// 02
{
 const s=base(2,'Прогулка между делами','Человек выбирает место и одновременно считает, успеет ли вернуться');
 txt(s,'45',57,247,390,195,158,{bold:true,color:C.teal});txt(s,'минут до следующего дела',64,453,385,78,29,{bold:true});
 const rows=[['Где я','У Mega Silk Way'],['Чего хочу','Прогуляться рядом'],['Что ограничивает','Вернуться к исходной точке']];
 rows.forEach((r,i)=>{let y=251+i*112;txt(s,r[0],535,y,240,28,20,{color:C.muted});txt(s,r[1],535,y+35,655,55,31,{bold:true});if(i<2)line(s,535,y+93,650,0);});
 txt(s,'Сценарий, заданный командой. Это не статистика пользователей.',64,603,1120,28,17,{color:C.muted});
 note(s,'0:35-1:10. Это конкретный пользовательский сценарий: 45 минут рядом с Mega, начало и возврат в одной точке. Не заявлять исследования рынка, метрики пользователей или подтверждённый спрос. Целевая аудитория: жители и гости города, у которых есть короткое свободное окно между делами.');
}
// 03
{
 const s=base(3,'Весь маршрут в одном бюджете','Правило продукта: время на возвращение входит в рекомендацию');
 const labels=['Дорога туда','Визит','Обратный путь','Резерв'];const widths=[260,320,260,248],cols=[C.teal,C.mint,C.teal,C.orange];let x=64;
 labels.forEach((a,i)=>{rect(s,x,280,widths[i],70,cols[i]);txt(s,a,x,373,widths[i]-18,56,26,{bold:true});x+=widths[i]+16;});
 txt(s,'Сумма ≤ доступное время',64,469,1100,70,48,{bold:true});
 txt(s,'1–3 альтернативы с объяснением, действием и источником.\nОценка времени зависит от допущений и не гарантирует прибытие.',64,562,1100,72,25,{color:C.muted});
 note(s,'1:10-1:55. Контракт: туда + визит + назад + резерв не превышают доступное окно. Каждый вариант считается отдельно. 1-3 варианта являются альтернативами, а не автоматическим маршрутом через все места. Время является оценкой, а не гарантией. Метод маршрутизации и допущения должны соответствовать фактической реализации. Числа на этом слайде отсутствуют намеренно: нет измеренного маршрута.');
}
// 04
{
 const s=base(4,'Совет из городских данных','Проектная схема RAG: поиск, проверка ограничений, объяснение');
 const steps=[['01','OSM','Автоматический сбор\nточек интереса Астаны'],['02','Поиск','Релевантные места\nпо запросу и локации'],['03','Ограничения','Время, возврат,\nкатегории и часы'],['04','Ответ','1–3 варианта\nс источниками']];
 steps.forEach((a,i)=>{const x=64+i*294;txt(s,a[0],x,265,260,60,45,{color:C.teal,bold:true});line(s,x,336,260,0,C.teal,3);txt(s,a[1],x,366,264,57,32,{bold:true});txt(s,a[2],x,440,264,100,24,{color:C.muted});});
 txt(s,'Факты POI сохраняют источник. Модель объясняет найденные варианты.\nНет данных о розетке или часах? Ответ сохраняет «неизвестно».',64,562,1130,74,25);
 note(s,'1:55-2:45. RAG означает получение подходящих записей из базы и использование этих записей при формировании ответа. Архитектурный замысел, пока интеграция продолжается: автоматический OSM-сбор, поиск кандидатов, проверка ограничений, объяснение с помощью OpenAI API. Не заявлять embeddings, reranker, размер базы или успешный API-вызов без подтверждения команды. Источник данных по плану: https://www.openstreetmap.org/copyright. Правила атрибуции: https://osmfoundation.org/wiki/Attribution_Guidelines.');
}
// 05
{
 const s=base(5,'45 минут у Mega Silk Way','Демонстрационный сценарий 1');
 rect(s,64,254,545,254,C.mint);
 txt(s,'«Я у Mega. У меня всего\n45 минут, включая\nвозвращение сюда»',90,283,492,174,35,{bold:true});
 txt(s,'Что проверяем',677,254,490,45,29,{bold:true});
 const a=['Место из базы с исходной ссылкой','Весь бюджет, включая возврат','Почему подходит и что делать там'];a.forEach((t,i)=>{circle(s,688,334+i*76,6,C.teal);txt(s,t,712,312+i*76,484,62,26);});
 txt(s,'Если подходящего варианта нет, система объясняет причину\nи предлагает изменить время или ограничения.',64,553,1120,78,29,{color:C.muted});
 note(s,'2:45-3:30. На живом демо выбрать точку Mega и 45 минут, затем показать конкретную карточку, ссылку на POI и бюджет. Этот слайд содержит вход и критерии, а не снимок работающего продукта. Если сайт недоступен, показать запись фактического прогона. Не выдавать иллюстрацию за runtime.');
}
// 06
{
 const s=base(6,'С ребёнком, не дальше 10 минут','Демонстрационный сценарий 2');
 txt(s,'10',57,254,420,195,150,{bold:true,color:C.teal});
 txt(s,'минут пешком до места',64,446,435,70,29,{bold:true});
 const r=[['Жёсткое условие','Каждый кандидат укладывается\nв заданное время до места'],['Общий бюджет','Визит, возврат и резерв\nтоже должны поместиться'],['Неизвестные свойства','Возраст, доступность и удобства\nнельзя придумывать']];
 r.forEach((a,i)=>{const y=252+i*121;txt(s,a[0],571,y,620,32,20,{color:C.muted});txt(s,a[1],571,y+38,620,75,27,{bold:i===0});});
 note(s,'3:30-4:10. Условие не более 10 минут относится к пути до места и применяется до генерации объяснения. Полный бюджет остаётся ограничен доступным окном. Категория площадки или музея не подтверждает возрастную пригодность, наличие пандуса или состояние оборудования. Это следует показывать как неизвестное, если нет источника.');
}
// 07
{
 const s=base(7,'Кофе поздно. Розетка неизвестна','Демонстрационный сценарий 3',true);
 txt(s,'Запрос',64,254,350,40,23,{color:C.mint});
 txt(s,'«Кафе с розеткой\nпоздно вечером, рядом»',64,310,510,144,37,{bold:true,color:C.paper});
 line(s,620,254,0,333,'#527C72',2);
 txt(s,'Честный тип ответа',676,254,530,38,23,{color:C.mint});
 txt(s,'«Нет подтверждённых вариантов\nс розеткой. Наличие розетки\nи часы нужно проверить»',676,311,530,183,33,{bold:true,color:C.paper});
 txt(s,'Отсутствующий тег сохраняет статус «неизвестно».\nСистема не обещает «открыто сейчас» без данных.',64,559,1120,77,27,{color:C.mint});
 note(s,'4:10-4:50. Показать запрос с поздним временем и требованием розетки. Ожидаемая демонстрация: missing tag не превращается в yes, отсутствие hours не превращается в открыто. Даже известное расписание является записью источника, а не подтверждением в реальном времени. Текст на слайде является ожидаемым типом ответа и не цитирует выполненный запрос.');
}
// 08
{
 const s=base(8,'Границы доверия','Проектные требования к данным, времени и приватности');
 const v=[['Данные','OSM может быть неполным\nили устаревшим','Источник и неизвестные\nполя рядом с советом'],['Время','Погода, переходы и темп\nменяют длительность','Допущения, резерв\nи понятный отказ'],['Локация','Координаты раскрывают\nместоположение','Ручной выбор точки\nи минимум хранения']];
 v.forEach((a,i)=>{let x=64+i*392;txt(s,a[0],x,264,352,50,34,{bold:true});line(s,x,333,348,0,C.teal,3);txt(s,a[1],x,365,352,105,27);txt(s,a[2],x,507,352,95,26,{color:C.teal,bold:true});});
 note(s,'4:50-5:35. Это обязательства проекта и предмет приёмки, не аудиторское подтверждение реализованной privacy-политики. Не обещать отсутствие логирования или передачу только округлённых координат без проверки. Точные запросы к модели и политика хранения должны соответствовать реализации. В приложенном документе описаны проверки источников, пустой выдачи, географии, пропусков данных, ограничений и приватности.');
}
// 09
{
 const s=base(9,'Сначала Астана и короткие прогулки','Ценность продукта: понятный выбор внутри реального окна времени');
 txt(s,'Для кого',64,257,335,40,23,{color:C.muted});txt(s,'Жители и гости города\nмежду делами',64,315,500,114,35,{bold:true});
 txt(s,'Первая география',64,489,380,35,23,{color:C.muted});txt(s,'EXPO, Mega и центр Астаны',64,542,520,76,30,{bold:true});
 const a=[['Демо','Три сценария и проверка\nкаждой рекомендации'],['Качество','Больше проверенных полей\nи точнее пешеходный путь'],['Пилот','Проверка спроса с кампусами\nи местами размещения гостей']];
 a.forEach((z,i)=>{let y=252+i*122;circle(s,662,y+17,8,i===0?C.orange:C.teal);txt(s,z[0],696,y-7,485,36,23,{color:C.teal,bold:true});txt(s,z[1],696,y+36,495,75,28);});
 note(s,'5:35-6:20. Бизнес-гипотеза: полезный сервис для жителей и гостей с коротким свободным окном. Возможные партнёры для будущей проверки спроса: кампусы и места размещения гостей, а не заключённые партнёрства. Последовательность: завершить демо и проверки, улучшить качество полей и времени пути, провести пилот. Не заявлять выручку, пользователей, экономию или доказанное соответствие реальной длительности маршрута. Финал: человек получает место, понятный план и время на возвращение.');
}
await fs.writeFile(path.join(BUILD,'deck-proto.json'),JSON.stringify(p.toProto()));
for(let i=0;i<p.slides.items.length;i++){
 const s=p.slides.items[i];
 await fs.writeFile(path.join(PREV,`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await (await p.export({slide:s,format:'png',scale:1})).arrayBuffer()));
 await fs.writeFile(path.join(BUILD,`slide-${i+1}.layout.json`),await (await s.export({format:'layout'})).text());
 console.log(`Rendered ${i+1}`);
}
await fs.writeFile(path.join(PREV,'overview.webp'),new Uint8Array(await (await p.export({format:'webp',montage:true})).arrayBuffer()));
const candidate=path.join(BUILD,'candidate.pptx');
await (await PresentationFile.exportPptx(p)).save(candidate);
const {finalizePresentation}=await import(pathToFileURL(path.join(SKILL,'container_tools/artifact_tool_utils.mjs')).href);
const revision=process.env.SMARTWALK_REVISION || '';
const finalPath=path.join(OUT,`ascension-smartwalk-presentation${revision?'-'+revision:''}.pptx`);
const result=await finalizePresentation({workspaceDir:BASE,candidatePath:candidate,finalPath,pythonExecutable:path.join(RUNTIME,'python/python.exe'),integrityValidatorPath:path.join(SKILL,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(SKILL,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit'],explicitTotalSlideCount:9,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'design',families:[FONT]},verifyArtifactToolImport:true,receiptPath:path.join(BUILD,`presentation${revision?'-'+revision:''}.validation.json`)});
console.log(JSON.stringify(result));
