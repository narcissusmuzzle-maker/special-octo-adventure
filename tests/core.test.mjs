import assert from 'node:assert'
import * as core from '../shared/core.js'

const T = 1000000   // run=0 означает «не идёт», поэтому время в тестах начинаем не с нуля
const M = 60000
let n = 0
function t(name, f) { f(); n++; console.log('ok  ' + name) }

t('шесть занятий, ценность по умолчанию 60', () => {
  assert.equal(core.COUNT, 6)
  assert.equal(core.newState(false).val, 60)
})

t('ценность переключается по кругу 60 -> 45 -> 30 -> 15 -> 60', () => {
  assert.equal(core.nextVal(60), 45)
  assert.equal(core.nextVal(45), 30)
  assert.equal(core.nextVal(30), 15)
  assert.equal(core.nextVal(15), 60)   // круг 60 -> 45 -> 30 -> 15 -> 60
  assert.equal(core.nextVal(77), 60)   // неизвестное значение — начинаем с начала списка
})

t('промежуток = ценность: событие через 30 минут, вибрация, отсчёт идёт дальше', () => {
  const st = core.newState(false, 30)
  core.toggle(st, 0, T)
  assert.equal(core.label(st, core.remaining(st, 0, T)), '30')
  assert.equal(core.process(st, T + 29 * M).events.length, 0)
  const r = core.process(st, T + 30 * M)
  assert.equal(r.events.length, 1)
  assert.equal(r.fresh, true)
  const ev = r.events[0]
  assert.equal(ev.k, 'b'); assert.equal(ev.f, 1); assert.equal(ev.ms, 30 * M)
  assert.equal(ev.id, 'b0-' + (T + 30 * M))
  assert.equal(core.running(st, 0), true)
  assert.equal(core.remaining(st, 0, T + 30 * M), 30 * M)   // сразу пошёл следующий промежуток
})

t('экран был выключен: пропущенные промежутки засчитываются с настоящим временем', () => {
  const st = core.newState(false, 45)
  core.toggle(st, 2, T)
  const r = core.process(st, T + 100 * M)           // прошло 2 промежутка и ещё 10 минут
  assert.equal(r.events.length, 2)
  assert.equal(r.events[1].ts, T + 90 * M)
  assert.equal(r.fresh, false)                      // давно — не вибрируем
  assert.equal(core.remaining(st, 2, T + 100 * M), 35 * M)
})

t('стоп: таймер обнуляется, на телефон уходит пройденное время', () => {
  const st = core.newState(false, 60)
  core.toggle(st, 1, T)
  core.toggle(st, 1, T + 20 * M)                    // нажали ещё раз — стоп
  assert.equal(core.running(st, 1), false)
  assert.equal(st.out.length, 1)
  assert.equal(st.out[0].ms, 20 * M)
  assert.equal(st.out[0].f, 0)
  assert.equal(core.label(st, core.remaining(st, 1, T + 21 * M)), '60')   // снова равен ценности
})

t('стоп раньше секунды ничего не отправляет', () => {
  const st = core.newState(false)
  core.toggle(st, 1, T)
  core.toggle(st, 1, T + 500)
  assert.equal(st.out.length, 0)
})

t('запуск другого занятия останавливает прежнее и отправляет пройденное', () => {
  const st = core.newState(false, 60)
  core.toggle(st, 0, T)
  core.toggle(st, 4, T + 12 * M)
  assert.equal(core.running(st, 0), false)
  assert.equal(core.running(st, 4), true)
  assert.equal(st.out.length, 1)
  assert.equal(st.out[0].i, 0)
  assert.equal(st.out[0].ms, 12 * M)
})

t('стоп сначала учитывает завершившийся промежуток', () => {
  const st = core.newState(false, 30)
  core.toggle(st, 3, T)
  core.toggle(st, 3, T + 40 * M)                    // 30 минут уже прошло, 10 — следующего
  assert.equal(st.out.length, 2)
  assert.equal(st.out[0].f, 1)
  assert.equal(st.out[1].ms, 10 * M)
})

