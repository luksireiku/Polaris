import { exec } from 'child_process';
import fs from 'fs';
import mime from 'mime-types';
import fetch, { BodyInit, HeadersInit, RequestInit, Response } from 'node-fetch';
import { pipeline } from 'stream';
import tmp from 'tmp';
import util from 'util';
import { createLogger, format, transports } from 'winston';
import { Bot, Message, PluginBase } from '.';
import { db } from './main';

export function isOwner(bot: Bot, uid: number | string, msg: Message = null): boolean {
  return hasTag(bot, uid, 'owner') || msg.sender.id == bot.config.owner;
}

export async function isAdmin(bot: Bot, uid: number | string, msg: Message = null): Promise<boolean> {
  return hasTag(bot, uid, 'admin') || (await isGroupAdmin(bot, uid, msg));
}

export async function isMod(bot: Bot, uid: number | string, gid: number | string): Promise<boolean> {
  if (typeof uid != 'string') {
    uid = String(uid);
  }

  if (hasTag(bot, uid, 'globalmod') || hasTag(bot, uid, `mod:${gid}`)) {
    return true;
  } else {
    return false;
  }
}

export async function isGroupAdmin(bot: Bot, uid: number | string, msg: Message = null): Promise<boolean> {
  if (typeof uid != 'string') {
    uid = String(uid);
  }
  if (msg && +msg.conversation.id < 0) {
    const chatAdmins = await bot.getChatAdmins(msg.conversation.id);
    for (const admin of chatAdmins) {
      if (uid == String(admin.id)) return true;
    }
  }

  return false;
}

export function isTrusted(bot: Bot, uid: number | string, msg: Message = null): boolean {
  return hasTag(bot, uid, 'trusted') || isOwner(bot, uid, msg);
}

export function getTags(bot: Bot, target: number | string, tagFilter?: string): string[] {
  if (typeof target != 'string') {
    target = String(target);
  }
  if (db.tags[target] !== undefined) {
    const tags = [];
    for (const i in db.tags[target]) {
      const tag = db.tags[target][i];
      const regex = new RegExp('(@w+:)', 'gim');
      if (tagFilter && tagFilter.indexOf('?') > -1 && !tag.startsWith(tagFilter.split('?')[0])) {
        continue;
      }
      if (regex.test(tag)) {
        const inputMatch = regex.exec(tag);
        if (inputMatch[1] === bot.config.name) {
          tags.push(tag.replace(regex, ''));
        }
      } else {
        tags.push(tag);
      }
    }
    return tags;
  } else {
    return [];
  }
}

export function hasTag(bot: Bot, target: number | string, tag: string): boolean {
  if (typeof target != 'string') {
    target = String(target);
  }
  const tags = getTags(bot, target);
  if (tags && tag.indexOf('?') > -1) {
    for (const targetTag of tags) {
      if (targetTag.startsWith(tag.split('?')[0])) {
        return true;
      }
    }
    return false;
  } else if (tags && tags.indexOf(tag) > -1) {
    return true;
  } else {
    return false;
  }
}

export function setTag(bot: Bot, target: number | string, tag: string): void {
  if (typeof target != 'string') {
    target = String(target);
  }
  const tags = getTags(bot, target);
  if (tags && tags.indexOf(tag) == -1) {
    db.tagsSnap.child(target).child(String(tags.length)).ref.set(tag);
  }
}

export function delTag(bot: Bot, target: number | string, tag: string): void {
  if (typeof target != 'string') {
    target = String(target);
  }
  const tags = getTags(bot, target);
  if (tags && tag.indexOf('?') > -1) {
    for (const targetTag of tags) {
      if (targetTag.startsWith(tag.split('?')[0])) {
        db.tagsSnap
          .child(target)
          .child(String(tags.indexOf(targetTag)))
          .ref.set(null);
      }
    }
  } else if (tags && tags.indexOf(tag) > -1) {
    db.tagsSnap
      .child(target)
      .child(String(tags.indexOf(tag)))
      .ref.set(null);
  }
}

export function isInt(number: number | string): boolean {
  if (typeof number == 'number') {
    return true;
  } else if (typeof number != 'string') {
    return false;
  }
  return !isNaN(parseFloat(number));
}

export function escapeRegExp(str: string): string {
  return str.replace(/[-\\^$*+?.()|[\]{}]/g, '\\$&');
}

