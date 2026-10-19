from pathlib import Path
import re, json, html
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, KeepTogether, Flowable
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader

BASE=Path(r'C:\Users\Azalytical\OneDrive\Desktop\Hackathon\gdg2026-smartwalk')
DOCS=BASE/'docs'; OUT=BASE/'deliverables'; PREV=OUT/'slide-previews'
INK=colors.HexColor('#153D3B'); TEAL=colors.HexColor('#1D8B82'); PAPER=colors.HexColor('#F3F0E7'); MUTED=colors.HexColor('#52716B'); ORANGE=colors.HexColor('#CF653E')
pdfmetrics.registerFont(TTFont('Segoe',r'C:\Windows\Fonts\segoeui.ttf'))
pdfmetrics.registerFont(TTFont('SegoeB',r'C:\Windows\Fonts\segoeuib.ttf'))
pdfmetrics.registerFontFamily('Segoe',normal='Segoe',bold='SegoeB',italic='Segoe',boldItalic='SegoeB')
STYLE=ParagraphStyle('body',fontName='Segoe',fontSize=10.2,leading=14.6,textColor=INK,spaceAfter=8)
SMALL=ParagraphStyle('small',parent=STYLE,fontSize=8.5,leading=12,textColor=MUTED)
H1=ParagraphStyle('h1',parent=STYLE,fontName='SegoeB',fontSize=27,leading=31,spaceAfter=17)
H2=ParagraphStyle('h2',parent=STYLE,fontName='SegoeB',fontSize=16,leading=21,spaceBefore=11,spaceAfter=9)
TAG=ParagraphStyle('tag',parent=STYLE,fontName='SegoeB',fontSize=9,leading=12,textColor=TEAL,spaceAfter=7)
def norm(t):return t.replace('—','-').replace('–','-').replace('‑','-').replace('·',' / ')
def para(t,style=STYLE):return Paragraph(html.escape(norm(t)).replace('\n','<br/>'),style)
def footer(c,doc):
 w,h=A4;c.saveState();c.setFillColor(PAPER);c.rect(0,0,w,32,fill=1,stroke=0);c.setStrokeColor(colors.HexColor('#CFD8CF'));c.line(42,39,w-42,39);c.setFillColor(MUTED);c.setFont('Segoe',8);c.drawString(42,20,'Ascension  /  Успею вернуться  /  Build with AI 2026');c.drawRightString(w-42,20,str(doc.page));c.restoreState()
def docbuild(file,story,title):
 d=SimpleDocTemplate(str(OUT/file),pagesize=A4,rightMargin=43,leftMargin=43,topMargin=43,bottomMargin=55,title=title,author='Ascension',pageCompression=1);d.build(story,onFirstPage=footer,onLaterPages=footer)
def rule(story,title,sub=None):
 story.append(para('ASCENSION  /  SMART CITY',TAG));story.append(para(title,H1))
 if sub:story.append(para(sub,SMALL))
def addtext(story,text):
 for block in text.strip().split('\n\n'):
  if not block.strip():continue
  if '\n' not in block and len(block)<75 and not block.endswith('.'):
   story.append(para(block,H2))
  else:story.append(para(block))

# PDF copy of the visually reviewed slide renders. PPTX remains editable.
deck_path=OUT/'ascension-smartwalk-presentation.pdf'
c=canvas.Canvas(str(deck_path),pagesize=(960,540),pageCompression=1)
c.setTitle('Успею вернуться - Ascension - Build with AI 2026');c.setAuthor('Ascension')
for i in range(1,10):
 c.drawImage(str(PREV/f'slide-{i:02d}.png'),0,0,width=960,height=540)
 c.showPage()
c.save()