t('тест: промежуток 20 секунд, но телефону уходит полная ценность', () => {
  const st = core.newState(true, 45)
  core.toggle(st, 2, T)
  assert.equal(core.label(st, core.remaining(st, 2, T)), '20')
  assert.equal(core.label(st, core.remaining(st, 2, T + 4200)), '16')
  const r = core.process(st, T + 20000)
  assert.equal(r.events.length, 1)
  assert.equal(r.events[0].ms, 45 * M)
  assert.equal(r.events[0].x, 1)
  // стоп на половине теста — половина ценности
  core.toggle(st, 2, T + 30000)
  assert.equal(st.out[st.out.length - 1].ms, Math.round(22.5 * M))
})

t('красный 15:00, зелёный 60:00, серый = ценность', () => {
  const st = core.newState(false, 30)
  core.startOverlay(st, 'r', T)
  assert.equal(core.clock(core.ovLeft(st, T)), '15:00')
  assert.equal(core.nextDue(st)[0].t, T + 15 * M)
  core.endOverlay(st)
  core.startOverlay(st, 'g', T)
  assert.equal(core.clock(core.ovLeft(st, T)), '60:00')
  core.endOverlay(st)
  core.startOverlay(st, 'y', T)
  assert.equal(core.clock(core.ovLeft(st, T)), '30:00')
  assert.equal(core.clock(core.ovLeft(st, T + 5000)), '29:55')
})

t('тест: все цветные таймеры по 20 секунд', () => {
  for (const k of ['r', 'g', 'y']) {
    const st = core.newState(true, 60)
    core.startOverlay(st, k, T)
    assert.equal(core.clock(core.ovLeft(st, T)), '00:20')
  }
})

t('красный по окончании событий не шлёт и сам закрывается', () => {
  const st = core.newState(false)
  core.startOverlay(st, 'r', T)
  const r = core.process(st, T + 15 * M)
  assert.equal(r.ovDone, true)
  assert.equal(r.ovFresh, true)
  assert.equal(r.ovKind, 'r')
  assert.equal(st.out.length, 0)
  assert.equal(core.anyRunning(st), false)
  assert.equal(core.overlayActive(st), false)       // экран закрылся сам, 00:00 не остаётся
  assert.equal(core.process(st, T + 16 * M).ovDone, false)   // и второй раз не срабатывает
})

t('зелёный по окончании шлёт «нажатие на 🎁» и закрывается', () => {
  const st = core.newState(false)
  core.startOverlay(st, 'g', T)
  assert.equal(core.process(st, T + 59 * M).events.length, 0)
  const r = core.process(st, T + 60 * M)
  assert.equal(r.ovDone, true)
  assert.equal(r.ovKind, 'g')
  assert.equal(st.out.length, 1)
  assert.equal(st.out[0].k, 'g')
  assert.equal(st.out[0].id, 'g-' + (T + 60 * M))
  assert.equal(core.overlayActive(st), false)
})

t('зелёный, закрытый досрочно, тоже шлёт «нажатие на 🎁»; красный — нет, серый — пройденное время', () => {
  const st = core.newState(false, 30)
  core.startOverlay(st, 'g', T)
  const r = core.exitOverlay(st, T + 5 * M)
  assert.equal(r.ev.k, 'g')
  assert.equal(st.out.length, 1)
  assert.equal(core.overlayActive(st), false)
  // красный — ничего
  const sr = core.newState(false, 30)
  core.startOverlay(sr, 'r', T)
  assert.equal(core.exitOverlay(sr, T + 5 * M).ev, null)
  assert.equal(sr.out.length, 0)
  // серый — пройденное время (см. тесты серого ниже)
  const sy = core.newState(false, 30)
  core.startOverlay(sy, 'y', T)
  assert.equal(core.exitOverlay(sy, T + 5 * M).ev.k, 'b')
  // зелёный уже закончился, но приложение не успело обработать: событие одно, не два
  const s3 = core.newState(false)
  core.startOverlay(s3, 'g', T)
  core.exitOverlay(s3, T + 61 * M)
  assert.equal(s3.out.length, 1)
})

