/**
 * Логика таймеров для часов Amazfit (Zepp OS). Чистый JS без обращений к API часов — поэтому проверяется
 * тестами в Node (tests/core.test.mjs).
 *
 * Таймер занятия работает «равными промежутками»:
 *  - длина промежутка = «ценность 🩸» (60, 45, 30 или 15 минут; хранится на часах, меняется на экране настройки);
 *  - в конце промежутка часы вибрируют, телефону уходит событие «прошла полная ценность», таймер сразу идёт дальше;
 *  - паузы нет, есть только «стоп»: таймер обнуляется (снова равен ценности), а телефону уходит то, сколько
 *    времени успело пройти (в пересчёте на ценность — см. stopOne);
 *  - одновременно идёт только один таймер: запуск другого останавливает прежний (с отправкой пройденного времени).
 * Цветные таймеры на весь экран (обычный тап не делает ничего, досрочный выход — долгим нажатием):
 *  - красный  (k='r') 15 минут — долгое нажатие по центру нижнего ряда;
 *  - зелёный  (k='g') 60 минут — долгое нажатие по центру среднего ряда; по окончании (и при досрочном выходе)
 *    телефону уходит событие «нажатие на 🎁» (один 🎁 превращается в ❤️);
 *  - серый    (k='y') длиной в ценность 🩸 — долгое нажатие по центру верхнего ряда; по окончании из очереди убирается самый левый
 *    🏠 / 🍀 / 🔍, а телефону уходит событие «час такого занятия» (подвал, баллы). Нет такого в очереди — ничего не уходит.
 * Очередь занятий живёт ТОЛЬКО на часах (st.queue, до 12 эмодзи): в конце полного промежутка занятия из очереди убирается самое левое такое
 * занятие (очередь «свободная»). Телефон про очередь ничего не знает — ему уходят только минуты занятий.
 *  По окончании любой цветной таймер сам закрывается (экран возвращается к занятиям), приложение при этом не закрывается.
 * Автостарт очереди (st.auto): запускается занятие, которое стоит в очереди первым; когда его полный промежуток заканчивается
 * (телефону уходит полная ценность 🩸, занятие убирается из очереди), сразу запускается следующее по очереди — и так до конца очереди.
 * 🏠 / 🔍 в очереди (бывают только в случайной очереди) идут серым таймером. Остановка занятия (нажатие на него, запуск другого занятия
 * или цветного таймера, досрочный выход из серого) автостарт выключает. Всё считается по меткам времени, поэтому работает и при погасшем
 * экране / закрытом приложении (будильники — см. nextDue).
 * Тестовый режим (st.test, переключается долгим нажатием на правую кнопку нижнего ряда): все промежутки и все цветные таймеры длятся
 * 20 секунд, а телефону уходит то, как если бы прошла полная ценность (чтобы проверить всю цепочку по-настоящему).
 * Всё считается по меткам времени: если приложение закрывалось, закончившиеся промежутки всё равно засчитаются.
 */
export const MIN = 60 * 1000
export const VALUES = [60, 45, 30, 15]    // варианты ценности 🩸, минут (порядок — как они переключаются по кругу)
export const TEST_LEN = 20 * 1000      // тестовый режим: 20 секунд (не больше трёх границ в минуту — чтобы заодно проверить гипотезу о лимите)
export const RED_LEN = 15 * MIN
export const GREEN_LEN = 60 * MIN
export const FRESH = 20 * 1000            // событие «свежее», если случилось не раньше 20 секунд назад (тогда подаём сигнал)
export const MIN_STOP = 1000              // стоп раньше чем через секунду телефону не отправляем
export const COUNT = 6                    // шесть занятий, порядок как на экране: слева направо, сверху вниз
export const MAX_OUT = 500                // сколько неподтверждённых событий храним
export const QUEUE_MAX = 12               // сколько занятий помещается в очередь
export const QUEUE_RANDOM_LEN = 6         // длина случайной очереди
export const SLOT_LEN = 6                 // длина очереди, которую можно сохранить в ячейку (короткая; длинная — две такие подряд)
export const STATE_V = 6                  // версия сохранённого состояния (6 — новые эмодзи занятий; очередь из прошлых версий сбрасывается)

