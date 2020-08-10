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

/** Supported HTTP methods */
export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

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
      host: config.host || '0.0.0.0'
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
    Micro.logger.error('Unhandled Rejection', { reason });
    if (Micro.service && typeof Micro.service.onUnhandledRejection === "function") Micro.service.onUnhandledRejection(reason, p);
    else {
      if (p) p.catch(err => Micro.logger.error(err));
      if (serviceConfig) serviceConfig.exitOnInhandledRejection && Micro.exit(1, "SIGTERM");
    }
  })
  .on('uncaughtException', err => {
    Micro.logger.error('uncaughtException', { err });
    if (Micro.service && typeof Micro.service.onUnhandledException === "function") Micro.service.onUnhandledException(err);
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

  abstract init(): void | Promise<void>;

  onHTTPMsg?(msg: http.IncomingMessage, response: http.ServerResponse): void;

  onExit?(code: number, signal: NodeJS.Signals): void;
}

/**
 * Micro Class:
 * Initialize Plugins
 * Starts Service
 */
export class Micro {
  private static _service: Service;
  private static _server: http.Server;
  /** plugins repo */
  private static _plugins: MicroPlugin[] = [];

  static logger = new Logger();
  static get status() { return status; }
  static get service() { return this._service; }
  static get server() { return this._server; }
  static get config() { return serviceConfig as Readonly<ServiceConfig & { name: string }>; }

  static plugin(plugin: MicroPlugin) {
    if (!this._plugins.includes(plugin)) this._plugins.push(plugin);
  }

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
    Micro.logger.warn(`cleaning up before exit`);

    if (this._plugins.length)
      for (let plugin of this._plugins)
        if (typeof plugin.onExit === 'function') plugin.onExit(code, signal);

    if (typeof Micro._service.onExit === 'function') Micro._service.onExit(code, signal);

    this.server.close();
    Micro.logger.warn(`service exited with signal: ${signal}, code: ${code}`);
    process.exit(code);
  }

  /**
   * Starts this service
   * @param ServiceClass Service
   * @param args any[]
   */
  static async start(ServiceClass: any, ...args: any[]) {
    if (cluster.isMaster && !!serviceConfig.workers) {
      new WorkersManager(Micro.logger, serviceConfig.workers);
      return;
    }

    this._service = new ServiceClass(...args);
    Micro.logger.level = serviceConfig.logLevel;

    if (typeof Micro._service.log === 'function' && serviceConfig.transferLog)
      Micro.logger.transferTo(Micro._service);

    if (typeof Micro._service.onInit === "function") {
      let promise: Promise<any> = Micro._service.onInit();
      if (promise && typeof promise.then === "function") {
        try {
          await promise;
        } catch (error) {
          Micro.logger.error(error);
        }
      }
    }

    if (Object.keys(processMsgsListners).length > 0)
      process.on('message', (msg: WorkerMessage) => {
        if (msg.message === 'publish') return;
        let key = processMsgsListners[msg.message];
        if (key && typeof Micro._service[key] === "function") Micro._service[key](msg.data);
      });

    
    Micro.logger.info('initializing Http server');
    this._server = http.createServer(async (httpMsg, httpResponse) => {
      Micro.logger.info(`${httpMsg.method} - ${httpMsg.url}`);
      httpResponse.once('close', () => {
        if (httpResponse.statusCode < 500) Micro.logger.info(`response ${httpResponse.statusCode} ${httpMsg.url}`);
        else Micro.logger.error(`response ${httpResponse.statusCode} ${httpMsg.url}`);
      });

      if (httpMsg.method.toLowerCase() === 'get') {
        if (httpMsg.url.indexOf(`${serviceConfig.name}/v${serviceConfig.version}/healthcheck`) > -1) {
          if (typeof Micro._service.onHealthcheck === "function") return Micro._service.onHealthcheck(httpResponse);
          else return httpResponse.end();
        }
        if (httpMsg.url.indexOf(`${serviceConfig.name}/v${serviceConfig.version}/readiness`) > -1) {
          if (typeof Micro._service.onReadycheck === "function") return Micro._service.onHealthcheck(httpResponse);
          else return httpResponse.end();
        }
        if (httpMsg.url.indexOf(`${serviceConfig.name}/v${serviceConfig.version}/liveness`) > -1) {
          if (typeof Micro._service.onLivecheck === "function") return Micro._service.onHealthcheck(httpResponse);
          else return httpResponse.end();
        }
      }

      if (typeof Micro._service.onHTTPMsg === "function") {
        return Micro._service.onHTTPMsg(httpMsg, httpResponse);

      } else if (this._plugins.length > 0) {
        for (let plugin of this._plugins) {
          if (typeof plugin.onHTTPMsg === 'function') return plugin.onHTTPMsg(httpMsg, httpResponse);
        }
      }

      httpResponse.statusCode = 404;
      httpResponse.end();
    });
    
    Micro.logger.info(`route: ${serviceConfig.name}/v${serviceConfig.version}/healthcheck - GET initialized`);
    Micro.logger.info(`route: ${serviceConfig.name}/v${serviceConfig.version}/readiness - GET initialized`);
    Micro.logger.info(`route: ${serviceConfig.name}/v${serviceConfig.version}/liveness - GET initialized`);

    if (this._plugins.length > 0) {
      for (let plugin of this._plugins) {
        if (typeof plugin.init === 'function') {
          let promise = <Promise<void>>plugin.init();
          if (promise && typeof promise.then === 'function') {
            try {
              await promise;
            } catch (error) {
              Micro.logger.error(error);
            }
          }
        }
      }
    }

    status = MICRO_STATUS.LIVE;
    if (typeof Micro._service.onReady === 'function') Micro._service.onReady();

    process.on('SIGTERM', (signal) => Micro.exit(0, signal));
    process.on('SIGHUP', (signal) => Micro.exit(0, signal));
    process.on('SIGINT', (signal) => Micro.exit(0, signal));

    Micro._server.listen(
      serviceConfig.port,
      serviceConfig.host,
      () => Micro.logger.info(`running http server on port: ${serviceConfig.port}, pid: ${process.pid}`));
  }
}