t('серый по окончании убирает самый левый 🏠/🍀/🔍 из очереди и шлёт телефону ценность 🩸 для такого занятия', () => {
  const st = core.newState(false, 30)
  st.queue = ['🩸', '🔍', '🏠']
  core.startOverlay(st, 'y', T)
  assert.equal(core.process(st, T + 29 * M).events.length, 0)
  const r = core.process(st, T + 30 * M)
  assert.equal(r.ovDone, true)
  assert.equal(st.out.length, 1)
  assert.equal(st.out[0].k, 'b')                           // как у шести занятий: событие «blood» с минутами
  assert.equal(st.out[0].ms, 30 * M)                       // ценность 🩸 (здесь 30 минут)
  assert.equal(st.out[0].f, 1)
  assert.equal(core.EMOJI[st.out[0].i], '🔍')           // самый левый из 🏠🍀🔍 — это 🔍, а не 🏠
  assert.deepEqual(st.queue, ['🩸', '🏠'])
  // в очереди нет ни 🏠, ни 🔍 — таймер закончился, время всё равно уходит 🏠, очередь не меняется
  const st3 = core.newState(false, 30)
  st3.queue = ['🩸', '📖']
  core.startOverlay(st3, 'y', T)
  assert.equal(core.process(st3, T + 30 * M).ovDone, true)
  assert.equal(st3.out.length, 1)
  assert.equal(core.EMOJI[st3.out[0].i], '🏠')
  assert.equal(st3.out[0].ms, 30 * M)
  assert.deepEqual(st3.queue, ['🩸', '📖'])
  // endOverlay закрывает таймер молча (досрочный выход долгим нажатием — exitOverlay, он время отправляет)
  const st2 = core.newState(false, 30)
  core.startOverlay(st2, 'y', T)
  core.endOverlay(st2)
  core.process(st2, T + 60 * M)
  assert.equal(st2.out.length, 0)
})

t('серый: кому идёт время — самый левый 🏠/🔍 в очереди, иначе 🏠 (🍀 никогда)', () => {
  const who = (queue) => { const s = core.newState(false, 30); s.queue = queue; return core.EMOJI[core.grayTarget(s)] }
  assert.equal(who(['🩸', '🔍', '🏠']), '🔍')   // 🔍 левее 🏠
  assert.equal(who(['🏠', '🔍']), '🏠')          // 🏠 левее
  assert.equal(who(['📖', '🔍']), '🔍')          // 🏠 нет вообще, 🔍 есть
  assert.equal(who(['📖', '🩸']), '🏠')          // ни того, ни другого
  assert.equal(who([]), '🏠')                    // очередь пуста
})

t('серый, закрытый досрочно: пройденное время уходит тому же занятию, очередь не меняется', () => {
  const st = core.newState(false, 30)
  st.queue = ['🩸', '🔍', '🏠']
  core.startOverlay(st, 'y', T)
  const r = core.exitOverlay(st, T + 10 * M)
  assert.equal(r.ev.k, 'b')
  assert.equal(core.EMOJI[r.ev.i], '🔍')
  assert.equal(r.ev.ms, 10 * M)                // ценность 30 минут, серый шёл 30 минут -> прошло 10
  assert.equal(r.ev.f, 0)
  assert.equal(st.out.length, 1)
  assert.deepEqual(st.queue, ['🩸', '🔍', '🏠'])
  assert.equal(core.overlayActive(st), false)
  // очередь пуста — время идёт 🏠
  const s2 = core.newState(false, 45)
  core.startOverlay(s2, 'y', T)
  const r2 = core.exitOverlay(s2, T + 20 * M)
  assert.equal(core.EMOJI[r2.ev.i], '🏠')
  assert.equal(r2.ev.ms, 20 * M)
  // короче секунды — ничего
  const s3 = core.newState(false, 30)
  core.startOverlay(s3, 'y', T)
  assert.equal(core.exitOverlay(s3, T + 500).ev, null)
  assert.equal(s3.out.length, 0)
  // тестовый режим (20 секунд вместо ценности): 10 секунд из 20 = половина ценности
  const s4 = core.newState(true, 30)
  core.startOverlay(s4, 'y', T)
  const r4 = core.exitOverlay(s4, T + 10000)
  assert.equal(r4.ev.ms, 15 * M)
  // закончился, но приложение не успело обработать: событие одно (полное), не два
  const s5 = core.newState(false, 30)
  core.startOverlay(s5, 'y', T)
  core.exitOverlay(s5, T + 31 * M)
  assert.equal(s5.out.length, 1)
  assert.equal(s5.out[0].f, 1)
})