export function getTarget(bot: Bot, m: Message, input: string): string {
  if (input) {
    const target = getWord(input, 1);
    if (isInt(target)) {
      return String(target);
    } else if (target.startsWith('@')) {
      if (bot.user.username.toLowerCase() == target.substr(1).toLowerCase()) {
        return String(bot.user.id);
      }
      for (const uid in db.users) {
        if (
          db.users[uid]['username'] !== undefined &&
          db.users[uid]['username'].toLowerCase() == target.substr(1).toLowerCase()
        ) {
          return uid;
        }
      }
      for (const gid in db.groups) {
        if (
          db.groups[gid]['username'] !== undefined &&
          db.groups[gid]['username'].toLowerCase() == target.substr(1).toLowerCase()
        ) {
          return gid;
        }
      }
    } else if (target.startsWith('<@')) {
      target.replace(new RegExp('<@!?([d]+)>', 'gim'), '$1');
    } else if (target == '-g') {
      return String(m.conversation.id);
    } else {
      for (const uid in db.users) {
        let name = '';
        if (db.users[uid].first_name !== undefined) {
          name += db.users[uid].first_name;
        }
        if (db.users[uid].last_name !== undefined) {
          name += ' ' + db.users[uid].last_name;
        }
        if (new RegExp(target, 'gim').test(name)) {
          return uid;
        }
      }
      for (const gid in db.groups) {
        if (new RegExp(target, 'gim').test(db.groups[gid].title)) {
          return gid;
        }
      }
    }
    return target;
  } else if (m.reply) {
    return String(m.reply.sender.id);
  } else {
    return String(m.sender.id);
  }
}

export function capitalize(text: string): string {
  if (text) {
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }
  return null;
}

export function getWord(text: string, i: number): string {
  if (text && text.indexOf(' ') > -1) {
    return text.split(' ')[i - 1];
  } else if (text && text.indexOf(' ') == -1 && i == 1) {
    return text;
  } else {
    return null;
  }
}

export function allButNWord(text: string, word = 1): string {
  if (!text || text.indexOf(' ') == -1) {
    return null;
  }
  return text.substr(text.indexOf(text.split(' ')[word]));
}

export function getUsername(uid: number | string): string {
  if (typeof uid != 'string') {
    uid = String(uid);
  }
  let name = '';
  if (db.users[uid] !== undefined) {
    if (db.users[uid]['first_name'] !== undefined) {
      name += ' ' + db.users[uid].first_name;
    }
    if (db.users[uid]['last_name'] !== undefined) {
      name += ' ' + db.users[uid].last_name;
    }
    if (db.users[uid]['username'] !== undefined) {
      name = `@${db.users[uid].username}`;
    }
  } else if (db.groups[uid] !== undefined) {
    name = db.groups[uid].title;
    if (db.groups[uid]['username'] !== undefined) {
      name = `@${db.groups[uid].username}`;
    }
  } else {
    name = '[UNKNOWN]';
  }
  return name;
}

export function setInput(message: Message, trigger: string): Message {
  if (message.type == 'text') {
    // Get the text that is next to the pattern
    const inputMatch = new RegExp(`${trigger}(.+)$`, 'gim').exec(message.content);
    if (inputMatch && inputMatch.length > 0) {
      if (inputMatch[1].startsWith(' ')) {
        message.extra.input = inputMatch[1].slice(1);
      } else {
        message.extra.input = inputMatch[1];
      }
    }

    // Get the text that is next to the pattern
    if (message.reply && message.reply.content) {
      const inputMatch = new RegExp(`${trigger}(.+)$`, 'gim').exec(
        String(message.content) + ' ' + String(message.reply.content),
      );
      if (inputMatch && inputMatch.length > 0) {
        if (inputMatch[1].startsWith(' ')) {
          message.extra.inputReply = inputMatch[1].slice(1);
        } else {
          message.extra.inputReply = inputMatch[1];
        }
      }
    } else if ('input' in message.extra) {
      message.extra.inputReply = message.extra.input;
    }
  }
  return message;
}

