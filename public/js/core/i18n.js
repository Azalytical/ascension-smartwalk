// Interface strings in Russian, Kazakh and English. Missing keys fall back to Russian.
import { get, set, emit } from './store.js';
import kk from './i18n-kk.js';

const ru = {
  'app.tagline': 'Прогулка по Астане, ровно на ваше время.',
  'app.city': 'Астана',
  'tab.walk': 'Прогулка', 'tab.explore': 'Рядом', 'tab.me': 'Моё',
  'greet.morning': 'Доброе утро', 'greet.day': 'Добрый день', 'greet.evening': 'Добрый вечер', 'greet.night': 'Доброй ночи',
  'plan.title': 'Сколько у вас времени?',
  'plan.min': '{n} мин', 'plan.2h': '2 ч',
  'plan.returnBy': 'Вернётесь к {time}',
  'plan.queryLabel': 'Что хочется',
  'plan.queryPlaceholder': 'Кофе, прогулка у воды, музей…',
  'plan.voice': 'Сказать голосом', 'plan.voiceListening': 'Слушаю…', 'plan.voiceUnsupported': 'Этот браузер не поддерживает голосовой ввод.',
  'plan.from': 'Откуда', 'plan.more': 'Ещё настройки', 'plan.maxWalk': 'Пешком до места, не больше',
  'plan.when': 'Когда выходите', 'plan.now': 'Сейчас', 'plan.in1h': 'Через час', 'plan.evening': 'В 19:00',
  'plan.submit': 'Подобрать прогулку', 'plan.ideas': 'Быстрые идеи', 'plan.clear': 'Очистить',
  'mood.coffee': 'Кофе', 'mood.food': 'Поесть', 'mood.park': 'Парк', 'mood.water': 'У воды', 'mood.kids': 'С ребёнком',
  'mood.culture': 'Культура', 'mood.sights': 'Виды и памятники', 'mood.indoor': 'Под крышей',
  'moodQuery.coffee': 'Хочу выпить кофе и немного отдохнуть', 'moodQuery.food': 'Хочу поесть',
  'moodQuery.park': 'Погулять в парке или сквере', 'moodQuery.water': 'Хочу выдохнуть у воды и спокойно пройтись',
  'moodQuery.kids': 'Прогуляться с ребёнком: парк или площадка', 'moodQuery.culture': 'Музей, театр или кино',
  'moodQuery.sights': 'Посмотреть достопримечательности и памятники', 'moodQuery.indoor': 'Место под крышей, в помещении',
  'idea.coffee.title': 'Кофе за 45 минут', 'idea.coffee.sub': 'От Mega Silk Way',
  'idea.kids.title': 'Час с ребёнком', 'idea.kids.sub': 'От Байтерека',
  'idea.water.title': 'Выдохнуть у воды', 'idea.water.sub': 'С набережной Есиля',
  'start.title': 'Откуда начнём?', 'start.gps': 'Моё местоположение', 'start.gpsHint': 'Спросим разрешение один раз',
  'start.pick': 'Выбрать на карте', 'start.pickHint': 'Двигайте карту: старт там, где точка', 'start.pickDone': 'Начать отсюда',
  'start.pickCancel': 'Отмена', 'start.presets': 'Популярные места', 'start.recent': 'Недавние', 'start.picked': 'Точка на карте',
  'start.locating': 'Определяем, где вы…', 'start.denied': 'Доступ к геолокации не разрешён. Выберите точку на карте или из списка.',
  'start.failed': 'Не удалось определить местоположение. Выберите точку вручную.', 'start.outside': 'Вы сейчас не в Астане. Выберите точку в городе.',
  'start.outsidePick': 'Пока работаем только в Астане. Выберите точку в городе.', 'start.change': 'Изменить точку старта',
  'loading.title': 'Подбираем прогулку', 'loading.s1': 'Ищем места рядом', 'loading.s2': 'Считаем дорогу туда и обратно',
  'loading.s3': 'Сверяем часы работы', 'loading.s4': 'ИИ пишет совет',
  'results.back': 'Изменить', 'results.title': 'Варианты на {min} мин', 'results.sub': 'Каждый с возвращением к старту',
  'results.start': 'Старт: {name}', 'results.aiGemini': 'Совет Gemini', 'results.aiMore': 'Подробнее', 'results.aiLess': 'Свернуть', 'results.ai': 'Совет ИИ',
  'results.aiNote': 'ИИ написал это только по карточкам ниже. Время, расстояние и часы работы считает сервер, а не модель.',
  'results.fallback': 'Подобрано по данным мест и вашим условиям. Совет ИИ сейчас недоступен.',
  'results.unchecked': 'Что мы не проверяли', 'results.source': 'Данные OpenStreetMap: {count} мест, снимок {date}',
  'results.empty.title': 'Под это время пока ничего нет', 'results.empty.text': 'Не нашлось места, куда получится сходить и вернуться за выбранное время.',
  'results.empty.add': 'Добавить 15 минут', 'results.empty.walk': 'Идти до 30 минут', 'results.empty.clear': 'Убрать пожелание',
  'error.title': 'Не получилось подобрать', 'error.offline': 'Нет интернета. Ваши настройки сохранены, попробуйте, когда сеть появится.',
  'error.timeout': 'Подбор занял больше минуты. Попробуйте ещё раз.', 'error.server': 'Сервис ответил ошибкой. Попробуйте ещё раз.',
  'error.retry': 'Попробовать снова',
  'place.total': 'всего', 'place.there': 'Туда', 'place.visit': 'На месте', 'place.back': 'Обратно', 'place.reserve': 'Запас',
  'place.returnNow': 'Если выйти сейчас, вернётесь к {time}', 'place.start': 'Начать прогулку', 'place.routeIn': 'Маршрут в',
  'place.why': 'Почему подходит', 'place.todo': 'Чем заняться', 'place.info': 'Сведения', 'place.hours': 'Часы работы',
  'place.phone': 'Телефон', 'place.site': 'Сайт', 'place.wheelchair': 'Доступ для коляски',
  'place.wheelchair.yes': 'Есть', 'place.wheelchair.limited': 'Частично', 'place.wheelchair.no': 'Нет',
  'place.straight': '{d} по прямой', 'place.checks': 'Что известно о месте', 'place.check.osm': 'Место есть в OpenStreetMap',
  'place.check.coords': 'Координаты из источника', 'place.check.hours': 'Часы работы из источника', 'place.check.noHours': 'Часы работы неизвестны',
  'place.check.live': 'Открыто ли прямо сейчас, не проверено', 'place.source': 'Открыть в OpenStreetMap', 'place.snapshot': 'Снимок данных: {date}',
  'place.save': 'Сохранить', 'place.saved': 'Сохранено', 'place.share': 'Поделиться', 'place.watch': 'На часы', 'place.watchText': 'Откройте ссылку на часах: {name}',
  'me.watch': 'Seruen на часах', 'me.watchText': 'Apple Watch и Wear OS: одно касание, и часы ведут вас и напоминают, когда пора обратно.', 'me.watchOpen': 'Открыть',
  'place.estimate': 'Оценка: прямая линия × 1,35 при 4,2 км/ч.', 'place.route': 'Пешеходный маршрут: {d}, около {n} мин в одну сторону',
  'place.walkTo': 'Сходить сюда', 'place.warnings': 'Оговорки',
  'hours.open': 'Открыто до {time}', 'hours.open247': 'Открыто круглосуточно', 'hours.closed': 'Сейчас закрыто',
  'hours.closesEarly': 'Закроется раньше, чем вы закончите', 'hours.unknown': 'Часы указаны, но не разобраны', 'hours.none': 'Часы неизвестны',
  'cat.cafe': 'Кофейня', 'cat.restaurant': 'Еда', 'cat.park': 'Парк', 'cat.playground': 'Детская площадка', 'cat.museum': 'Музей',
  'cat.attraction': 'Достопримечательность', 'cat.mall': 'Торговый центр', 'cat.culture': 'Театр и кино',
  'live.title': 'Прогулка идёт', 'live.finish': 'Завершить', 'live.toReturn': 'до возвращения', 'live.over': 'сверх плана',
  'live.phase.there': 'Идёте туда', 'live.phase.visit': 'На месте', 'live.phase.back': 'Обратно',
  'live.arrived': 'Я на месте', 'live.goBack': 'Иду обратно', 'live.done': 'Я вернулся',
  'live.turnaround': 'Пора возвращаться, чтобы успеть к {time}', 'live.returnBy': 'Вернётесь к {time}',
  'live.thereLeft': 'До места около {n} мин', 'live.visitLeft': 'На месте ещё {n} мин', 'live.backLeft': 'Обратно около {n} мин',
  'live.finished.title': 'Вы вернулись вовремя', 'live.finished.late': 'Вы вернулись на {n} мин позже плана',
  'live.finished.text': 'Прогулка заняла {n} мин, план был {plan} мин.', 'live.close': 'Готово', 'live.screenOn': 'Экран не погаснет, пока идёт прогулка.',
  'live.stopped': 'Прогулка завершена', 'live.undo': 'Вернуть', 'live.resume': 'Вернуться к прогулке',
  'explore.near': 'Рядом с точкой «{name}»', 'explore.search': 'Найти место по названию', 'explore.all': 'Все',
  'explore.openNow': 'Открыто сейчас', 'explore.count': 'Мест: {n}', 'explore.more': 'Показать ещё',
  'explore.empty': 'Ничего не нашлось. Попробуйте другое название или категорию.', 'explore.walk': '{n} мин пешком',
  'explore.loading': 'Загружаем места…', 'explore.failed': 'Не удалось загрузить список мест.',
  'me.saved': 'Избранное', 'me.savedEmpty': 'Отмечайте места сердечком, они появятся здесь.', 'me.history': 'Недавние прогулки',
  'me.historyEmpty': 'Здесь появятся ваши прогулки.', 'me.repeat': 'Повторить', 'me.settings': 'Настройки', 'me.lang': 'Язык',
  'me.theme': 'Тема', 'me.theme.auto': 'Авто', 'me.theme.light': 'Светлая', 'me.theme.dark': 'Тёмная',
  'me.install': 'Установить Seruen', 'me.installText': 'Иконка на главном экране, запуск без браузера, работа без сети.',
  'me.installIos': 'В Safari нажмите «Поделиться», затем «На экран „Домой“».', 'me.installed': 'Seruen установлен на этом устройстве',
  'me.about': 'О Seruen', 'me.privacy': 'Данные и приватность', 'me.data': 'База мест', 'me.dataValue': '{count} мест из OpenStreetMap, снимок {date}',
  'about.p1': 'Seruen помогает выбрать, куда сходить в Астане, когда свободного времени немного: от 30 минут до двух часов.',
  'about.p2': 'Сервер отбирает настоящие места из OpenStreetMap и сам считает дорогу туда, время на месте, обратный путь и запас. ИИ (Gemini) только пишет короткий совет по этим карточкам и не может добавить факты от себя.',
  'about.p3': 'Каждое место показано с источником и оговорками: что известно, а что не проверено.',
  'about.credit': 'Команда Ascension, Build with AI Hackathon 2026, Астана.',
  'privacy.p1': 'Геолокацию мы спрашиваем, только когда вы нажмёте «Моё местоположение». Можно обойтись без неё.',
  'privacy.p2': 'Точка старта и пожелание отправляются на сервер только для подбора этой прогулки и не сохраняются. Пожелание может обработать Gemini; не пишите туда личные данные.',
  'privacy.p3': 'Избранное, история и настройки хранятся только в этом браузере.',
  'privacy.p4': 'Подложку карты загружаем с OpenFreeMap, CARTO или OpenStreetMap, погоду с Open-Meteo, пешеходный маршрут с сервера FOSSGIS. Эти сервисы видят обычные сетевые данные, например IP-адрес.',
  'fab.locate': 'Показать, где я', 'fab.tilt': 'Наклонить карту', 'fab.zoomIn': 'Приблизить', 'fab.zoomOut': 'Отдалить',
  'map.unavailable': 'Карта не загрузилась. Подбор работает и без неё.', 'map.label': 'Карта Астаны',
  'toast.copied': 'Ссылка скопирована', 'toast.saved': 'Добавлено в избранное', 'toast.unsaved': 'Убрано из избранного',
  'toast.offline': 'Нет сети. Сохранённое доступно.', 'toast.online': 'Сеть снова есть', 'toast.locationShared': 'Старт: ваше местоположение',
  'weather.rain': 'Сейчас осадки. Подобрать места под крышей?', 'weather.cold': 'На улице {t}°. Подобрать места под крышей?',
  'weather.wind': 'Сильный ветер. Подобрать места под крышей?', 'weather.yes': 'Под крышу', 'weather.now': 'Сейчас {t}°',
  'sheet.expand': 'Развернуть панель', 'sheet.collapse': 'Свернуть панель',
  'common.back': 'Назад', 'common.close': 'Закрыть', 'common.cancel': 'Отмена',
  'w.minute': 'минута|минуты|минут', 'w.place': 'место|места|мест',
};