// эмодзи в порядке картинок i0..i8 / q0..q8 / m0..m8: шесть занятий (как на экране слева направо, сверху вниз:
// 🧬 💀 🩸 / 🤖 🧭 📖), затем 🏠 🍀 🔍
export const EMOJI = ['\u{1F9EC}', '\u{1F480}', '\u{1FA78}', '\u{1F916}', '\u{1F9ED}', '\u{1F4D6}', '\u{1F3E0}', '\u{1F340}', '\u{1F50D}']
const GRAY_ITEMS = [EMOJI[6], EMOJI[8]]   // что убирает из очереди серый таймер: 🏠 и 🔍 (🍀 серый таймер не учитывает, в очередь он не попадает)
// из чего собирается случайная очередь (🍀 в очередь не попадает), у всех равный шанс
export const RANDOM_POOL = [EMOJI[0], EMOJI[1], EMOJI[2], EMOJI[3], EMOJI[4], EMOJI[5], EMOJI[6], EMOJI[8]]

function clamp(x, a, b) { return x < a ? a : (x > b ? b : x) }
function two(n) { return n < 10 ? '0' + n : '' + n }

function cleanVal(v) {
  const n = Math.round(+v)
  return n >= 1 && n <= 600 ? n : 60
}

export function newState(test, val) {
  const run = []
  for (let i = 0; i < COUNT; i++) run.push(0)
  // q.k: '' — нет, 'r' красный, 'g' зелёный, 'y' серый; q.s: 0 — нет, 1 — идёт (закончившийся таймер сразу закрывается); auto — идёт автостарт очереди
  return { v: STATE_V, test: !!test, auto: false, ta: 0, val: cleanVal(val || 60), run: run, q: { k: '', s: 0, run: 0 }, out: [], queue: [] }
}

/** Привести сохранённое состояние к рабочему виду (на случай пустых/старых данных). */
export function restore(text, test, val) {
  const st = newState(!!test, val)
  if (!text) return st
  try {
    const o = JSON.parse(text)
    if (o && o.run && o.run.length >= COUNT) {
      for (let i = 0; i < COUNT; i++) st.run[i] = +o.run[i] || 0
      if (o.val) st.val = cleanVal(o.val)
      st.test = !!o.test          // тестовый режим переживает перезапуск приложения
      st.auto = !!o.auto          // если на самом деле ничего не идёт, process() сам выключит автостарт
      st.ta = +o.ta > 0 ? +o.ta : 0   // когда начался тест (мс): от этого момента считаются номера границ в расписании вибрации теста
      if (o.q && o.q.s === 1) {
        st.q = { k: typeof o.q.k === 'string' && o.q.k ? o.q.k : 'r', s: o.q.s, run: o.q.run || 0 }
      }
      if (o.out && o.out.length !== undefined) {
        // события «новая очередь для телефона» (версия 15) больше не нужны: очередь теперь только на часах
        const keep = []
        for (let k = 0; k < o.out.length; k++) if (o.out[k] && o.out[k].k !== 'qs') keep.push(o.out[k])
        st.out = keep
      }
      st.queue = o.v === STATE_V ? cleanQueue(o.queue) : []   // эмодзи занятий поменялись — старая очередь не годится
    }
  } catch (e) { /* битые данные — начинаем с чистого состояния */ }
  return st
}

/** Следующая ценность по кругу 60 -> 45 -> 30 -> 15 -> 60. */
export function nextVal(v) {
  const k = VALUES.indexOf(v)
  return VALUES[(k + 1) % VALUES.length]
}

/** Ценность 🩸 в миллисекундах: столько «набегает» занятию за полный промежуток. */
export function valueMs(st) { return st.val * MIN }

/** Реальная длина промежутка, мс (в тестовом режиме 20 секунд). */
export function fullMs(st) { return st.test ? TEST_LEN : st.val * MIN }

/** Длина цветного таймера, мс. */
export function ovLen(st) {
  if (st.test) return TEST_LEN
  if (st.q.k === 'g') return GREEN_LEN
  if (st.q.k === 'y') return st.val * MIN
  return RED_LEN
}

export function running(st, i) { return st.run[i] > 0 }

/** Цветной таймер на экране (пока идёт). */
export function overlayActive(st) { return st.q.s !== 0 }

/** Остаток промежутка занятия, мс (может быть ≤ 0, если срабатывание ещё не обработано). */
export function remaining(st, i, now) {
  return st.run[i] > 0 ? fullMs(st) - (now - st.run[i]) : fullMs(st)
}