t('запуск цветного таймера останавливает идущее занятие', () => {
  const st = core.newState(false, 60)
  core.toggle(st, 5, T)
  core.startOverlay(st, 'r', T + 7 * M)
  assert.equal(core.running(st, 5), false)
  assert.equal(st.out[0].ms, 7 * M)
  assert.equal(core.anyRunning(st), true)
})

t('подтверждение и повторная отправка', () => {
  const st = core.newState(false, 60)
  core.toggle(st, 0, T)
  core.process(st, T + 60 * M)
  assert.equal(core.due(st, T + 60 * M, 15000).length, 1)
  st.out[0].tried = T + 60 * M
  assert.equal(core.due(st, T + 60 * M + 1000, 15000).length, 0)
  assert.equal(core.due(st, T + 60 * M + 16000, 15000).length, 1)
  assert.equal(core.ack(st, st.out[0].id), true)
  assert.equal(st.out.length, 0)
})

t('сохранение и восстановление (в том числе старое сохранение v3)', () => {
  const st = core.newState(false, 45)
  core.toggle(st, 1, T + 100)
  core.startOverlay(core.newState(false), 'g', T)
  const back = core.restore(JSON.stringify(st), false, 60)
  assert.equal(back.val, 45)
  assert.equal(back.run[1], T + 100)
  const old = core.restore(JSON.stringify({ v: 3, rem: [1, 2, 3, 4, 5, 6, 7, 8, 9], run: [0, 0, T, 0, 0, 0, 0, 0, 0], hold: -1, q: { s: 1, run: T }, out: [{ id: '0-5', i: 0, ts: 5 }] }), false, 60)
  assert.equal(old.run[2], T)
  assert.equal(old.q.k, 'r')
  assert.equal(old.out.length, 1)
  const done = core.restore(JSON.stringify({ v: 4, run: [0, 0, 0, 0, 0, 0], q: { k: 'r', s: 2, run: T } }), false, 60)
  assert.equal(core.overlayActive(done), false)    // закончившийся таймер из прошлой версии не возвращается
  assert.equal(core.restore('мусор', false, 30).val, 30)
  assert.equal(core.restore('', true, 60).test, true)
})

t('очередь: в конце полного промежутка убирается самое левое такое занятие (в том числе при нескольких промежутках за раз)', () => {
  const st = core.newState(false, 30)
  st.queue = ['🩸', '🧬', '🩸', '🩸', '🧬']
  core.toggle(st, 2, T)                                   // 🩸
  core.process(st, T + 30 * M)
  assert.deepEqual(st.queue, ['🧬', '🩸', '🩸', '🧬'])
  core.process(st, T + 90 * M)                            // приложение было закрыто: прошло ещё два промежутка
  assert.deepEqual(st.queue, ['🧬', '🧬'])
  core.process(st, T + 120 * M)                           // 🩸 в очереди больше нет — очередь не трогается, событие уходит
  assert.deepEqual(st.queue, ['🧬', '🧬'])
  assert.equal(st.out.length, 4)
  // стоп раньше конца промежутка очередь не меняет
  const s2 = core.newState(false, 60)
  s2.queue = ['🧭']
  core.toggle(s2, 4, T)
  core.toggle(s2, 4, T + 20 * M)
  assert.deepEqual(s2.queue, ['🧭'])
})

t('очередь хранится вместе с состоянием, чистится от лишнего и не длиннее 12', () => {
  const st = core.newState(false, 60)
  st.queue = ['🩸', '🏠', '🔍']
  const back = core.restore(JSON.stringify(st), false, 60)
  assert.deepEqual(back.queue, ['🩸', '🏠', '🔍'])
  assert.deepEqual(core.cleanQueue(['🩸', '🍀', 'x', 5, '💀']), ['🩸', '💀'])   // 🍀 и мусор не попадают
  assert.equal(core.cleanQueue(new Array(30).fill('🩸')).length, 12)
  assert.deepEqual(core.cleanQueue(undefined), [])
  // события «новая очередь» из версии 15 при загрузке выбрасываются, остальные остаются
  const old = core.newState(false, 60)
  old.out = [{ id: 'qs-1', k: 'qs', ts: T, q: ['🩸'], tried: 0 }, { id: 'g-1', k: 'g', ts: T, tried: 0 }]
  const r = core.restore(JSON.stringify(old), false, 60)
  assert.deepEqual(r.out.map((e) => e.id), ['g-1'])
})