# Test contract: intro, four test spreads, limitations, source notes.
src=(DOCS/'test-scenarios-source.txt').read_text(encoding='utf-8')
parts=re.split(r'\n---\n',src)
story=[];rule(story,'Тестовые сценарии\nи ограничения','Критерии приёмки. Версия 19 октября 2026 года')
intro=parts[0].split('Этот документ',1)[1]
intro='Этот документ'+intro
addtext(story,intro)
scenario_parts=re.split(r'(?=СЦЕНАРИЙ T\d+\.)',parts[1])[1:]
story.append(PageBreak());rule(story,'Состояние прототипа','Подтверждённые сведения основной команды от 19 октября 2026 года')
story.append(para('Данные',H2));story.append(para('После проверки дублей: 930 канонических POI. Все 933 исходных OSM-объекта сохранены в sourceRecords/osmIds/provenance. Исходная выгрузка: 1 480 записей, снимок 19.10.2026 11:22 UTC. Объединены три подтверждённые пары: MEGA, CoffeeStories и Ататюрк. CoffeeLike подтверждён как две разные точки. Неоднозначная пара ШашлычОк оставлена раздельно. Абсолютное отсутствие дублей не заявляется.'))
story.append(para('Выбранные категории: 318 кафе, 176 ресторанов, 34 парка, 8 музеев и 1 именованная площадка. Покрытие демонстрационных зон: EXPO/Mega - 52, левый центр - 226, исторический центр - 256. Это числа записей корпуса, а не посещаемость или полнота покрытия города.'))
story.append(para('Проверки и браузерный результат',H2));story.append(para('Пройдены 23 из 23 автотестов: поиск, API, privacy, лимиты и отбрасывание неподтверждённых утверждений модели. Отображение этих проверок на T01-T12 не предоставлено, поэтому их нельзя считать полным прогоном всех сценариев ниже.'))
story.append(para('Финальный снимок coffee45 с уточнённым входом D MEGA показывает Gasteria и Starbucks примерно по 31 минуте, «Лепим и варим» примерно за 33 минуты. Это альтернативы с возвращением и резервом. Детский сценарий дал один реальный «Сквер», OSM way230358854: 10 минут туда + 15 визит + 10 обратно + 5 резерв = 40 минут в бюджете 60. Время оценивается по расстоянию, без построения пешеходного маршрута. Полные протоколы T01 и T02 остаются незавершёнными.'))
story.append(para('Генерация и публикация',H2));story.append(para('Поиск лексический, без embeddings. Основная команда подтвердила реальный облачный POST с HTTP 200, generation.mode=llm, моделью gpt-4.1-mini и корпусом 930 POI. Режим llm фактически подтверждён в кофейном и детском сценариях. Публичный URL работает без логина. Эти прогоны не являются гарантией безошибочности всех ответов.'))
story.append(Paragraph('Демостраница: <link href="https://ascension-smartwalk-astana.azamatbreach.chatgpt.site" color="#1D8B82">ascension-smartwalk-astana.azamatbreach.chatgpt.site</link>',STYLE))
story.append(Paragraph('Исходный код доступен в публичном репозитории: <link href="https://github.com/Azalytical/ascension-smartwalk" color="#1D8B82">github.com/Azalytical/ascension-smartwalk</link>. Публичная структура с исходниками проверена 19.10.2026.',STYLE))
for start in range(0,len(scenario_parts),3):
 story.append(PageBreak());rule(story,f'Сценарии T{start+1:02d}-T{min(start+3,12):02d}','Полный протокол не завершён. Итоговые Pass не присвоены')
 for block in scenario_parts[start:start+3]:
  chunks=block.strip().split('\n\n');story.append(para(chunks[0].replace('СЦЕНАРИЙ ',''),H2))
  for t in chunks[1:]:
   label,sep,body=t.partition(':')
   if sep and len(label)<30:story.append(Paragraph('<b>'+html.escape(norm(label))+':</b>'+html.escape(norm(body)),STYLE))
   else:story.append(para(t))