const en = {
  'app.tagline': 'A walk in Astana that fits your time.', 'app.city': 'Astana',
  'tab.walk': 'Walk', 'tab.explore': 'Nearby', 'tab.me': 'Me',
  'greet.morning': 'Good morning', 'greet.day': 'Good afternoon', 'greet.evening': 'Good evening', 'greet.night': 'Good night',
  'plan.title': 'How much time do you have?', 'plan.min': '{n} min', 'plan.2h': '2 h', 'plan.returnBy': 'Back by {time}',
  'plan.queryLabel': 'What are you in the mood for', 'plan.queryPlaceholder': 'Coffee, a riverside stroll, a museum…',
  'plan.voice': 'Speak', 'plan.voiceListening': 'Listening…', 'plan.voiceUnsupported': 'This browser does not support voice input.',
  'plan.from': 'From', 'plan.more': 'More options', 'plan.maxWalk': 'Walk to the place, at most',
  'plan.when': 'Leaving', 'plan.now': 'Now', 'plan.in1h': 'In an hour', 'plan.evening': 'At 19:00',
  'plan.submit': 'Find my walk', 'plan.ideas': 'Quick ideas', 'plan.clear': 'Clear',
  'mood.coffee': 'Coffee', 'mood.food': 'Food', 'mood.park': 'Park', 'mood.water': 'Riverside', 'mood.kids': 'With a child',
  'mood.culture': 'Culture', 'mood.sights': 'Sights', 'mood.indoor': 'Indoors',
  'moodQuery.coffee': 'I want a coffee and a short rest', 'moodQuery.food': 'I want to eat',
  'moodQuery.park': 'A walk in a park or a square', 'moodQuery.water': 'A calm stroll by the water',
  'moodQuery.kids': 'A walk with a child: a park or a playground', 'moodQuery.culture': 'A museum, theatre or cinema',
  'moodQuery.sights': 'See landmarks and monuments', 'moodQuery.indoor': 'Somewhere indoors',
  'idea.coffee.title': 'Coffee in 45 minutes', 'idea.coffee.sub': 'From Mega Silk Way', 'idea.kids.title': 'An hour with a child',
  'idea.kids.sub': 'From Baiterek', 'idea.water.title': 'Breathe by the water', 'idea.water.sub': 'From the Yesil embankment',
  'start.title': 'Where do we start?', 'start.gps': 'My location', 'start.gpsHint': 'We ask for permission once',
  'start.pick': 'Pick on the map', 'start.pickHint': 'Move the map: the start is under the dot', 'start.pickDone': 'Start here',
  'start.pickCancel': 'Cancel', 'start.presets': 'Popular places', 'start.recent': 'Recent', 'start.picked': 'Point on the map',
  'start.locating': 'Finding you…', 'start.denied': 'Location access is off. Pick a point on the map or from the list.',
  'start.failed': 'Could not get your location. Pick a point instead.', 'start.outside': 'You are not in Astana right now. Pick a point in the city.',
  'start.outsidePick': 'We only cover Astana for now. Pick a point in the city.', 'start.change': 'Change the starting point',
  'loading.title': 'Finding your walk', 'loading.s1': 'Looking for places nearby', 'loading.s2': 'Counting the way there and back',
  'loading.s3': 'Checking opening hours', 'loading.s4': 'AI is writing a tip',
  'results.back': 'Edit', 'results.title': 'Options for {min} min', 'results.sub': 'Each one brings you back to the start',
  'results.start': 'Start: {name}', 'results.aiGemini': 'Gemini tip', 'results.aiMore': 'Read more', 'results.aiLess': 'Show less', 'results.ai': 'AI tip',
  'results.aiNote': 'The AI wrote this only from the cards below. Time, distance and hours are computed by the server, not the model.',
  'results.fallback': 'Picked from place data and your limits. The AI tip is unavailable right now.',
  'results.unchecked': 'What we did not check', 'results.source': 'OpenStreetMap data: {count} places, snapshot {date}',
  'results.empty.title': 'Nothing fits this time yet', 'results.empty.text': 'No place where you can go and come back within the chosen time.',
  'results.empty.add': 'Add 15 minutes', 'results.empty.walk': 'Walk up to 30 minutes', 'results.empty.clear': 'Drop the wish',
  'error.title': 'Could not find a walk', 'error.offline': 'No internet. Your settings are kept; try again when you are online.',
  'error.timeout': 'It took over a minute. Please try again.', 'error.server': 'The service returned an error. Please try again.', 'error.retry': 'Try again',
  'place.total': 'total', 'place.there': 'There', 'place.visit': 'On site', 'place.back': 'Back', 'place.reserve': 'Reserve',
  'place.returnNow': 'Leave now and you are back by {time}', 'place.start': 'Start the walk', 'place.routeIn': 'Route in',
  'place.why': 'Why it fits', 'place.todo': 'What to do', 'place.info': 'Details', 'place.hours': 'Opening hours', 'place.phone': 'Phone',
  'place.site': 'Website', 'place.wheelchair': 'Wheelchair access', 'place.wheelchair.yes': 'Yes', 'place.wheelchair.limited': 'Limited', 'place.wheelchair.no': 'No',
  'place.straight': '{d} in a straight line', 'place.checks': 'What we know', 'place.check.osm': 'Listed in OpenStreetMap',
  'place.check.coords': 'Coordinates from the source', 'place.check.hours': 'Opening hours from the source', 'place.check.noHours': 'Opening hours unknown',
  'place.check.live': 'Not checked whether it is open right now', 'place.source': 'Open in OpenStreetMap', 'place.snapshot': 'Data snapshot: {date}',
  'place.save': 'Save', 'place.saved': 'Saved', 'place.share': 'Share', 'place.watch': 'To watch', 'place.watchText': 'Open this link on your watch: {name}',
  'me.watch': 'Seruen on your watch', 'me.watchText': 'Apple Watch and Wear OS: one tap and the watch guides you and tells you when to head back.', 'me.watchOpen': 'Open', 'place.estimate': 'Estimate: straight line × 1.35 at 4.2 km/h.',
  'place.route': 'Walking route: {d}, about {n} min one way', 'place.walkTo': 'Go here', 'place.warnings': 'Caveats',
  'hours.open': 'Open until {time}', 'hours.open247': 'Open 24/7', 'hours.closed': 'Closed now', 'hours.closesEarly': 'Closes before you finish',
  'hours.unknown': 'Hours listed but not parsed', 'hours.none': 'Hours unknown',
  'cat.cafe': 'Café', 'cat.restaurant': 'Food', 'cat.park': 'Park', 'cat.playground': 'Playground', 'cat.museum': 'Museum',
  'cat.attraction': 'Landmark', 'cat.mall': 'Mall', 'cat.culture': 'Theatre & cinema',
  'live.title': 'Walk in progress', 'live.finish': 'Finish', 'live.toReturn': 'until you are back', 'live.over': 'over plan',
  'live.phase.there': 'Heading there', 'live.phase.visit': 'On site', 'live.phase.back': 'Heading back',
  'live.arrived': 'I am here', 'live.goBack': 'Heading back', 'live.done': 'I am back',
  'live.turnaround': 'Time to head back to make it by {time}', 'live.returnBy': 'Back by {time}',
  'live.thereLeft': 'About {n} min to the place', 'live.visitLeft': '{n} min left on site', 'live.backLeft': 'About {n} min back',
  'live.finished.title': 'You made it back on time', 'live.finished.late': 'You were back {n} min later than planned',
  'live.finished.text': 'The walk took {n} min; the plan was {plan} min.', 'live.close': 'Done', 'live.screenOn': 'The screen stays on during the walk.',
  'live.stopped': 'Walk finished', 'live.undo': 'Undo', 'live.resume': 'Back to the walk',
  'explore.near': 'Near “{name}”', 'explore.search': 'Search places by name', 'explore.all': 'All', 'explore.openNow': 'Open now',
  'explore.count': 'Places: {n}', 'explore.more': 'Show more', 'explore.empty': 'Nothing found. Try another name or category.',
  'explore.walk': '{n} min walk', 'explore.loading': 'Loading places…', 'explore.failed': 'Could not load places.',
  'me.saved': 'Saved', 'me.savedEmpty': 'Tap the heart on a place to keep it here.', 'me.history': 'Recent walks', 'me.historyEmpty': 'Your walks will appear here.',
  'me.repeat': 'Repeat', 'me.settings': 'Settings', 'me.lang': 'Language', 'me.theme': 'Theme', 'me.theme.auto': 'Auto', 'me.theme.light': 'Light', 'me.theme.dark': 'Dark',
  'me.install': 'Install Seruen', 'me.installText': 'Home screen icon, opens without the browser, works offline.',
  'me.installIos': 'In Safari tap Share, then “Add to Home Screen”.', 'me.installed': 'Seruen is installed on this device',
  'me.about': 'About Seruen', 'me.privacy': 'Data and privacy', 'me.data': 'Places', 'me.dataValue': '{count} places from OpenStreetMap, snapshot {date}',
  'about.p1': 'Seruen helps you choose where to go in Astana when you have a little free time: from 30 minutes to two hours.',
  'about.p2': 'The server picks real places from OpenStreetMap and computes the way there, the time on site, the way back and a reserve. The AI (Gemini) only writes a short tip from those cards and cannot add facts of its own.',
  'about.p3': 'Every place comes with its source and caveats: what is known and what is not checked.',
  'about.credit': 'Team Ascension, Build with AI Hackathon 2026, Astana.',
  'privacy.p1': 'We ask for your location only when you tap “My location”. You can do without it.',
  'privacy.p2': 'The start point and your wish are sent to the server only to find this walk and are not stored. Gemini may process the wish; do not include personal data.',
  'privacy.p3': 'Saved places, history and settings stay in this browser only.',
  'privacy.p4': 'Map tiles come from OpenFreeMap, CARTO or OpenStreetMap, weather from Open-Meteo, walking routes from FOSSGIS. These services see ordinary network data such as your IP address.',
  'fab.locate': 'Show where I am', 'fab.tilt': 'Tilt the map', 'fab.zoomIn': 'Zoom in', 'fab.zoomOut': 'Zoom out',
  'map.unavailable': 'The map did not load. Walk suggestions still work.', 'map.label': 'Map of Astana',
  'toast.copied': 'Link copied', 'toast.saved': 'Added to saved', 'toast.unsaved': 'Removed from saved', 'toast.offline': 'Offline. Saved items are available.',
  'toast.online': 'Back online', 'toast.locationShared': 'Start: your location',
  'weather.rain': 'It is raining or snowing. Find places indoors?', 'weather.cold': 'It is {t}° outside. Find places indoors?',
  'weather.wind': 'Strong wind. Find places indoors?', 'weather.yes': 'Indoors', 'weather.now': 'Now {t}°',
  'sheet.expand': 'Expand panel', 'sheet.collapse': 'Collapse panel', 'common.back': 'Back', 'common.close': 'Close', 'common.cancel': 'Cancel',
  'w.minute': 'minute|minutes', 'w.place': 'place|places',
};

