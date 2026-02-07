const fs = require('fs');
require('dotenv').config();
const { Telegraf, Scenes, session, Markup } = require('telegraf');

// ===== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ =====
let weekGoal = 70; // Цель недели по умолчанию
let runs = []; // Все пробежки

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====

// Форматирование темпа (мин/км)
function formatPace(minPerKm) {
  const totalSec = Math.round(minPerKm * 60);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')} мин/км`;
}

// Конвертация темпа в скорость (км/ч)
function paceToKmh(minPerKm) {
  return (60 / minPerKm).toFixed(1);
}

// Форматирование даты (дд.мм.гг)
function formatDate(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  return `${day}.${month}.${year}`;
}

// Дата в формате YYYY-MM-DD
function todayIso() {
  return new Date().toISOString().split('T')[0];
}

// Получение статистики
function getStats() {
  const now = new Date();
  const todayStr = todayIso();

  // Начало недели (понедельник)
  const weekStart = new Date(now);
  const dayOfWeek = weekStart.getDay(); // 0 = воскресенье
  const diffToMonday = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
  weekStart.setDate(weekStart.getDate() + diffToMonday);
  weekStart.setHours(0, 0, 0, 0);

  // Начало месяца
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Подсчет километража
  const todayKm = runs
    .filter(run => run.date === todayStr)
    .reduce((sum, run) => sum + run.distance, 0);

  const weekKm = runs
    .filter(run => new Date(run.date) >= weekStart)
    .reduce((sum, run) => sum + run.distance, 0);

  const monthKm = runs
    .filter(run => new Date(run.date) >= monthStart)
    .reduce((sum, run) => sum + run.distance, 0);

  return {
    todayKm,
    weekKm,
    monthKm,
    weekStart,
    weekEnd: now
  };
}

// Экспорт в CSV
function exportRunsToCsv() {
  if (runs.length === 0) return null;

  const header = 'Дата,Дистанция (км),Время (мин),Пульс (уд/мин),Тип,Заметка\n';
  const rows = runs.map(run => {
    const note = run.note ? `"${run.note.replace(/"/g, '""')}"` : '';
    return `${run.date},${run.distance},${run.timeMin},${run.avgHr},${run.workoutType},${note}`;
  });

  return header + rows.join('\n');
}

// Типы тренировок
const WORKOUT_TYPES = ['Лёгкий', 'Темповый', 'Интервалы', 'Длительная'];