t('случайная очередь: 6 занятий из восьми, не бывает двух одинаковых подряд, у всех равные шансы', () => {
  assert.deepEqual(core.RANDOM_POOL.slice().sort(), ['🏠', '🔍', '🧬', '💀', '🩸', '🤖', '🧭', '📖'].sort())
  const count = {}
  const firstCount = {}
  let seed = 12345
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  const N = 40000
  for (let k = 0; k < N; k++) {
    const q = core.randomQueue(rnd)
    assert.equal(q.length, 6)
    for (let i = 0; i < 6; i++) {
      assert.ok(core.RANDOM_POOL.includes(q[i]))
      if (i > 0) assert.notEqual(q[i], q[i - 1])
      count[q[i]] = (count[q[i]] || 0) + 1
    }
    firstCount[q[0]] = (firstCount[q[0]] || 0) + 1
  }
  // равные шансы: каждое эмодзи встречается примерно в 1/8 мест (допуск 4%), и повторы не подряд случаются
  for (const e of core.RANDOM_POOL) {
    assert.ok(Math.abs(count[e] / (N * 6) - 1 / 8) < 0.005, e + ' ' + count[e])
    assert.ok(Math.abs(firstCount[e] / N - 1 / 8) < 0.01, 'первое ' + e)
  }
  // самый «упрямый» источник случайных чисел (всегда 0 и всегда почти 1) тоже даёт верную очередь
  for (const f of [() => 0, () => 0.9999999]) {
    const q = core.randomQueue(f)
    assert.equal(q.length, 6)
    for (let i = 1; i < 6; i++) assert.notEqual(q[i], q[i - 1])
  }
  assert.equal(core.randomQueue().length, 6)              // без аргумента — настоящий Math.random
})

t('ценность 15 минут: промежуток и минуты для телефона', () => {
  const st = core.newState(false, 15)
  assert.equal(st.val, 15)
  assert.equal(core.valueMs(st), 15 * M)
  core.toggle(st, 0, T)
  const r = core.process(st, T + 15 * M)
  assert.equal(r.events.length, 1)
  assert.equal(r.events[0].ms, 15 * M)
  assert.equal(core.label(st, 15 * M), '15')
  const back = core.restore(JSON.stringify(st), false, 60)
  assert.equal(back.val, 15)
})

t('эмодзи занятий: 🧬 💀 🩸 / 🤖 🧭 📖, затем 🏠 🍀 🔍', () => {
  assert.deepEqual(core.EMOJI.slice(0, 6), ['🧬', '💀', '🩸', '🤖', '🧭', '📖'])
  assert.deepEqual(core.EMOJI.slice(6), ['🏠', '🍀', '🔍'])
  assert.equal(core.SLOT_LEN, 6)
  // очередь из прошлой версии (другие эмодзи) при загрузке сбрасывается, таймеры и ценность остаются
  const oldSave = JSON.stringify({ v: 5, val: 45, run: [T, 0, 0, 0, 0, 0], q: { k: '', s: 0, run: 0 }, out: [], queue: ['🧬', '📖'] })
  const back = core.restore(oldSave, false, 60)
  assert.deepEqual(back.queue, [])
  assert.equal(back.val, 45)
  assert.equal(back.run[0], T)
})

t('автостарт: занятия идут по очереди, каждое один промежуток, в конце очереди автостарт выключается', () => {
  const st = core.newState(false, 30)
  st.queue = ['🧬', '🩸', '🧭']
  core.startAuto(st, T)
  assert.equal(st.auto, true)
  assert.equal(st.run[0], T)
  assert.equal(core.process(st, T + 29 * M).events.length, 0)
  const r1 = core.process(st, T + 30 * M)
  assert.equal(r1.events.length, 1)
  assert.equal(r1.events[0].i, 0)
  assert.equal(r1.events[0].ms, 30 * M)                     // телефону — полная ценность 🩸
  assert.equal(r1.fresh, true)
  assert.deepEqual(st.queue, ['🩸', '🧭'])
  assert.equal(st.run[0], 0)
  assert.equal(st.run[2], T + 30 * M)                        // следующее началось ровно в момент окончания прежнего
  assert.equal(st.auto, true)
  core.process(st, T + 60 * M)
  assert.equal(st.run[4], T + 60 * M)
  assert.deepEqual(st.queue, ['🧭'])
  const r3 = core.process(st, T + 90 * M)
  assert.equal(r3.events[0].i, 4)
  assert.deepEqual(st.queue, [])
  assert.equal(st.auto, false)
  assert.equal(core.anyRunning(st), false)                   // очередь кончилась — ничего не идёт, по кругу не крутится
  assert.equal(st.out.length, 3)
})

