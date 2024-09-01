require('dotenv').config({ path: 'D:/KGTUbot/client_secret.env' });
const token = process.env.TELEGRAM_BOT_TOKEN;
const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
const TelegramApi = require('node-telegram-bot-api');
const { google } = require('googleapis');
const sheets = google.sheets('v4');
const fs = require('fs');

const bot = new TelegramApi(token, { polling: true });

const getSheetData = async (groupNumber, sheetName) => {
  const auth = new google.auth.GoogleAuth({
    
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });

  const range = `${sheetName}!A1:Q157`;

  try {
    const authClient = await auth.getClient();
    const response = await sheets.spreadsheets.values.get({
      auth: authClient,
      spreadsheetId,
      range,
    });

    const values = response.data.values;
    if (values.length) {
      const header = values[0];
      const groupIndex = header.indexOf(groupNumber);
      if (groupIndex === -1) {
        return null;
      }
      const schedule = values.slice(1)
        .map(row => row[groupIndex] || '')
        .filter(cell => cell.trim() !== '');
      return schedule;
    } else {
      return null;
    }
  } catch (error) {
    console.error('Ошибка при получении данных из Google Sheets:', error);
    return null;
  }
};

const again = async () => {
  return {
    reply_markup: JSON.stringify({
      inline_keyboard: [
        [{ text: 'Расписание на сегодня', callback_data: '/today' }],
        [{ text: 'Расписание на завтра', callback_data: '/tomorrow' }],
        [{ text: 'Расписание на неделю', callback_data: '/week' }]
      ]
    })
  };
};

const start = async () => {
  bot.setMyCommands([
    { command: '/start', description: 'начальное приветствие' },
    { command: '/change_group', description: 'Сменить номер группы' }
  ]);

  let waitingForGroupNumber = false;
  let userStates = {}; // Объект для хранения состояния каждого пользователя

  const groups = JSON.parse(fs.readFileSync('groups.json', 'utf8')).groups;

  const normalizeGroupNumber = (input) => {
    return input.replace(/\s+/g, '').replace(/-/g, '').toUpperCase();
  };

  bot.on('message', async msg => {
    const text = msg.text;
    const chatID = msg.chat.id;

    if (text === '/start') {
      if (!userStates[chatID] || !userStates[chatID].groupNumber) {
        waitingForGroupNumber = true;
        await bot.sendMessage(chatID, `Здравствуйте ${msg.from.first_name}, вас приветствует КГТУбот, здесь вы можете смотреть расписание для вашей группы. Введите номер своей группы и используйте меню, чтобы изменить номер группы`);
      } else {
        const replyMarkup = await again();
        await bot.sendMessage(chatID, 'Номер группы найден, что вы хотите сделать?', replyMarkup);
      }
    } else if (text === '/change_group') {
      waitingForGroupNumber = true;
      await bot.sendMessage(chatID, 'Введите новый номер группы');
    } else if (waitingForGroupNumber) {
      const normalizedInput = normalizeGroupNumber(text);
      const group = groups.find(g => normalizeGroupNumber(g) === normalizedInput);
      if (group) {
        userStates[chatID] = { groupNumber: group }; // Сохраняем номер группы
        const replyMarkup = await again();
        await bot.sendMessage(chatID, 'Номер группы сохранен, что вы хотите сделать?', replyMarkup);
      } else {
        await bot.sendMessage(chatID, 'Такой группы не существует. Пожалуйста, введите корректный номер группы.');
      }
      waitingForGroupNumber = true;
    } else {
      await bot.sendMessage(chatID, 'Я вас не понимаю, пожалуйста используйте меню)');
    }
  });

  bot.on('callback_query', async msg => {
    const data = msg.data;
    const chatID = msg.message.chat.id;
    const callbackQueryId = msg.id;

    let sheetName;
    if (data === '/today') {
      sheetName = 'CurrentSchedule';
    } else if (data === '/tomorrow') {
      sheetName = 'TomorrowSchedule';
    } else if (data === '/week') {
      sheetName = 'CurrentWeek';
    } else {
      await bot.answerCallbackQuery(callbackQueryId, { text: 'Неизвестная команда' });
      return;
    }

    const userState = userStates[chatID];
    if (userState && userState.groupNumber) {
      const schedule = await getSheetData(userState.groupNumber, sheetName);
      const replyMarkup = await again();
      if (schedule) {
        const formattedSchedule = data === '/week' ? formatWeekSchedule(schedule) : formatSchedule(schedule);
        await bot.sendMessage(chatID, `Расписание для группы ${userState.groupNumber} на ${data === '/week' ? 'текущую неделю' : sheetName === 'TomorrowSchedule' ? 'завтра' : 'сегодня'}:\n${formattedSchedule}`, { parse_mode: 'Markdown', ...replyMarkup });
      } else {
        await bot.sendMessage(chatID, `Расписание для группы ${userState.groupNumber} на ${data === '/week' ? 'текущую неделю' : sheetName === 'TomorrowSchedule' ? 'завтра' : 'сегодня'} не найдено`, replyMarkup);
      }
    } else {
      await bot.sendMessage(chatID, 'Номер группы не найден. Пожалуйста, введите номер группы снова.');
      waitingForGroupNumber = true;
    }

    try {
      await bot.answerCallbackQuery(callbackQueryId);
    } catch (error) {
      console.error('Ошибка при ответе на callback query:', error);
    }
  });
};

const formatSchedule = (schedule) => {
  return schedule
    .map((cell, index) => {
      return (index > 0 && (index + 1) % 5 === 0) ? `*${cell.replace(/_/g, '\\_').replace(/\*/g, '\\*')}*\n` : `*${cell.replace(/_/g, '\\_').replace(/\*/g, '\\*')}*`;
    })
    .join('\n');
};

const formatWeekSchedule = (schedule) => {
  const daysOfWeek = ['📅Понедельник', '📅Вторник', '📅Среда', '📅Четверг', '📅Пятница', '📅Суббота', '📅Воскресенье'];
  let formattedSchedule = '';
  let isNewDay = true;

  schedule.forEach((cell) => {
    // Проверяем, является ли текущий элемент днем недели
    if (daysOfWeek.includes(cell)) {
      // Добавляем пустую строку под днем недели, если это не первый день
      if (!isNewDay) {
        formattedSchedule += '\n';
      }
      formattedSchedule += `\n*${cell.replace(/_/g, '\\_').replace(/\*/g, '\\*')}*`;
      isNewDay = true;
    } else {
      // Добавляем пустую строку над строкой с эмодзи песочных часов
      if (cell.includes('⏳')) {
        formattedSchedule += '\n';
      }
      formattedSchedule += `\n*${cell.replace(/_/g, '\\_').replace(/\*/g, '\\*')}*`;
      isNewDay = false;
    }
  });

  // Добавляем пустую строку в конце, если последний элемент был днем недели
  if (isNewDay) {
    formattedSchedule += '\n';
  }

  return formattedSchedule;
};

start();