export function getInput(message: Message, ignoreReply = true): string {
  if (Object.keys(message.extra).length > 0) {
    if (ignoreReply && 'input' in message.extra) {
      return message.extra.input;
    } else if (!ignoreReply && 'inputReply' in message.extra) {
      return message.extra.inputReply;
    }
  }
  return null;
}
export function isCommand(plugin: PluginBase, number: number, text: string): boolean {
  if (typeof text == 'string' && text.endsWith(`@${plugin.bot.user.username}`) && text.indexOf(' ') > -1) {
    text = text.replace(`@${plugin.bot.user.username}`, '');
  }

  let trigger = null;

  if (number - 1 < plugin.commands.length && 'command' in plugin.commands[number - 1]) {
    if (
      (plugin.commands[number - 1].command == '/start' && text.indexOf('/start') > -1) ||
      (plugin.commands[number - 1].command == '/help' && text.indexOf('/help') > -1)
    ) {
      trigger = plugin.commands[number - 1].command.replace('/', '^/');
    } else {
      if (text[0] == '/' && 'keepDefault' in plugin.commands[number - 1] && plugin.commands[number - 1].keepDefault) {
        trigger = plugin.commands[number - 1].command.replace('/', '^/');
      } else {
        trigger = plugin.commands[number - 1].command
          .replace('/', escapeRegExp(plugin.bot.config.prefix))
          .toLocaleLowerCase();
      }
    }

    if (plugin.commands[number - 1].parameters == null && trigger.startsWith('^')) {
      trigger += '$';
    } else if (plugin.commands[number - 1].parameters !== null && text.indexOf(' ') == -1) {
      trigger += '$';
    } else if (plugin.commands[number - 1].parameters !== null && text.indexOf(' ') > -1) {
      trigger += ' ';
    }
    if (new RegExp(trigger, 'gim').test(text)) {
      return true;
    }
  }

  if ('friendly' in plugin.commands[number - 1]) {
    trigger = plugin.commands[number - 1].friendly;
    if (new RegExp(trigger, 'gim').test(text)) {
      return true;
    }
  }
  if ('shortcut' in plugin.commands[number - 1]) {
    trigger = plugin.commands[number - 1].shortcut
      .replace('/', escapeRegExp(plugin.bot.config.prefix))
      .toLocaleLowerCase();

    if (plugin.commands[number - 1].parameters == null && trigger.startsWith('^')) {
      trigger += '$';
    } else if (plugin.commands[number - 1].parameters !== null && text.indexOf(' ') == -1) {
      trigger += '$';
    } else if (plugin.commands[number - 1].parameters !== null && text.indexOf(' ') > -1) {
      trigger += ' ';
    }
    if (new RegExp(trigger, 'gim').test(text)) {
      return true;
    }
  }
  return false;
}

export function getCommandIndex(plugin: PluginBase, text: string): number {
  if (typeof text == 'string' && text.endsWith(`@${plugin.bot.user.username}`) && text.indexOf(' ') > -1) {
    text = text.replace(`@${plugin.bot.user.username}`, '');
  }

  text = text.replace('/', plugin.bot.config['prefix']);

  for (const i in plugin.commands) {
    if (isCommand(plugin, parseInt(i) + 1, text)) {
      return parseInt(i);
    }
  }

  return null;
}

export function generateCommandHelp(plugin: PluginBase, text: string, showHidden = true): string {
  const index = getCommandIndex(plugin, text);
  if (index == null) {
    return null;
  }

  const command = plugin.commands[index];
  if (!showHidden && 'hidden' in command && command.hidden) {
    return null;
  }

  let doc = command['command'].replace('/', plugin.bot.config.prefix);

  if ('parameters' in command && command.parameters) {
    for (const i in command.parameters) {
      // Bold for required parameters, and italic for optional
      if (command.parameters[i].required) {
        doc += ` <b>&lt;${command.parameters[i].name}&gt;</b>`;
      } else {
        doc += ` [${command.parameters[i].name}]`;
      }
    }
  }

  if ('description' in command) {
    doc += `\n<i>${command.description}</i>`;
  }

  return doc;
}

export async function sendRequest(
  url: string,
  params: Record<string, unknown> = {},
  headers?: HeadersInit,
  data?: BodyInit,
  post?: boolean,
  bot?: Bot,
): Promise<Response> {
  const queryString = Object.keys(params)
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  const options: RequestInit = {
    method: post ? 'POST' : 'GET',
    body: data,
    headers: headers,
  };
  try {
    const fullUrl = `${url}?${queryString}`;
    const response = await fetch(fullUrl, options);
    if (response.status != 200) {
      const error = response.clone();
      const json = error.json().catch((e) => catchException(e));
      logger.error(JSON.stringify(json));
      if (bot) {
        bot.sendAlert(JSON.stringify(json));
      }

      if (error.status == 429) {
        setTimeout(async () => {
          await sendRequest(url, params, headers, data, post, bot);
        }, 5000);
      }
    }
    return response;
  } catch (e) {
    catchException(e);
    return null;
  }
}