export function anyRunning(st) {
  for (let i = 0; i < COUNT; i++) if (st.run[i] > 0) return true
  return st.q.s === 1
}

/** Сколько осталось на цветном таймере, мс. */
export function ovLeft(st, now) {
  if (st.q.s !== 1) return 0
  const len = ovLen(st)
  return clamp(len - (now - st.q.run), 0, len)
}

/** Очередь из чего угодно: только известные эмодзи (без 🍀), не больше QUEUE_MAX. */
export function cleanQueue(a) {
  const out = []
  if (!a || a.length === undefined) return out
  for (let k = 0; k < a.length && out.length < QUEUE_MAX; k++) {
    const e = String(a[k])
    if (EMOJI.indexOf(e) >= 0 && e !== EMOJI[7]) out.push(e)
  }
  return out
}

/** Убрать из очереди самый левый элемент из [targets]. Возвращает убранный эмодзи или null. */
export function queueTake(st, targets) {
  for (let k = 0; k < st.queue.length; k++) {
    if (targets.indexOf(st.queue[k]) >= 0) {
      const gone = st.queue[k]
      st.queue.splice(k, 1)
      return gone
    }
  }
  return null
}

/**
 * Случайная очередь из QUEUE_RANDOM_LEN занятий: два одинаковых подряд не бывает, повторы не подряд — бывают.
 * Каждое следующее выбирается поровну из всех, кроме предыдущего. [rnd] — источник случайных чисел [0, 1) (для проверки в тестах).
 */
export function randomQueue(rnd) {
  const f = rnd || Math.random
  const out = []
  while (out.length < QUEUE_RANDOM_LEN) {
    const last = out.length ? out[out.length - 1] : ''
    const alt = []
    for (let k = 0; k < RANDOM_POOL.length; k++) if (RANDOM_POOL[k] !== last) alt.push(RANDOM_POOL[k])
    out.push(alt[Math.min(alt.length - 1, Math.floor(f() * alt.length))])
  }
  return out
}

/**
 * Обработать сработавшее. Возвращает { events, fresh, ovDone, ovFresh, ovKind }.
 * Закончившийся цветной таймер закрывается сам (ovDone = true, ovKind — каким он был).
 * Новые события добавляются и в st.out (очередь на отправку телефону, пока не придёт подтверждение).
 */
export function process(st, now) {
  const events = []
  let fresh = false
  const full = fullMs(st)
  if (st.auto) {
    const a = processAuto(st, now, events)
    return { events: events, fresh: a.fresh, ovDone: a.ovDone, ovFresh: a.ovFresh, ovKind: a.ovKind }
  }
  for (let i = 0; i < COUNT; i++) {
    const s = st.run[i]
    if (s <= 0) continue
    if (now - s < full) continue
    let t = s + full
    let count = 0
    while (t <= now && count < 24) {
      const ev = { id: 'b' + i + '-' + t, k: 'b', i: i, ts: t, ms: valueMs(st), f: 1, x: st.test ? 1 : 0, tried: 0 }
      events.push(ev)
      st.out.push(ev)
      queueTake(st, [EMOJI[i]])   // занятие в очереди выполнено: самое левое такое убирается
      if (now - t <= FRESH) fresh = true
      t += full
      count++
    }
    st.run[i] = count >= 24 ? now : t - full   // новый промежуток начался в момент последнего срабатывания
  }

  let ovDone = false
  let ovFresh = false
  let ovKind = ''
  if (st.q.s === 1) {
    const len = ovLen(st)
    if (now - st.q.run >= len) {
      const at = st.q.run + len
      ovKind = st.q.k
      ovDone = true
      ovFresh = now - at <= FRESH
      if (ovKind === 'y') {
        // серый таймер убирает из очереди самый левый 🏠 / 🔍 (нет такого — очередь не меняется) и шлёт телефону этому занятию ценность 🩸:
        // 🔍 — только если он левее 🏠 в очереди, во всех остальных случаях (🏠 левее, ни одного нет, очередь пуста) — 🏠
        const gi = grayTarget(st)
        queueTake(st, GRAY_ITEMS)
        // как у шести занятий: телефону уходит ценность 🩸 в миллисекундах (valueMs), а не готовый час; час запишется, когда счётчик дойдёт до нуля
        const ev = { id: 'b' + gi + '-y' + at, k: 'b', i: gi, ts: at, ms: valueMs(st), f: 1, x: st.test ? 1 : 0, tried: 0 }
        events.push(ev)
        st.out.push(ev)
      } else if (ovKind === 'g') {
        const ev = { id: 'g-' + at, k: 'g', ts: at, x: st.test ? 1 : 0, tried: 0 }
        events.push(ev)
        st.out.push(ev)
      }
      st.q = { k: '', s: 0, run: 0 }
    }
  }
  if (st.out.length > MAX_OUT) st.out = st.out.slice(st.out.length - MAX_OUT)
  return { events: events, fresh: fresh, ovDone: ovDone, ovFresh: ovFresh, ovKind: ovKind }
}