// ===== WIZARDSCENE: ВВОД ПРОБЕЖКИ =====
const runWizard = new Scenes.WizardScene(
  'run-wizard',

  // Шаг 1: Дистанция
  (ctx) => {
    ctx.wizard.state.run = {};
    ctx.reply('🏃 **Введи дистанцию в километрах**\nНапример: 5.2', {
      parse_mode: 'Markdown',
      ...Markup.removeKeyboard()
    });
    return ctx.wizard.next();
  },

  // Шаг 2: Время
  (ctx) => {
    const km = parseFloat(ctx.message.text.replace(',', '.'));
    if (!km || km <= 0 || km > 100) {
      ctx.reply('❌ Некорректное значение. Введи число от 0.1 до 100\nНапример: 10.5');
      return;
    }
    ctx.wizard.state.run.distance = km;
    ctx.reply('⏱ **Введи время в минутах**\nНапример: 52 (для 52 минут)');
    return ctx.wizard.next();
  },

  // Шаг 3: Пульс
  (ctx) => {
    const mins = parseInt(ctx.message.text, 10);
    if (!mins || mins <= 0 || mins > 600) {
      ctx.reply('❌ Некорректное время. Введи число от 1 до 600 минут\nНапример: 65');
      return;
    }
    ctx.wizard.state.run.timeMin = mins;
    ctx.reply('❤️ **Введи средний пульс (уд/мин)**\nНапример: 145');
    return ctx.wizard.next();
  },

  // Шаг 4: Тип тренировки
  (ctx) => {
    const hr = parseInt(ctx.message.text, 10);
    if (!hr || hr <= 0 || hr > 220) {
      ctx.reply('❌ Некорректный пульс. Введи число от 60 до 220\nНапример: 150');
      return;
    }
    ctx.wizard.state.run.avgHr = hr;

    ctx.reply(
      '📌 **Выбери тип тренировки:**',
      Markup.keyboard([
        ['Лёгкий', 'Темповый'],
        ['Интервалы', 'Длительная']
      ]).oneTime().resize()
    );
    return ctx.wizard.next();
  },

  // Шаг 5: Комментарий
  (ctx) => {
    const type = ctx.message.text.trim();
    if (!WORKOUT_TYPES.includes(type)) {
      ctx.reply('❌ Выбери тип из предложенных вариантов');
      return;
    }
    ctx.wizard.state.run.workoutType = type;

    ctx.reply(
      '📝 **Добавь комментарий** (или напиши "-" чтобы пропустить):',
      mainKeyboard()
    );
    return ctx.wizard.next();
  },

  // Шаг 6: Сохранение и вывод результатов
  (ctx) => {
    const note = ctx.message.text === '-' ? '' : ctx.message.text;
    const data = ctx.wizard.state.run;

    // Создание объекта пробежки
    const run = {
      date: todayIso(),
      distance: data.distance,
      timeMin: data.timeMin,
      avgHr: data.avgHr,
      workoutType: data.workoutType,
      note: note
    };

    // Сохранение
    runs.push(run);
    console.log(`✅ Сохранена пробежка: ${run.distance} км, ${run.timeMin} мин`);

    // Расчет показателей
    const rawPace = run.timeMin / run.distance;
    const paceStr = formatPace(rawPace);
    const speed = paceToKmh(rawPace);

    // Получение статистики
    const stats = getStats();
    const todayStr = formatDate(new Date());
    const weekRange = `${formatDate(stats.weekStart)}–${formatDate(stats.weekEnd)}`;

    // Формирование отчета
    let report = `✅ *Пробежка сохранена!*\n\n`;
    report += `📅 *Дата:* ${todayStr}\n`;
    report += `🎯 *Тип:* ${run.workoutType}\n`;
    report += `📏 *Дистанция:* ${run.distance.toFixed(1)} км\n`;
    report += `⏱ *Время:* ${run.timeMin} мин\n`;
    report += `❤️ *Пульс:* ${run.avgHr} уд/мин\n`;
    report += `🏃 *Темп:* ${paceStr}\n`;
    report += `🚀 *Скорость:* ${speed} км/ч\n`;

    if (note) report += `📝 *Заметка:* ${note}\n`;

    report += `\n*📊 Статистика:*\n`;
    report += `📅 *Сегодня:* ${stats.todayKm.toFixed(1)} км\n`;
    report += `📈 *Неделя (${weekRange}):* ${stats.weekKm.toFixed(1)} км из ${weekGoal} км\n`;
    report += `📆 *Месяц:* ${stats.monthKm.toFixed(1)} км`;

    ctx.reply(report, { parse_mode: 'Markdown', ...mainKeyboard() });
    return ctx.scene.leave();
  }
);

// Отмена ввода пробежки
runWizard.command('cancel', (ctx) => {
  ctx.reply('❌ Ввод пробежки отменен.', mainKeyboard());
  return ctx.scene.leave();
});

// ===== НАСТРОЙКА БОТА =====
const stage = new Scenes.Stage([runWizard]);
const bot = new Telegraf(process.env.BOT_TOKEN);

bot.use(session());
bot.use(stage.middleware());

// Главное меню
function mainKeyboard() {
  return Markup.keyboard([
    ['🟢 Новая пробежка', '📊 Неделя'],
    ['🕒 Последняя', '🎯 Цель'],
    ['📂 Экспорт', '📈 Вся статистика']
  ]).resize();
}

// ===== ОБРАБОТЧИКИ КОМАНД =====

// /start
bot.start((ctx) => {
  ctx.reply(
    `🏃‍♂️ *Привет, ${ctx.from.first_name}!*\n\n` +
    `Я твой персональный беговой трекер.\n\n` +
    '*📈 Что я умею:*\n' +
    '• Записывать пробежки (дистанция, время, пульс)\n' +
    '• Рассчитывать темп и скорость\n' +
    '• Показывать статистику за неделю/месяц\n' +
    '• Напоминать о тренировках\n' +
    '• Экспортировать данные в CSV\n' +
    `🎯 *Текущая цель недели:* ${weekGoal} км\n\n` +
    '*👇 Выбери действие:*',
    { parse_mode: 'Markdown', ...mainKeyboard() }
  );
});

// 🟢 Новая пробежка
bot.hears('🟢 Новая пробежка', (ctx) => {
  ctx.scene.enter('run-wizard');
});