t('автостарт: экран был выключен — пропущенные занятия засчитываются с настоящим временем, лишнего не запускается', () => {
  const st = core.newState(false, 30)
  st.queue = ['🧬', '🩸', '🧭']
  core.startAuto(st, T)
  const r = core.process(st, T + 100 * M)
  assert.deepEqual(r.events.map((e) => e.i), [0, 2, 4])
  assert.deepEqual(r.events.map((e) => e.ts), [T + 30 * M, T + 60 * M, T + 90 * M])
  assert.equal(r.fresh, false)                               // сигнал подаётся только для свежих событий
  assert.equal(st.auto, false)
  assert.equal(core.anyRunning(st), false)
  // середина очереди: два занятия засчитаны, третье идёт
  const s2 = core.newState(false, 30)
  s2.queue = ['🧬', '🩸', '🧭']
  core.startAuto(s2, T)
  core.process(s2, T + 70 * M)
  assert.equal(s2.auto, true)
  assert.equal(s2.run[4], T + 60 * M)
  assert.deepEqual(s2.queue, ['🧭'])
})

t('автостарт: одно и то же занятие подряд, 🏠 / 🔍 идут серым таймером', () => {
  const st = core.newState(false, 30)
  st.queue = ['🧬', '🧬', '🏠', '🔍', '💀']
  core.startAuto(st, T)
  core.process(st, T + 30 * M)
  assert.equal(st.run[0], T + 30 * M)                        // второй 🧬 подряд
  const g = core.process(st, T + 60 * M)
  assert.equal(st.q.k, 'y')                                  // 🏠 — серый таймер
  assert.equal(st.q.run, T + 60 * M)
  assert.equal(core.overlayActive(st), true)
  assert.equal(g.ovDone, false)
  const r = core.process(st, T + 90 * M)
  assert.equal(r.ovDone, true)
  assert.equal(core.EMOJI[r.events[0].i], '🏠')              // время серого — 🏠 (он левее)
  assert.equal(r.events[0].ms, 30 * M)
  assert.deepEqual(st.queue, ['🔍', '💀'])
  assert.equal(st.q.k, 'y')                                  // следующий — 🔍, снова серый
  const r2 = core.process(st, T + 120 * M)
  assert.equal(core.EMOJI[r2.events[0].i], '🔍')
  assert.equal(st.run[1], T + 120 * M)                       // потом 💀
  core.process(st, T + 150 * M)
  assert.equal(st.auto, false)
  assert.deepEqual(st.queue, [])
})

t('автостарт: стоп занятия (нажатие, другое занятие, цветной таймер, досрочный выход из серого) выключает автостарт', () => {
  const mk = () => { const s = core.newState(false, 30); s.queue = ['🧬', '🩸', '🧭']; core.startAuto(s, T); return s }
  const a = mk()
  core.toggle(a, 0, T + 10 * M)                              // стоп идущего
  assert.equal(a.auto, false)
  assert.equal(core.anyRunning(a), false)
  assert.deepEqual(a.queue, ['🧬', '🩸', '🧭'])              // очередь не тронута
  assert.equal(a.out.length, 1)                              // пройденное время ушло
  assert.equal(a.out[0].ms, 10 * M)
  const b = mk()
  core.toggle(b, 3, T + 10 * M)                              // другое занятие
  assert.equal(b.auto, false)
  assert.equal(b.run[3], T + 10 * M)
  assert.equal(b.run[0], 0)
  const c = mk()
  core.startOverlay(c, 'r', T + 10 * M)
  assert.equal(c.auto, false)
  const d = core.newState(false, 30)
  d.queue = ['🏠', '🧬']
  core.startAuto(d, T)
  const r = core.exitOverlay(d, T + 10 * M)                  // досрочный выход из серого
  assert.equal(d.auto, false)
  assert.equal(core.anyRunning(d), false)
  assert.equal(r.ev.ms, 10 * M)
  assert.deepEqual(d.queue, ['🏠', '🧬'])
  // выход из серого, который как раз закончился, а автостарт пошёл дальше: ничего лишнего не останавливается
  const e = core.newState(false, 30)
  e.queue = ['🏠', '🧬']
  core.startAuto(e, T)
  const r2 = core.exitOverlay(e, T + 31 * M)
  assert.equal(r2.ev, null)
  assert.equal(e.auto, true)
  assert.equal(e.run[0], T + 30 * M)
})