/** Что идёт сейчас: { a: номер занятия } / { y: true } (серый таймер) / null. Нужно автостарту: одновременно идёт только одно. */
function autoCurrent(st) {
  for (let i = 0; i < COUNT; i++) if (st.run[i] > 0) return { a: i }
  if (st.q.s === 1 && st.q.k === 'y') return { y: true }
  return null
}

/** Запустить с момента [at] то, что стоит в очереди первым: занятие — своим таймером, 🏠 / 🔍 — серым. false — очередь пуста. */
function autoStartHead(st, at) {
  if (!st.queue.length) return false
  const idx = EMOJI.indexOf(st.queue[0])
  if (idx >= 0 && idx < COUNT) st.run[idx] = at
  else st.q = { k: 'y', s: 1, run: at }
  return true
}

/**
 * Автостарт: что закончилось к моменту [now] — засчитывается (событие телефону, занятие убирается из очереди), и сразу с момента
 * окончания запускается следующее из очереди. Закончилась очередь (или ничего не идёт) — автостарт выключается.
 */
function processAuto(st, now, events) {
  const r = { fresh: false, ovDone: false, ovFresh: false, ovKind: '' }
  for (let n = 0; n < 40 && st.auto; n++) {
    const cur = autoCurrent(st)
    if (!cur) { st.auto = false; break }
    let at
    if (cur.a !== undefined) {
      const i = cur.a
      const full = fullMs(st)
      if (now - st.run[i] < full) break
      at = st.run[i] + full
      const ev = { id: 'b' + i + '-' + at, k: 'b', i: i, ts: at, ms: valueMs(st), f: 1, x: st.test ? 1 : 0, tried: 0 }
      events.push(ev)
      st.out.push(ev)
      queueTake(st, [EMOJI[i]])
      st.run[i] = 0
      if (now - at <= FRESH) r.fresh = true
    } else {
      const len = ovLen(st)
      if (now - st.q.run < len) break
      at = st.q.run + len
      const gi = grayTarget(st)
      queueTake(st, GRAY_ITEMS)
      const ev = { id: 'b' + gi + '-y' + at, k: 'b', i: gi, ts: at, ms: valueMs(st), f: 1, x: st.test ? 1 : 0, tried: 0 }
      events.push(ev)
      st.out.push(ev)
      st.q = { k: '', s: 0, run: 0 }
      r.ovDone = true
      r.ovKind = 'y'
      if (now - at <= FRESH) r.ovFresh = true
    }
    if (!autoStartHead(st, at)) st.auto = false
  }
  if (st.out.length > MAX_OUT) st.out = st.out.slice(st.out.length - MAX_OUT)
  return r
}

/** Включить автостарт очереди: запускается то, что стоит в очереди первым. Только когда ничего не идёт и очередь не пуста. */
export function startAuto(st, now) {
  const res = process(st, now)
  if (anyRunning(st) || !st.queue.length) return res
  st.ta = now
  st.auto = true
  autoStartHead(st, now)
  return res
}

/** Включить / выключить тестовый режим (все таймеры по 20 секунд). Только когда ничего не идёт. Возвращает true, если режим поменялся. */
export function toggleTest(st) {
  if (anyRunning(st)) return false
  st.test = !st.test
  return true
}

/** Кому идёт время серого таймера: номер в EMOJI. Самый левый 🏠 / 🔍 в очереди; если таких нет (или очередь пуста) — 🏠. */
export function grayTarget(st) {
  for (let k = 0; k < st.queue.length; k++) {
    if (GRAY_ITEMS.indexOf(st.queue[k]) >= 0) return EMOJI.indexOf(st.queue[k])
  }
  return 6
}