export async function responseUrlFromRequest(
  url: string,
  params: Record<string, unknown> = {},
  headers?: HeadersInit,
): Promise<string> {
  const response = await sendRequest(url, params, headers);
  return response.url;
}

export async function download(
  url: string,
  params: Record<string, unknown> = {},
  headers?: HeadersInit,
  post?: boolean,
): Promise<string> {
  const response = await sendRequest(url, params, headers, null, post);
  const tempfile = tmp.fileSync({ mode: 0o644, postfix: `.${mime.extension(response.headers.get('Content-Type'))}` });
  if (!response.ok) {
    logger.error(`unexpected response ${response.statusText}`);
    return null;
  }
  const streamPipeline = util.promisify(pipeline);
  await streamPipeline(response.body, fs.createWriteStream(tempfile.name));
  logger.info(`Downloaded file: ${tempfile.name}`);
  return tempfile.name;
}

export function getExtension(url: string): string {
  const filename = url.split('#').shift().split('?').shift().split('/').pop();
  if (filename.indexOf('.') > -1) {
    return `.${filename.split('.').pop()}`;
  } else {
    return '';
  }
}

export async function mp3ToOgg(input: string): Promise<string> {
  try {
    const output = tmp.fileSync({ mode: 0o644, postfix: `.ogg` });
    const command = `ffmpeg -i ${input} -ac 1 -c:a libopus -b:a 16k -y ${output.name}`;
    const result = await execResult(command);
    if (result != null) {
      logger.info(`Converted mp3 file to ogg: ${output.name}`);
      return output.name;
    }
    return null;
  } catch (e) {
    catchException(e);
    return null;
  }
}

export function removeHtml(text: string): string {
  return text.replace(new RegExp('<[^<]+?>', 'gim'), '');
}

export function replaceHtml(text: string): string {
  text = text.replace(new RegExp('&lt;', 'gim'), '<');
  text = text.replace(new RegExp('&gt;', 'gim'), '>');
  return text;
}

export function htmlToDiscordMarkdown(text: string): string {
  const replacements = [
    { pattern: '<code class="language-([\\w]+)">([\\S\\s]+)</code>', sub: '```$1\n$2```' },
    // {pattern: '<a href=\"(.[^\<]+)\">(.[^\<]+)</a>', sub: '[$2]($1)'},
    { pattern: '<a href="(.[^<]+)">(.[^<]+)</a>', sub: '$1' },
    { pattern: '<[/]?i>', sub: '_' },
    { pattern: '<[/]?b>', sub: '**' },
    { pattern: '<[/]?u>', sub: '__' },
    { pattern: '<[/]?code>', sub: '`' },
    { pattern: '<[/]?pre>', sub: '```' },
  ];

  for (const rep of replacements) {
    text = text.replace(new RegExp(rep['pattern'], 'gim'), rep['sub']);
  }

  text = replaceHtml(text);
  return text;
}

export function splitLargeMessage(content: string, maxLength: number): string[] {
  const lineBreak = '\n';
  const lines = content.split(lineBreak);
  const texts = [];
  let text = '';
  let length = 0;

  for (const line of lines) {
    if (length + line.length + lineBreak.length < maxLength) {
      text += line + lineBreak;
      length += line.length + lineBreak.length;
    } else {
      texts.push(text);
      text = line + lineBreak;
      length += line.length + lineBreak.length;
    }
  }
  return texts;
}

export function now(): number {
  return new Date().getTime() / 1000;
}

export function catchException(exception: Error, bot: Bot = null): void {
  logger.info(`Catched exception: ${exception.message}`);
  logger.error(`${exception.message}`);
  if (bot) {
    if (exception.message != 'Chat not found') {
      if (exception.stack) {
        bot.sendAlert(`${exception.stack}`);
      } else {
        bot.sendAlert(`${exception.message}`);
      }
    }
  }
}

// Configure logger
export const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [
    new transports.Console({
      format: format.combine(format.simple(), format.colorize()),
    }),
    new transports.File({ filename: 'error.log', level: 'error' }),
    new transports.File({ filename: 'combined.log' }),
  ],
});

export async function execResult(command: string): Promise<string> {
  try {
    const { stdout } = await util.promisify(exec)(command);
    return stdout;
  } catch (e) {
    catchException(e);
    return null;
  }
}
