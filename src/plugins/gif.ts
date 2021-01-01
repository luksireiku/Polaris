import { Bot, Message } from '..';
import { PluginBase } from '../plugin';
import { generateCommandHelp, getInput, random, sendRequest } from '../utils';

export class GifPlugin extends PluginBase {
  constructor(bot: Bot) {
    super(bot);
    this.commands = [
      {
        command: '/gif',
        shortcut: '/g',
        parameters: [
          {
            name: 'query',
            required: false,
          },
        ],
        description: 'Send a GIF for input query',
      },
    ];
  }
  async run(msg: Message): Promise<void> {
    const input = getInput(msg, false);
    if (!input) {
      return this.bot.replyMessage(msg, generateCommandHelp(this, msg.content));
    }
    const url = 'https://api.tenor.com/v1/search';
    const params = {
      q: input,
      key: this.bot.config.apiKeys.tenor,
    };
    const resp = await sendRequest(url, params, null, null, false, this.bot);
    const content = await resp.json();
    if (!content || content['results'] == undefined) {
      return this.bot.replyMessage(msg, this.bot.errors.connectionError);
    }
    if (content.results.length == 0) {
      return this.bot.replyMessage(msg, this.bot.errors.noResults);
    }
    const photo = content.results[random(0, content.results.length - 1)].media[0].webm.url;
    return this.bot.replyMessage(msg, photo, 'animation');
  }
}