/**
 * Серый таймер остановлен раньше времени: пройденное время (в пересчёте на ценность 🩸, как у обычных занятий) ставится в очередь отправки
 * тому же занятию, что и при полном окончании. Из очереди ничего не убирается (как и у обычных занятий при остановке).
 * Короче секунды телефону не отправляется. Возвращает событие или null; сам таймер не закрывает.
 */
function stopGray(st, now) {
  if (st.q.s !== 1 || st.q.k !== 'y') return null
  const el = now - st.q.run
  if (el < MIN_STOP) return null
  const gi = grayTarget(st)
  const ms = Math.round(el / ovLen(st) * valueMs(st))
  const ev = { id: 'b' + gi + '-ys' + now, k: 'b', i: gi, ts: now, ms: ms, f: 0, x: st.test ? 1 : 0, tried: 0 }
  st.out.push(ev)
  return ev
}

/** Остановить занятие [i]: обнулить и поставить в очередь отправки пройденное время (в пересчёте на ценность). */
function stopOne(st, i, now) {
  const s = st.run[i]
  if (s <= 0) return null
  st.run[i] = 0
  const el = now - s
  if (el < MIN_STOP) return null
  const ms = Math.round(el / fullMs(st) * valueMs(st))
  const ev = { id: 'b' + i + '-s' + now, k: 'b', i: i, ts: now, ms: ms, f: 0, x: st.test ? 1 : 0, tried: 0 }
  st.out.push(ev)
  return ev
}

/** Нажатие на кнопку занятия: запуск / стоп. Запуск останавливает любой другой идущий таймер. */
export function toggle(st, i, now) {
  const res = process(st, now)
  const idle = !anyRunning(st) && st.q.s === 0
  st.auto = false   // остановка занятия (или запуск другого) выключает автостарт
  if (st.run[i] > 0) {
    stopOne(st, i, now)
  } else {
    if (idle) st.ta = now   // начало теста: от этой точки считаются номера границ
    for (let k = 0; k < COUNT; k++) if (k !== i) stopOne(st, k, now)
    stopGray(st, now)   // серый таймер, если он вдруг ещё идёт, закрывается с отправкой пройденного времени
    st.q = { k: '', s: 0, run: 0 }
    st.run[i] = now
  }
  return res
}

/** Запустить цветной таймер ('r' красный, 'g' зелёный, 'y' серый); идущее занятие останавливается. */
export function startOverlay(st, kind, now) {
  const res = process(st, now)
  if (st.q.s !== 0) return res
  if (!anyRunning(st)) st.ta = now   // начало теста: от этой точки считаются номера границ
  st.auto = false
  for (let k = 0; k < COUNT; k++) stopOne(st, k, now)
  st.q = { k: kind, s: 1, run: now }
  return res
}

/** Закрыть цветной таймер, ничего не отправляя. */
export function endOverlay(st) {
  st.q = { k: '', s: 0, run: 0 }
}

/**
 * Досрочный выход из цветного таймера (долгое нажатие). Зелёный и в этом случае шлёт телефону «нажатие на 🎁»;
 * серый — пройденное время занятию (🏠 / 🔍, см. grayTarget); красный — ничего. Возвращает событие или null.
 */
export function exitOverlay(st, now) {
  const res = process(st, now)           // вдруг он уже закончился — тогда событие уже создано (а автостарт мог пойти дальше)
  if (st.q.s !== 1) return { res: res, ev: null }
  st.auto = false
  let ev = null
  if (st.q.s === 1 && st.q.k === 'g') {
    ev = { id: 'g-e' + now, k: 'g', ts: now, x: st.test ? 1 : 0, tried: 0 }
    st.out.push(ev)
  } else {
    ev = stopGray(st, now)
  }
  st.q = { k: '', s: 0, run: 0 }
  return { res: res, ev: ev }
}

/** Подтверждение от телефона: событие больше не нужно отправлять. */
export function ack(st, id) {
  const n = []
  let removed = false
  for (let k = 0; k < st.out.length; k++) {
    if (st.out[k].id === id) removed = true
    else n.push(st.out[k])
  }
  st.out = n
  return removed
}