const dictionaries = { ru, kk, en };
export const LANGS = [['ru', 'RU'], ['kk', 'ҚАЗ'], ['en', 'EN']];
const locales = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' };

function detect() {
  const saved = get('lang');
  if (saved && dictionaries[saved]) return saved;
  const browser = (navigator.language || 'ru').slice(0, 2).toLowerCase();
  return browser === 'kk' ? 'kk' : browser === 'en' ? 'en' : 'ru';
}
let current = detect();

export const lang = () => current;
export const locale = () => locales[current];

export function t(key, params = {}) {
  const text = dictionaries[current][key] ?? ru[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => (params[name] ?? `{${name}}`));
}

/** Pick a localized value from a { ru, kk, en } object. */
export const pick = (value) => (value && typeof value === 'object' ? value[current] ?? value.ru : value);

export function plural(n, key) {
  const forms = t(key).split('|');
  if (current === 'en') return n === 1 ? forms[0] : forms[1] ?? forms[0];
  if (current === 'kk') return forms[0];
  const rule = new Intl.PluralRules('ru-RU').select(n);
  return rule === 'one' ? forms[0] : rule === 'few' ? forms[1] : forms[2] ?? forms[1];
}

// Astana is on UTC+5 all year; shifting by hand avoids browsers with outdated time zone data.
const astana = (value) => new Date(new Date(value).getTime() + 5 * 3600000);
export const time = (value) => {
  const shifted = astana(value);
  return `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;
};
export const date = (value) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(astana(parsed));
};
export const number = (n) => new Intl.NumberFormat(locale()).format(n);

export function setLang(next) {
  if (!dictionaries[next] || next === current) return;
  current = next;
  set('lang', next);
  document.documentElement.lang = next;
  emit('lang', next);
}
document.documentElement.lang = current;