story.append(PageBreak());rule(story,'Ограничения и ответственность','Граница обещания продукта')
lim=parts[2].split('Шаблон финального протокола')[0].replace('Ограничения, этика и граница обещания','',1)
addtext(story,lim)
story.append(PageBreak());rule(story,'Протокол и источники')
addtext(story,parts[2].split('Шаблон финального протокола',1)[1])
story.append(para('Основание требований',H2))
story.append(para('Задание Build with AI, задача НИЦ Smart City «ИИ-помощник по прогулкам в городе Астана», страницы 1-3. Примеры мест из задания являются иллюстрацией формата и не подтверждают существование или свойства POI. В продукт их нельзя переносить как факты.'))
story.append(para('Происхождение данных',H2))
story.append(para('Корпус автоматически собран из OpenStreetMap: 930 канонических POI из 933 сохранённых исходных OSM-объектов, raw 1 480. Снимок 19.10.2026 11:22 UTC. Все исходные ссылки и происхождение данных сохранены. Эти сведения не подтверждают полноту городского покрытия, отсутствие всех дублей или актуальность всех полей в реальном времени.'))
story.append(Paragraph('Источник данных: © OpenStreetMap contributors. Данные OSM доступны по ODbL. <link href="https://www.openstreetmap.org/copyright" color="#1D8B82">openstreetmap.org/copyright</link>',STYLE))
story.append(Paragraph('Правила атрибуции: <link href="https://osmfoundation.org/wiki/Attribution_Guidelines" color="#1D8B82">osmfoundation.org/wiki/Attribution_Guidelines</link>',STYLE))
docbuild('ascension-smartwalk-tests-and-limitations.pdf',story,'Успею вернуться - Тестовые сценарии и ограничения')