// 📊 Неделя
bot.hears('📊 Неделя', (ctx) => {
  const stats = getStats();
  const weekRange = `${formatDate(stats.weekStart)}–${formatDate(stats.weekEnd)}`;
  
  let progressBar = '';
  const progress = Math.min(100, Math.round((stats.weekKm / weekGoal) * 100));
  
  // График прогресса
  const filled = Math.floor(progress / 10);
  const empty = 10 - filled;
  progressBar = '▰'.repeat(filled) + '▱'.repeat(empty);
  
  const message = `*📊 Неделя ${weekRange}*\n\n` +
                  `*Пробежано:* ${stats.weekKm.toFixed(1)} км из ${weekGoal} км\n` +
                  `*Прогресс:* ${progress}%\n` +
                  `${progressBar}\n\n` +
                  `*Сегодня:* ${stats.todayKm.toFixed(1)} км\n` +
                  `*В этом месяце:* ${stats.monthKm.toFixed(1)} км`;
  
  ctx.reply(message, { parse_mode: 'Markdown' });
});

// 🕒 Последняя пробежка
bot.hears('🕒 Последняя', (ctx) => {
  if (runs.length === 0) {
    ctx.reply('📭 *Пока нет пробежек*\n\nНажми "🟢 Новая пробежка" чтобы добавить первую!', 
      { parse_mode: 'Markdown' });
    return;
  }

  const lastRun = runs[runs.length - 1];
  const rawPace = lastRun.timeMin / lastRun.distance;
  const paceStr = formatPace(rawPace);
  const speed = paceToKmh(rawPace);
  const dateStr = formatDate(new Date(lastRun.date));

  let message = `*🕒 Последняя пробежка*\n\n` +
                `*Дата:* ${dateStr}\n` +
                `*Тип:* ${lastRun.workoutType}\n` +
                `*Дистанция:* ${lastRun.distance} км\n` +
                `*Время:* ${lastRun.timeMin} мин\n` +
                `*Пульс:* ${lastRun.avgHr} уд/мин\n` +
                `*Темп:* ${paceStr}\n` +
                `*Скорость:* ${speed} км/ч`;

  if (lastRun.note) {
    message += `\n*Заметка:* ${lastRun.note}`;
  }

  ctx.reply(message, { parse_mode: 'Markdown' });
});

// 🎯 Цель
bot.hears('🎯 Цель', (ctx) => {
  ctx.reply(
    `*🎯 Текущая цель недели:* ${weekGoal} км\n\n` +
    'Чтобы изменить цель, отправь команду:\n' +
    '`/goal 80` (для 80 км в неделю)',
    { parse_mode: 'Markdown' }
  );
});

// 📂 Экспорт
bot.hears('📂 Экспорт', async (ctx) => {
  if (runs.length === 0) {
    ctx.reply('📭 *Нет данных для экспорта*\n\nСначала добавь пробежки!', 
      { parse_mode: 'Markdown' });
    return;
  }

  try {
    const csv = exportRunsToCsv();
    const filename = `беговой_трекер_${new Date().toISOString().slice(0, 10)}.csv`;
    
    fs.writeFileSync(filename, csv, 'utf8');
    await ctx.replyWithDocument({
      source: filename,
      filename: filename
    });
    
    fs.unlinkSync(filename); // Удаляем временный файл
  } catch (error) {
    console.error('Ошибка экспорта:', error);
    ctx.reply('❌ *Не удалось экспортировать данные*\nПопробуй позже.', 
      { parse_mode: 'Markdown' });
  }
});

// 📈 Вся статистика
bot.hears('📈 Вся статистика', (ctx) => {
  const stats = getStats();
  const totalKm = runs.reduce((sum, run) => sum + run.distance, 0);
  const totalTime = runs.reduce((sum, run) => sum + run.timeMin, 0);
  const avgPace = totalKm > 0 ? totalTime / totalKm : 0;
  
  const message = `*📈 Общая статистика*\n\n` +
                  `*Всего пробежек:* ${runs.length}\n` +
                  `*Общий километраж:* ${totalKm.toFixed(1)} км\n` +
                  `*Общее время:* ${totalTime} мин\n` +
                  `*Средний темп:* ${totalKm > 0 ? formatPace(avgPace) : '0:00 мин/км'}\n\n` +
                  `*За неделю:* ${stats.weekKm.toFixed(1)} км\n` +
                  `*За месяц:* ${stats.monthKm.toFixed(1)} км\n` +
                  `*Сегодня:* ${stats.todayKm.toFixed(1)} км`;

  ctx.reply(message, { parse_mode: 'Markdown' });
});

// ===== КОМАНДЫ =====