/** События, которые пора (пере)отправить: прошло не меньше [gap] мс с прошлой попытки. */
export function due(st, now, gap) {
  const r = []
  for (let k = 0; k < st.out.length; k++) {
    if (now - (st.out[k].tried || 0) >= gap) r.push(st.out[k])
  }
  return r
}

/** Метка на кнопке занятия: минуты вверх (до ценности), в тестовом режиме — секунды. */
export function label(st, ms) {
  if (st.test) return '' + clamp(Math.ceil(ms / 1000), 1, Math.round(TEST_LEN / 1000))
  return '' + clamp(Math.ceil(ms / MIN), 1, st.val)
}

/** «мм:сс» (секунды вверх, как у обычного таймера: 15:00 -> 14:59 -> ... -> 00:01 -> 00:00). */
export function clock(ms) {
  const s = Math.ceil(clamp(ms, 0, GREEN_LEN) / 1000)
  return two(Math.floor(s / 60)) + ':' + two(s % 60)
}

/** Сколько ближайших границ занятия заранее ставится службе-будильнику (вибрация). Страница при погасшем экране не оживает (будильник страницы её не будит), поэтому вибрации хватит ровно на столько границ, пока экран не включат. */
export const ALARM_AHEAD = 12
/** В тестовом режиме границы идут через 20 секунд, и окно длиннее — 24 границы (8 минут): чтобы тест не обрывался на середине. */
export const ALARM_AHEAD_TEST = 24
export function aheadFor(st) { return st.test ? ALARM_AHEAD_TEST : ALARM_AHEAD }

/**
 * РАСПИСАНИЕ ВИБРАЦИИ В ТЕСТЕ (диагностика, см. app-service/alarm.js). Служба-будильник срабатывает на КАЖДОЙ границе (как и раньше),
 * а вибрирует ли она на этой границе и как — написано здесь, по одной букве на границу (1-я буква — 1-я граница после начала теста):
 *   A — вибрировать «как было» (start({ mode: STRONG_REMINDER }), серия коротких); B, C, D — прежние запасные способы (см. alarm.js);
 *   . — ТИХО: служба просто срабатывает и пишет строку в журнал, вибромотор не трогает;
 *   c — тихо + проверка часов службы (короткий цикл, в журнал идёт число оборотов и сколько мс он занял).
 * Расписание: 4 вибрации подряд через 20 с (границы 1-4), потом три раза через 60 с (7, 10, 13), потом через 120 с (19) и снова четыре подряд
 * через 20 с (19-22: «после долгого покоя»); границы 5 и 16 — тихие с проверкой часов службы, остальные пропуски — просто тихие. Способ везде один (A), чтобы буква не путалась с временем: в 1.12.0 буквы шли по кругу A B C D,
 * то есть каждый способ приходился на свою фазу 80-секундного круга, и «способ» нельзя было отделить от «момента».
 * Номер границы считается от начала теста (st.ta — момент запуска из состояния «ничего не идёт»), поэтому у одной и той же границы буква
 * всегда одна и та же, как бы ни пересчитывался план. За концом расписания (и если начало теста неизвестно) — A.
 */
export const TEST_PLAN = 'AAAAc.A..A..A..c..AAAA..'
export const METHODS = ['A', 'B', 'C', 'D', '.', 'c']
export function methodFor(st, boundarySec, everySec) {
  if (!st.test || !(everySec > 0) || !(st.ta > 0)) return 'A'
  const k = Math.round((boundarySec * 1000 - st.ta) / (everySec * 1000))   // 1 — первая граница после начала теста
  if (k < 1 || k > TEST_PLAN.length) return 'A'
  return TEST_PLAN.charAt(k - 1)
}

/**
 * План будильников: что должно стоять в системе прямо сейчас. Для каждой ближайшей границы — будильник службы (вибрация, через секунду
 * после границы) и, для самой первой, будильник страницы (через 4 секунды: приложение откроется, посчитает и отправит минуты на телефон).
 * Занятие, которое идёт по кругу, получает службу на [ahead] границ вперёд; автостарт — только на оставшиеся границы очереди;
 * цветной таймер — одну. У каждого будильника свой ключ (вид + граница + сколько границ ещё впереди): страница сравнивает план с уже
 * поставленным и трогает только разницу (так два будильника не встают на одну секунду и не мешают друг другу).
 * Элемент: { key, url, param, at } — at в секундах (UTC).
 */
