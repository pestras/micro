import * as http from 'http';
import * as cluster from 'cluster';
import { CODES } from '@pestras/toolbox/fetch/codes';
import { LOGLEVEL, Logger } from './logger';
import { toKebabCasing } from './util';
import { WorkersManager, WorkerMessage } from './workers';

export { CODES, LOGLEVEL };

/** Service Type */
export type Service = Readonly<{ [key: string]: any }>;

/** Micro Status Codes */
export enum MICRO_STATUS {
  INIT = -1,
  EXIT = 0,
  LIVE = 1
}

/** Initial Status */
let status: MICRO_STATUS = MICRO_STATUS.INIT;

/** Worker messages listeners interface */
interface ProcessMsgsListeners {
  [key: string]: string;
}

/** Worker Msgs Listeners Repo */
const processMsgsListners: ProcessMsgsListeners = {};

// Globals
let HTTPServer: http.Server;
let service: Service;
let logger = new Logger();

/** Supported HTTP methods */
export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Default CORS Headers */
const DEFAULT_CORS: http.IncomingHttpHeaders & { 'response-code'?: string } = {
  'access-control-allow-methods': "GET,HEAD,OPTIONS,PUT,PATCH,POST,DELETE",
  'access-control-allow-origin': "*",
  'access-control-allow-headers': "*",
  'Access-Control-Allow-Credentials': 'false',
  'response-code': '204'
}

/** Service decorator config interface */
export interface ServiceConfig {
  version?: number;
  kebabCase?: boolean;
  port?: number;
  host?: string;
  workers?: number;
  logLevel?: LOGLEVEL;
  transferLog?: boolean;
  exitOnUnhandledException?: boolean;
  exitOnInhandledRejection?: boolean;
  cors?: http.IncomingHttpHeaders & { 'response-code'?: string };
}

/** Service config object */
let serviceConfig: ServiceConfig & { name: string };

/**
 * Service Decorator
 * accepts all service config
 * @param config 
 */
export function SERVICE(config: ServiceConfig = {}) {
  return (constructor: any) => {
    let cors = Object.assign({}, DEFAULT_CORS);
    let name = config.kebabCase === false ? constructor.name.toLowerCase() : toKebabCasing(constructor.name).toLowerCase();

    serviceConfig = {
      name,
      version: config.version || 0,
      workers: config.workers || 0,
      logLevel: config.logLevel || LOGLEVEL.INFO,
      transferLog: !!config.transferLog,
      exitOnUnhandledException: config.exitOnUnhandledException === undefined ? true : !!config.exitOnUnhandledException,
      exitOnInhandledRejection: config.exitOnInhandledRejection === undefined ? true : !!config.exitOnInhandledRejection,
      port: config.port || 3000,
      host: config.host || '0.0.0.0',
      cors: Object.assign(cors, config.cors || {})
    };
  }
}

/**
 * Worker Msg Decorateor
 * @param processMsg string
 */
export function WORKER_MSG(processMsg: string) {
  return function (target: any, key: string) {
    processMsgsListners[processMsg] = key;
  }
}

/**
 * listen to unhandled rejections an exceptions
 * log error
 * call related listeners if existed
 * exit process if config.exitOnUnhandledException is set to true
 */
process
  .on('unhandledRejection', (reason, p) => {
    logger.error('Unhandled Rejection', { reason });
    if (service && typeof service.onUnhandledRejection === "function") service.onUnhandledRejection(reason, p);
    else if (serviceConfig) serviceConfig.exitOnInhandledRejection && Micro.exit(1, "SIGTERM");
  })
  .on('uncaughtException', err => {
    logger.error('uncaughtException', { err });
    if (service && typeof service.onUnhandledException === "function") service.onUnhandledException(err);
    else if (serviceConfig) serviceConfig.exitOnUnhandledException && Micro.exit(1, "SIGTERM");
  });

/** Service Core Events Interface */
export interface ServiceEvents {
  onHTTPMsg?(msg: http.IncomingMessage, response: http.ServerResponse): void;
  onLog?: (level: LOGLEVEL, msg: string, meta: any) => void;
  onInit?: () => void | Promise<void>;
  onReady?: () => void;
  onExit?: (code: number, signal: NodeJS.Signals) => void;
  onUnhandledRejection?: (reason: any, p: Promise<any>) => void;
  onUnhandledException?: (err: any) => void;
  onHealthcheck?: (res: Response) => void;
  onReadycheck?: (res: Response) => void;
  onLivecheck?: (res: Response) => void;
}

/** Micro Plugin Abstract Class */
export abstract class MicroPlugin {

  abstract init(http: http.Server, service: Readonly<{ [key: string]: any }>): void | Promise<void>;

  onHTTPMsg?(msg: http.IncomingMessage, response: http.ServerResponse): void;

  onExit?(code: number, signal: NodeJS.Signals): void;
}

/**
 * Micro Class:
 * Initialize Plugins
 * Starts Service
 */