// /run - альтернатива кнопке
bot.command('run', (ctx) => {
  ctx.scene.enter('run-wizard');
});

// /week - статистика за неделю
bot.command('week', (ctx) => {
  const stats = getStats();
  const weekRange = `${formatDate(stats.weekStart)}–${formatDate(stats.weekEnd)}`;
  ctx.reply(
    `*📊 Неделя ${weekRange}*\n\n` +
    `*Пробежано:* ${stats.weekKm.toFixed(1)} км из ${weekGoal} км\n` +
    `*Прогресс:* ${Math.round((stats.weekKm / weekGoal) * 100)}%\n` +
    `*Сегодня:* ${stats.todayKm.toFixed(1)} км`,
    { parse_mode: 'Markdown' }
  );
});

// /last - последняя пробежка
bot.command('last', (ctx) => {
  if (runs.length === 0) {
    ctx.reply('📭 *Пока нет пробежек*', { parse_mode: 'Markdown' });
    return;
  }

  const lastRun = runs[runs.length - 1];
  const rawPace = lastRun.timeMin / lastRun.distance;
  const paceStr = formatPace(rawPace);
  const dateStr = formatDate(new Date(lastRun.date));

  ctx.reply(
    `*🕒 Последняя пробежка (${dateStr})*\n\n` +
    `*Дистанция:* ${lastRun.distance} км\n` +
    `*Время:* ${lastRun.timeMin} мин\n` +
    `*Темп:* ${paceStr}\n` +
    `*Тип:* ${lastRun.workoutType}`,
    { parse_mode: 'Markdown' }
  );
});

// /goal - установка цели
bot.command('goal', (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    ctx.reply(
      `*🎯 Текущая цель:* ${weekGoal} км в неделю\n\n` +
      'Чтобы изменить цель:\n' +
      '`/goal 60` - для 60 км в неделю\n' +
      '`/goal 80` - для 80 км в неделю',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const newGoal = parseFloat(args[1]);
  if (!newGoal || newGoal <= 0 || newGoal > 500) {
    ctx.reply('❌ *Некорректная цель*\nВведи число от 1 до 500 км.', 
      { parse_mode: 'Markdown' });
    return;
  }

  weekGoal = newGoal;
  ctx.reply(`✅ *Цель обновлена!*\n\nНовая цель недели: ${weekGoal} км`, 
    { parse_mode: 'Markdown' });
});

// /export - экспорт
bot.command('export', async (ctx) => {
  if (runs.length === 0) {
    ctx.reply('📭 *Нет данных для экспорта*', { parse_mode: 'Markdown' });
    return;
  }

  try {
    const csv = exportRunsToCsv();
    const filename = `беговые_данные_${new Date().toISOString().slice(0, 10)}.csv`;
    
    fs.writeFileSync(filename, csv, 'utf8');
    await ctx.replyWithDocument({
      source: filename,
      filename: filename
    });
    
    fs.unlinkSync(filename);
  } catch (error) {
    ctx.reply('❌ *Ошибка экспорта*', { parse_mode: 'Markdown' });
  }
});

// /stats - полная статистика (команда)
bot.command('stats', (ctx) => {
  const stats = getStats();
  const totalKm = runs.reduce((sum, run) => sum + run.distance, 0);
  const totalTime = runs.reduce((sum, run) => sum + run.timeMin, 0);
  const avgPace = totalKm > 0 ? totalTime / totalKm : 0;
  
  const message = `*📈 Общая статистика*\n\n` +
                  `*Всего пробежек:* ${runs.length}\n` +
                  `*Общий километраж:* ${totalKm.toFixed(1)} км\n` +
                  `*Общее время:* ${totalTime} мин\n` +
                  `*Средний темп:* ${totalKm > 0 ? formatPace(avgPace) : '0:00 мин/км'}\n\n` +
                  `*За неделю:* ${stats.weekKm.toFixed(1)} км\n` +
                  `*За месяц:* ${stats.monthKm.toFixed(1)} км\n` +
                  `*Сегодня:* ${stats.todayKm.toFixed(1)} км`;

  ctx.reply(message, { parse_mode: 'Markdown' });
});

// ===== ЗАПУСК БОТА =====
bot.launch().then(() => {
  console.log('🏃‍♂️ Беговой трекер запущен!');
  console.log('📱 Перейдите в Telegram и напишите /start');
  console.log(`📊 Загружено пробежек: ${runs.length}`);
  console.log(`🎯 Цель недели: ${weekGoal} км`);
});

// Обработка завершения
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));