t('автостарт: включается только когда ничего не идёт и очередь не пуста', () => {
  const a = core.newState(false, 30)
  core.startAuto(a, T)
  assert.equal(a.auto, false)                                // очередь пуста
  const b = core.newState(false, 30)
  b.queue = ['🩸']
  core.toggle(b, 3, T)
  core.startAuto(b, T + M)
  assert.equal(b.auto, false)                                // уже что-то идёт
  assert.equal(b.run[2], 0)
  // «автостарт включён, но ничего не идёт» (битое сохранение) — выключается сам
  const c = core.newState(false, 30)
  c.auto = true
  core.process(c, T)
  assert.equal(c.auto, false)
})

t('автостарт: будильники — первая граница и сколько их ещё впереди', () => {
  const st = core.newState(false, 30)
  st.queue = ['🧬', '🩸', '🧭']
  core.startAuto(st, T)
  const d = core.nextDue(st)
  assert.equal(d.length, 1)
  assert.equal(d[0].t, T + 30 * M)
  assert.equal(d[0].kind, 'hour')
  assert.equal(d[0].n, 2)                                    // границ три: первая — этот будильник, ещё две — цепочкой службы
  core.process(st, T + 30 * M)
  assert.equal(core.nextDue(st)[0].n, 1)
  assert.equal(core.nextDue(st)[0].t, T + 60 * M)
  // обычные занятия — без n (цепочка без ограничения, как раньше)
  const o = core.newState(false, 30)
  core.toggle(o, 0, T)
  assert.equal(core.nextDue(o)[0].n, undefined)
})

t('тестовый режим: включается только когда ничего не идёт; всё по 20 секунд, телефону — полная ценность; переживает перезапуск', () => {
  const st = core.newState(false, 45)
  assert.equal(core.toggleTest(st), true)
  assert.equal(st.test, true)
  assert.equal(core.fullMs(st), 20000)
  core.toggle(st, 3, T)
  assert.equal(core.toggleTest(st), false)                   // идёт занятие — режим не меняется
  assert.equal(st.test, true)
  const r = core.process(st, T + 20000)
  assert.equal(r.events.length, 1)
  assert.equal(r.events[0].ms, 45 * M)                       // как будто прошла вся ценность 🩸
  assert.equal(r.events[0].x, 1)
  assert.equal(core.label(st, 20000), '20')                  // на кнопке секунды
  core.toggle(st, 3, T + 30000)
  const back = core.restore(JSON.stringify(st), false, 60)
  assert.equal(back.test, true)
  assert.equal(core.toggleTest(back), true)
  assert.equal(back.test, false)
  // цветные таймеры: красный, зелёный, серый — тоже по 20 секунд
  for (const k of ['r', 'g', 'y']) {
    const s = core.newState(true, 30)
    core.startOverlay(s, k, T)
    assert.equal(core.ovLen(s), 20000)
    assert.equal(core.process(s, T + 20000).ovDone, true)
  }
  // автостарт в тесте: каждое занятие 20 секунд
  const a = core.newState(true, 60)
  a.queue = ['🧬', '🩸']
  core.startAuto(a, T)
  const ra = core.process(a, T + 40000)
  assert.deepEqual(ra.events.map((e) => e.ms), [60 * M, 60 * M])
  assert.equal(a.auto, false)
})

console.log('\nВсе проверки пройдены: ' + n)
