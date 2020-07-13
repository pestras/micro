/**
 * Log Levels
 */
export enum LOGLEVEL {
  ERROR = 1,
  WARN,
  INFO,
  DEBUG
}

enum COLOR {
  RESET = "\x1b[0m",
  BRIGHT = "\x1b[1m",
  DIM = "\x1b[2m",
  UNDERSCORE = "\x1b[4m",
  BLINK = "\x1b[5m",
  REVERSE = "\x1b[7m",
  HIDDEN = "\x1b[8m",

  BLACK = "\x1b[30m",
  RED = "\x1b[31m",
  ERROR = "\x1b[31m",
  GREEN = "\x1b[32m",
  DATE = "\x1b[32m",
  YELLOW = "\x1b[33m",
  WARN = "\x1b[33m",
  BLUE = "\x1b[34m",
  MAGENTA = "\x1b[35m",
  CYAN = "\x1b[36m",
  INFO = "\x1b[36m",
  WHITE = "\x1b[37m",

  BGBLACK = "\x1b[40m",
  BGRED = "\x1b[41m",
  BGGREEN = "\x1b[42m",
  BGYELLOW = "\x1b[43m",
  BGBLUE = "\x1b[44m",
  BGMAGENTA = "\x1b[45m",
  BGCYAN = "\x1b[46m",
  BGWHITE = "\x1b[47m",
  DEBUG = "\x1b[42m"
}

/**
 * Log function that logs to the console unless the service implements log method that will be called instead
 * @param mode {LogMode}
 * @param msg {Any}
 * @param meta {LogMeta}
 */
export class Logger {
  private context: any = this;
  level = LOGLEVEL.ERROR;

  transferTo(logger: any) {
    this.context = logger;
  }

  private stringify(data: any) {
    if (typeof data === 'object' || Array.isArray(data)) return JSON.stringify(data, null, 2);
    return data;
  }

  onLog(mode: LOGLEVEL, msg: any, meta?: any) {
    let color = (<any>COLOR)[LOGLEVEL[mode]];
    console[<'log'>LOGLEVEL[mode].toLowerCase()](`${color}%s${COLOR.RESET} %s${COLOR.DATE} %s${COLOR.RESET}`, `[${LOGLEVEL[mode]}: ${process.pid}]`, msg, new Date().toTimeString());
    !!meta && console[<'log'>LOGLEVEL[mode].toLowerCase()](`${color}%s${COLOR.RESET} %s${COLOR.DATE} %s${COLOR.RESET}`, `[${LOGLEVEL[mode]}: ${process.pid}]`, this.stringify(meta), new Date().toTimeString());
    if (mode === LOGLEVEL.ERROR && msg.stack) console.error(`${COLOR.ERROR}%s${COLOR.RESET}`, `[ERROR: ${process.pid}]`, this.stringify(msg.stack));
  }

  debug(msg: any, meta?: any) {
    (LOGLEVEL.DEBUG <= this.level) && (<Logger>this.context).onLog(LOGLEVEL.DEBUG, msg, meta);
  }

  info(msg: any, meta?: any) {
    (LOGLEVEL.INFO <= this.level) && (<Logger>this.context).onLog(LOGLEVEL.INFO, msg, meta);
  }

  warn(msg: any, meta?: any) {
    (LOGLEVEL.WARN <= this.level) && (<Logger>this.context).onLog(LOGLEVEL.WARN, msg, meta);
  }

  error(msg: any, meta?: any) {
    (LOGLEVEL.ERROR <= this.level) && (<Logger>this.context).onLog(LOGLEVEL.ERROR, msg, meta);
  }
}