export function alarmPlan(st, ahead) {
  const out = []
  const every = Math.round(fullMs(st) / 1000)
  const due = nextDue(st)
  for (let k = 0; k < due.length; k++) {
    const d = due[k]
    const sec = Math.round(d.t / 1000)
    let steps = 1
    if (d.kind === 'hour' && every > 0) steps = d.n === undefined ? ahead : Math.min(ahead, d.n + 1)
    for (let j = 0; j < steps; j++) {
      const bs = sec + j * every
      const left = d.n === undefined ? -1 : d.n - j
      out.push({ key: 's' + d.kind + bs + ':' + left, url: 'app-service/alarm', param: d.kind + '|' + bs + '|' + left + '|' + methodFor(st, bs, every), at: bs + 1 })
      if (j === 0) out.push({ key: 'p' + bs, url: 'page/index', param: 'alarm', at: bs + 4 })
    }
  }
  return out
}

/**
 * Сравнить уже поставленные будильники [{ k: ключ, i: номер }] с планом: kept — что оставить, cancel — номера того, что снять (лишнее и
 * старый формат), add — что нужно поставить, keep — ключи оставленного.
 */
export function alarmDiff(old, plan) {
  const want = {}
  for (let k = 0; k < plan.length; k++) want[plan[k].key] = true
  const keep = {}
  const kept = []
  const cancel = []
  const list = Array.isArray(old) ? old : []
  for (let k = 0; k < list.length; k++) {
    const o = list[k]
    if (o && typeof o === 'object' && want[o.k] && !keep[o.k]) { keep[o.k] = true; kept.push(o) }
    else cancel.push(o && typeof o === 'object' ? o.i : o)
  }
  const add = []
  for (let k = 0; k < plan.length; k++) if (!keep[plan[k].key]) add.push(plan[k])
  return { kept: kept, cancel: cancel, add: add, keep: keep }
}

/**
 * Привести будильники в системе к плану: лишние снять, недостающие поставить. api = { set(url, param, delay) -> номер или 0 / исключение,
 * cancel(номер) }. Если система отказала, пробуем на секунду позже (до трёх раз): раньше отказ молча глотался, и вибрация пропадала.
 * Возвращает { next — что теперь стоит [{ k, i }] (его надо сохранить), tok — короткие записи для журнала, plan }.
 */
export function applyAlarms(st, nowMs, old, api) {
  const plan = alarmPlan(st, aheadFor(st))
  const diff = alarmDiff(old, plan)
  for (let k = 0; k < diff.cancel.length; k++) { try { api.cancel(diff.cancel[k]) } catch (e) { /* уже сработал */ } }
  const next = diff.kept.slice()
  const tok = []
  for (let k = 0; k < plan.length; k++) {
    const w = plan[k]
    const tag = w.url === 'page/index' ? 'p' : 's'
    const delay = Math.max(1, Math.ceil(w.at - nowMs / 1000))
    if (diff.keep[w.key]) { tok.push(tag + delay + '='); continue }
    let id = 0
    let tries = 0
    let err = ''
    for (; tries < 4; tries++) {
      try {
        id = api.set(w.url, w.param, delay + tries)
        if (id) break
        err = 'id' + id
      } catch (e) { err = String(e).slice(0, 12) }
    }
    if (id) { next.push({ k: w.key, i: id }); tok.push(tag + (delay + tries) + ':' + id) }
    else tok.push(tag + delay + ':X(' + err + ')')
  }
  return { next: next, tok: tok, plan: plan }
}

/** Моменты, когда что-то закончится (для будильников): [{ t, kind }]. */
export function nextDue(st) {
  const r = []
  const full = fullMs(st)
  if (st.auto) {
    // автостарт: границы стоят через равные промежутки (по одной на каждое занятие в очереди); n — сколько границ после первой
    const cur = autoCurrent(st)
    if (cur) r.push({ t: (cur.a !== undefined ? st.run[cur.a] : st.q.run) + full, kind: 'hour', n: Math.max(0, st.queue.length - 1) })
    return r
  }
  for (let i = 0; i < COUNT; i++) if (st.run[i] > 0) r.push({ t: st.run[i] + full, kind: 'hour' })
  if (st.q.s === 1) r.push({ t: st.q.run + ovLen(st), kind: 'quick' })
  return r
}