export class Micro {
  /** plugins repo */
  private static _plugins: MicroPlugin[] = [];

  static logger = logger;
  static get status() { return status; }

  /**
   * Sends a message to other workers
   * @param msg string
   * @param data any - defaults to null 
   * @param target 'all' | 'others' - defaults to 'others'
   */
  static message(msg: string, data: any = null, target: 'all' | 'others' = 'others') {
    process.send({ message: msg, data, target });
  }

  /**
   * exits process
   * @param code 
   * @param signal 
   */
  static exit(code = 0, signal: NodeJS.Signals = "SIGTERM") {
    status = MICRO_STATUS.EXIT;
    logger.warn(`cleaning up before exit`);

    if (this._plugins.length)
      for (let plugin of this._plugins)
        if (typeof plugin.onExit === 'function') plugin.onExit(code, signal);

    if (typeof service.onExit === 'function') service.onExit(code, signal);

    HTTPServer.close();
    logger.warn(`service exited with signal: ${signal}, code: ${code}`);
    process.exit(code);
  }

  /**
   * Starts this service
   * @param ServiceClass Service
   * @param args any[]
   */
  static async start(ServiceClass: any, ...args: any[]) {
    if (cluster.isMaster && !!serviceConfig.workers) {
      new WorkersManager(logger, serviceConfig.workers);
      return;
    }

    service = new ServiceClass(...args);
    logger.level = serviceConfig.logLevel;

    if (typeof service.log === 'function' && serviceConfig.transferLog)
      logger.transferTo(service);

    if (typeof service.onInit === "function") {
      let promise: Promise<any> = service.onInit();
      if (promise && typeof promise.then === "function") {
        try {
          await promise;
        } catch (error) {
          logger.error(error);
        }
      }
    }

    if (Object.keys(processMsgsListners).length > 0)
      process.on('message', (msg: WorkerMessage) => {
        if (msg.message === 'publish') return;
        let key = processMsgsListners[msg.message];
        if (key && typeof service[key] === "function") service[key](msg.data);
      });

    
    logger.info('initializing Http server');
    logger.info(`route: ${serviceConfig.name}/v${serviceConfig.version}/healthcheck - GET initialized`);
    logger.info(`route: ${serviceConfig.name}/v${serviceConfig.version}/readiness - GET initialized`);
    logger.info(`route: ${serviceConfig.name}/v${serviceConfig.version}/liveness - GET initialized`);
    HTTPServer = http.createServer(async (httpMsg, httpResponse) => {
      logger.info(`${httpMsg.method} - ${httpMsg.url}`);
      httpResponse.once('close', () => {
        if (httpResponse.statusCode < 500) logger.info(`response ${httpResponse.statusCode} ${httpMsg.url}`);
        else logger.error(`response ${httpResponse.statusCode} ${httpMsg.url}`);
      });

      if (httpMsg.method.toLowerCase() === 'get') {
        if (httpMsg.url.indexOf(`${serviceConfig.name}/v${serviceConfig.version}/healthcheck`) > -1) {
          if (typeof service.onHealthcheck === "function") return service.onHealthcheck(httpResponse);
          else return httpResponse.end();
        }
        if (httpMsg.url.indexOf(`${serviceConfig.name}/v${serviceConfig.version}/readiness`) > -1) {
          if (typeof service.onReadycheck === "function") return service.onHealthcheck(httpResponse);
          else return httpResponse.end();
        }
        if (httpMsg.url.indexOf(`${serviceConfig.name}/v${serviceConfig.version}/liveness`) > -1) {
          if (typeof service.onLivecheck === "function") return service.onHealthcheck(httpResponse);
          else return httpResponse.end();
        }
      }

      if (typeof service.onHTTPMsg === "function") {
        return service.onHTTPMsg(httpMsg, httpResponse);

      } else if (this._plugins.length > 0) {
        for (let plugin of this._plugins) {
          if (typeof plugin.onHTTPMsg === 'function') return plugin.onHTTPMsg(httpMsg, httpResponse);
        }
      }

      httpResponse.statusCode = 404;
      httpResponse.end();
    });

    if (this._plugins.length > 0) {
      for (let plugin of this._plugins) {
        if (typeof plugin.init === 'function') {
          let promise = <Promise<void>>plugin.init(HTTPServer, service);
          if (promise && typeof promise.then === 'function') {
            try {
              await promise;
            } catch (error) {
              logger.error(error);
            }
          }
        }
      }
    }

    status = MICRO_STATUS.LIVE;
    if (typeof service.onReady === 'function') service.onReady();

    process.on('SIGTERM', (signal) => Micro.exit(0, signal));
    process.on('SIGHUP', (signal) => Micro.exit(0, signal));
    process.on('SIGINT', (signal) => Micro.exit(0, signal));

    HTTPServer.listen(
      serviceConfig.port,
      serviceConfig.host,
      () => logger.info(`running http server on port: ${serviceConfig.port}, pid: ${process.pid}`));
  }
}