segments=[
('01 / 0:00-0:35 / Обложка','Здравствуйте! Мы команда Ascension. Наш проект называется «Успею вернуться». Мы делаем городского помощника для коротких прогулок по Астане. Человек сообщает, где он находится, что ему интересно и сколько у него времени. В ответ он должен получить несколько конкретных вариантов и понятный план, в котором есть время на возвращение. Для демонстрации мы ограничили географию Астаной и выбрали районы EXPO, Mega и центра.'),
('02 / 0:35-1:10 / Прогулка между делами','Представим ситуацию: вы у Mega Silk Way и до следующего дела осталось сорок пять минут. Хочется выйти и посмотреть что-то рядом. При выборе приходится одновременно думать о расстоянии, продолжительности визита и дороге обратно. Мы взяли этот сценарий как основную задачу продукта. Он одинаково понятен жителю города, гостю и человеку, который ждёт встречу. Пока это продуктовая гипотеза, а не результат исследования пользователей.'),
('03 / 1:10-1:55 / Бюджет времени','Мы складываем четыре части: дорогу туда, время на месте, обратный путь и резерв. Сумма должна помещаться в доступное окно. Каждый из предложенных вариантов проверяется отдельно. От одного до трёх мест - это альтернативы, а не обещание посетить их все подряд. Пользователь также видит, почему место подходит и что там можно сделать. Все минуты остаются оценкой: переходы, погода и темп ходьбы могут изменить фактическое время.'),
('04 / 1:55-2:45 / RAG','Мы автоматически собрали корпус из OpenStreetMap. После проверки дублей в нём 930 канонических точек интереса. Три подтверждённые пары объединили, при этом сохранили все исходные OSM-объекты и их происхождение. Поиск лексический: система подбирает записи по запросу и локации, затем проверяет ограничения. Найденные записи получает модель OpenAI для объяснения. Реальный облачный ответ модели уже проверен. Факты о месте сохраняют ссылку на источник, а расчёт времени и идея визита обозначаются отдельно.'),
('05 / 2:45-3:30 / Кофе, 45 минут','В первом сценарии мы ищем кофе в окне сорок пять минут с возвращением к точному входу Mega. На финальном подлинном снимке Gasteria и Starbucks укладываются примерно в тридцать одну минуту, «Лепим и варим» - в тридцать три. Это альтернативы, и их расчёты отличаются. Время оценивается по расстоянию, без построения пешеходного маршрута. Это результат расчёта приложения, а не измеренная прогулка. На демо открываем источник и показываем неизвестные поля.'),
('06 / 3:30-4:10 / С ребёнком','Во втором сценарии общее окно составляет шестьдесят минут, а до места должно быть не больше десяти минут пешком. В фактическом результате получился «Сквер» с источником OSM: десять минут туда, пятнадцать на месте, десять обратно и пять резерва. Всего сорок минут из шестидесяти. Облачный режим модели проверен и здесь. Категория парка сама по себе не подтверждает безопасность, возрастную пригодность или наличие пандуса. Эти свойства остаются неизвестными.'),
('07 / 4:10-4:50 / Поздний кофе','Третий сценарий проверяет честность ответа: поздно вечером хочется кафе с розеткой. Если в данных нет подтверждённой розетки и часов работы, уверенная рекомендация создаст ложное ожидание. Поэтому ожидаемый ответ прямо сообщает, что подтверждения нет. Возможные кафе можно показать отдельно с явной оговоркой и предложением проверить условия. Неизвестное поле не превращается в положительный ответ даже ради красивого демо.'),
('08 / 4:50-5:35 / Ограничения и приватность','В инженерной проверке пройдены двадцать три из двадцати трёх автотестов. Они охватывают поиск, API, приватность, лимиты и отбрасывание неподтверждённых утверждений модели. Дополнительно описаны двенадцать сценариев приёмки. Эти два набора нельзя автоматически приравнивать друг к другу. У решения остаются границы: неполные данные и оценочное время. Проверенный облачный вызов не устраняет риск ошибок модели. Для приватности предусматриваем ручной выбор точки и минимизацию хранения, а фактическую передачу и хранение данных проверяем отдельно.'),
('09 / 5:35-6:20 / Развитие','Сначала мы хотим довести три понятных сценария в Астане и проверить каждую рекомендацию. Следующий шаг - улучшить полноту подтверждённых полей и точность пешеходной оценки. Затем можно проверить спрос с кампусами и местами размещения гостей города. Это направления будущего пилота, договорённостей и выручки мы не заявляем. Ценность «Успею вернуться» проста: человек видит подходящее место, конкретное действие и время, оставленное на дорогу обратно. Спасибо!')
]
screencast=[
('0:00-0:15 / Название и старт','«Успею вернуться» - помощник для короткой прогулки по Астане. Покажем три сценария и источники рекомендаций.'),
('0:15-1:00 / Кофе и 45 минут','Выбираем точный вход Mega, задаём кофе, сорок пять минут и возврат к старту. Отправляем запрос. Показываем фактический ответ и расчёт: туда, визит, назад и резерв. Один из примеров бюджета - около 31 минуты, но у другого места или старта время отличается. Открываем источник POI. Показываем именно текущий результат.'),
('1:00-1:35 / С ребёнком','Меняем запрос: с ребёнком, общее окно шестьдесят минут, до места максимум десять минут пешком. Показываем актуальное ограничение и новый результат. Проверяем, что старый расчёт не остался на экране и общий бюджет включает обратную дорогу.'),
('1:35-2:10 / Кофе поздно','Запрашиваем позднее кафе с розеткой. Показываем фактические неизвестные поля и отсутствие необоснованного обещания «открыто». Не заменяем ответ заготовленным успешным примером.'),
('2:10-2:30 / Границы и завершение','Время приблизительное, данные могут быть неполными. Показываем источник, способ оценки и доступный ручной старт. Коротко завершаем: место, план визита и возвращение в одном бюджете.')
]
lines=['УСПЕЮ ВЕРНУТЬСЯ','Сценарий защиты и короткого screencast','Ascension / Build with AI 2026 / Smart City','',
       'Защита: целевой хронометраж 6:20, включая короткие действия в демо. Темп необходимо проверить репетицией. Слайды 1-9.',
       'Данные и автотесты обновлены по подтверждению основной команды 19.10.2026. Публичный URL работает без логина. Реальный облачный POST вернул 200 с generation.mode=llm, gpt-4.1-mini и 930 POI. Для защиты 22.10.2026 статус сверить с финальной сборкой.','']
