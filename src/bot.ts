import { EventEmitter } from 'events';
import * as bindings from './bindings/index';
import { BindingsBase, Config, Extra, Message, PluginBase, User } from './index';
import { logger } from './main';
import { Parameter } from './plugin';
import * as plugins from './plugins/index';
import { hasTag, isTrusted, setInput } from './utils';

export class Bot {
  config: Config;
  bindings: BindingsBase;
  inbox: EventEmitter;
  outbox: EventEmitter;
  started: boolean;
  plugins: PluginBase[];
  user: User;

  constructor(config: Config) {
    this.inbox = new EventEmitter();
    this.outbox = new EventEmitter();
    this.config = config;
    this.bindings = new bindings[this.config.bindings](this);
    this.plugins = [];
  }

  async start(): Promise<void> {
    this.started = true;
    this.inbox.on('message', (msg: Message) => this.messagesHandler(msg));
    this.outbox.on('message', (msg: Message) => {
      logger.info(
        ` [${this.user.id}] ${this.user.firstName}@${msg.conversation.title} [${msg.conversation.id}] sent [${msg.type}] ${msg.content}`,
      );
    });
    this.plugins = this.initPlugins();
    await this.bindings.start();
    this.user = await this.bindings.getMe();
    logger.info(`Connected as ${this.user.firstName} (@${this.user.username}) [${this.user.id}]`);
  }

  async stop(): Promise<void> {
    logger.info('stop');
  }

  messagesHandler(msg: Message): void {
    if (msg.sender instanceof User) {
      logger.info(
        `[${msg.sender.id}] ${msg.sender.firstName}@${msg.conversation.title} [${msg.conversation.id}] sent [${msg.type}] ${msg.content}`,
      );
    } else {
      logger.info(
        `[${msg.sender.id}] ${msg.sender.title}@${msg.conversation.title} [${msg.conversation.id}] sent [${msg.type}] ${msg.content}`,
      );
    }

    this.onMessageReceive(msg);
  }

  initPlugins(): PluginBase[] {
    const _plugins = [];
    for (const plugin in plugins) {
      _plugins.push(plugins[plugin]);
    }
    return _plugins;
  }

  onMessageReceive(msg: Message): void {
    let ignoreMessage = false;
    if (msg.content == null || (msg.type != 'inline_query' && msg.date < new Date().getTime() / 1000 - 60 * 5)) {
      return;
    }

    if (
      msg.sender.id != +this.config.owner &&
      !isTrusted(this, msg.sender.id, msg) &&
      (hasTag(this, msg.conversation.id, 'muted') || hasTag(this, msg.sender.id, 'muted'))
    ) {
      ignoreMessage = true;
    }

    for (const pluginName in this.plugins) {
      const plugin = this.plugins[pluginName];
      if ('always' in plugin) {
        plugin.always(msg);
      }
      if ('commands' in plugin && !ignoreMessage) {
        for (const i in plugin.commands) {
          const command = plugin.commands[i];
          if ('command' in command) {
            if (this.checkTrigger(command.command, command.parameters, msg, plugin)) {
              break;
            }

            if ('keepDefault' in command && command.keepDefault) {
              if (this.checkTrigger(command.command, command.parameters, msg, plugin, false, true)) {
                break;
              }
            }
          }

          if (
            'friendly' in command &&
            !hasTag(this, msg.sender.id, 'noreplies') &&
            !hasTag(this, msg.conversation.id, 'noreplies') &&
            msg.conversation.id != +this.config.alertsConversationId &&
            msg.conversation.id != +this.config.adminConversationId
          ) {
            if (this.checkTrigger(command.friendly, command.parameters, msg, plugin, true)) {
              break;
            }
          }

          if ('shortcut' in command) {
            if (this.checkTrigger(command.shortcut, command.parameters, msg, plugin)) {
              break;
            }

            if ('keepDefault' in command && command.keepDefault) {
              if (this.checkTrigger(command.shortcut, command.parameters, msg, plugin, false, true)) {
                break;
              }
            }
          }
        }
      }
    }
  }

  checkTrigger(
    command: string,
    parameters: Parameter[],
    message: Message,
    plugin: PluginBase,
    friendly = false,
    keepDefault = false,
  ): boolean {
    command = command.toLocaleLowerCase();
    if (
      typeof message.content == 'string' &&
      message.content.endsWith('@' + this.user.username) &&
      /\s/.test(message.content)
    ) {
      message.content = message.content.replace('@' + this.user.username, '');
    }

    // If the commands are not /start or /help, set the correct command start symbol.
    let trigger = null;
    if (
      typeof message.content == 'string' &&
      ((command == '/start' && '/start'.indexOf(message.content) > -1) ||
        (command == '/help' && '/help'.indexOf(message.content) > -1) ||
        (command == '/config' && '/config'.indexOf(message.content) > -1))
    ) {
      trigger = command.replace('/', '^/');
    } else {
      if (keepDefault) {
        trigger = command.replace('/', '^/');
      } else {
        trigger = command.replace('/', '^' + this.config.prefix);
      }

      if (!friendly) {
        trigger = trigger.replace('@' + this.user.username.toLocaleLowerCase(), '');
        if (parameters && trigger.startswith('^')) {
          trigger += '$';
        } else if (
          parameters &&
          message.content != null &&
          typeof message.content == 'string' &&
          ' '.indexOf(message.content) == -1
        ) {
          trigger += '$';
        } else if (
          parameters &&
          message.content != null &&
          typeof message.content == 'string' &&
          ' '.indexOf(message.content) > -1
        ) {
          trigger += ' ';
        }
      }

      if (message.content && typeof message.content == 'string' && /trigger/gi.test(message.content)) {
        message = setInput(message, trigger);
        plugin.run(message);

        return true;
      }
    }
    return false;
  }

  replyMessage(msg: Message, content: string, type = 'text', reply: Message = null, extra: Extra = null): void {
    const message = new Message(null, msg.conversation, this.user, content, type, null, reply, extra);
    this.outbox.emit('message', message);
  }
}