for title,text in segments:lines.extend([title,text,''])
lines.extend(['КОРОТКИЙ YOUTUBE SCREENCAST','Целевой хронометраж 2:30. Запись только фактического интерфейса и его ответов.',''])
for title,text in screencast:lines.extend([title,text,''])
check='Перед записью скрыть ключи, токены, личные вкладки и точную домашнюю локацию. Использовать публичную демо-точку. Убрать уведомления. Записать фактическую сборку и режим модели. Не вырезать ошибку так, чтобы она выглядела успешным ответом. Проверить звук, читаемость и курсор. После загрузки отдельно проверить доступность YouTube-ссылки для жюри. Загрузку выполняет основная команда.'
lines.extend(['ПЕРЕД РЕПЕТИЦИЕЙ И ЗАПИСЬЮ',check,'',
 'ЗАПАСНОЙ ХОД','Если сайт недоступен, использовать заранее записанный фактический прогон той же сборки, назвав его записью. Если записи нет, показать критерии сценариев на слайдах и честно сообщить об ограничении демонстрации.','',
 'ЧТО НУЖНО ПОДТВЕРДИТЬ','Соответствие 23 автотестов полным сценариям приёмки; фактическую передачу и хранение данных; запись YouTube. Подтверждены 930 канонических POI с сохранением всех 933 OSM-источников, снимок 19.10.2026 11:22 UTC, 23/23 passed автотеста, облачный POST 200 с LLM, подлинный браузерный снимок, доступ к сайту без логина и опубликованный исходный код.'])
(DOCS/'defense-and-screencast.txt').write_text('\n'.join(lines),encoding='utf-8')
story=[];rule(story,'Сценарий защиты','6:20 с короткими действиями в демо. Слайды 1-9')
story.append(para(lines[4],SMALL));story.append(para(lines[5],SMALL))
for i,(title,text) in enumerate(segments):
 if i in (3,6):story.append(PageBreak());rule(story,'Сценарий защиты','Продолжение')
 story.append(KeepTogether([para(title,H2),para(text)]))
story.append(PageBreak());rule(story,'Короткий screencast','YouTube / целевой хронометраж 2:30')
for title,text in screencast:story.append(KeepTogether([para(title,H2),para(text)]))
story.append(para('Подготовка записи',H2));story.append(para(check))
story.append(PageBreak());rule(story,'Памятка перед защитой')
for title,text in [('Запасной ход','Если сайт недоступен, использовать заранее записанный фактический прогон той же сборки, назвав его записью. Если записи нет, показать критерии сценариев на слайдах и честно сообщить об ограничении демонстрации.'),('Что нужно подтвердить',lines[-1])]:story.append(para(title,H2));story.append(para(text))
story.append(para('Правило устного ответа',H2));story.append(para('При вопросе о точности, пользователях или полноте данных отвечать по текущим доказательствам. При отсутствии измерений говорить: «Пока не измеряли, предусмотрели проверку». Техническую роль OpenAI API можно назвать по факту, без заявлений о собственном обучении модели.'))
story.append(para('Основание сценария',H2));story.append(para('Задание Build with AI, Smart City, страницы 1-3, и продуктовый бриф команды от 19 октября 2026 года. В задании защита занимает 5-7 минут. Даты сдачи и защиты заданы командой отдельно.'))
docbuild('ascension-smartwalk-defense-and-screencast.pdf',story,'Успею вернуться - Защита и screencast')

report={}
for f in OUT.glob('*.pdf'):
 r=PdfReader(str(f));report[f.name]={'bytes':f.stat().st_size,'pages':len(r.pages),'text_chars':sum(len(p.extract_text() or '') for p in r.pages)}
(DOCS/'.build/pdf-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
