import * as cluster from 'cluster';
import { LOGLEVEL, Logger } from './logger';
import { WorkersManager, WorkerMessage } from './workers';
import { writeFile } from 'fs';
import { join } from 'path';

const HEALTH_CHECK_DIR = process.env.HEALTH_CHECK_DIR || "";

export { LOGLEVEL };

export interface HealthState {
  healthy?: boolean;
  ready?: boolean;
  live?: boolean;
}

/**
 * Service Interface
 */
interface Service extends HealthState {
  [key: string]: any;
}

/** Micro Status Codes */
export enum MICRO_STATUS {
  INIT = -1,
  EXIT = 0,
  LIVE = 1
}

/** Initial Status */
let status: MICRO_STATUS = MICRO_STATUS.INIT;

/** Service decorator config interface */
export interface ServiceConfig {
  stdin?: boolean;
  workers?: number;
  logLevel?: LOGLEVEL;
  transferLog?: boolean;
  healthCheck?: boolean;
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
    serviceConfig = {
      name: constructor.name.toLowerCase(),
      stdin: !!config.stdin,
      workers: config.workers || 0,
      logLevel: config.logLevel || LOGLEVEL.INFO,
      healthCheck: config.healthCheck === undefined ? true : config.healthCheck,
      transferLog: !!config.transferLog
    };
  }
}

/** Worker messages listeners interface */
interface ProcessMsgsListeners {
  [key: string]: {
    service: any;
    key: string;
  };
}

/** Worker Msgs Listeners Repo */
const processMsgsListners: ProcessMsgsListeners = {};

/**
 * Worker Msg Decorateor
 * @param processMsg string
 */
export function WORKER_MSG(processMsg: string) {
  return function (target: any, key: string) {
    processMsgsListners[processMsg] = { key, service: target.constructor };
  }
}

/** Shared methods map */
const sharedMethodsMap: { [key: string]: Set<string>; } = {}


/** Helps Sharing methods between service and sub services */
export function STORE() {
  return function (target: any, key: string) {
    sharedMethodsMap[target.constructor.name] = sharedMethodsMap[target.constructor.name] || new Set();
    sharedMethodsMap[target.constructor.name].add(key);
  }
}

/**
 * listen to unhandled rejections an exceptions
 * log error
 * call related listeners if existed
 * exit process if config.exitOnUnhandledException is set to true
 */
process
  .on('unhandledRejection', (reason: any, p) => {
    !!reason && Micro.logger.error(reason);

    if (p) {
      p.catch(err => {
        Micro.logger.error(err)
        Micro.exit(1, "SIGTERM");
      });

    } else
      Micro.exit(1, "SIGTERM");
  })
  .on('uncaughtException', err => {
    Micro.logger.error(err);
    Micro.exit(1, "SIGTERM");
  });

/** Service Core Events Interface */
export interface ServiceEvents {
  onLog?: (level: LOGLEVEL, msg: string, meta: any) => void;
  onInit?: () => void | Promise<void>;
  onReady?: () => void;
  onExit?: (code: number, signal: NodeJS.Signals) => void;
  onStdin?: (chunk: Buffer) => void;
}

export interface SubServiceEvents {
  onInit?: () => void | Promise<void>;
  onReady?: () => void;
  onExit?: (code: number, signal: NodeJS.Signals) => void;
  onStdin?: (chunk: Buffer) => void;
}

/** Micro Plugin Abstract Class */
export abstract class MicroPlugin implements HealthState {

  public healthy = false;
  public ready = false;
  public live = false;

  abstract init(): void | Promise<void>;

  onStdin?: (chunk: Buffer) => void;
  onReady?: () => void;
  onExit?(code: number, signal: NodeJS.Signals): void;
}

/**
 * Micro Class:
 * Initialize Plugins
 * Starts Service
 */
export class Micro {
  private static _lastHealthState: HealthState = { healthy: false, ready: false, live: false };
  private static _isHealthy = false;
  private static _service: Service;
  private static _subServicesList: Service[] = [];
  /** plugins repo */
  private static _plugins: MicroPlugin[] = [];

  static logger = new Logger();
  static get status() { return status; };
  static get service() { return this._service as Readonly<Service>; };
  static get subServices() { return this._subServicesList as Readonly<Service[]>; };
  static get config() { return serviceConfig as Readonly<ServiceConfig & { name: string }>; };

  private static _updateHealthState() {
    let newState: HealthState = { healthy: true, ready: true, live: true };

    if (Micro._plugins) {
      for (let plugin of Micro._plugins) {
        newState.healthy = newState.healthy ? (plugin.healthy === undefined ? true : plugin.healthy) : false;
        newState.ready = newState.ready ? (plugin.ready === undefined ? true : plugin.ready) : false;
        newState.live = newState.live ? (plugin.live === undefined ? true : plugin.live) : false;
      }
    }

    newState.healthy = newState.healthy ? (Micro.service.healthy === undefined ? true : Micro.service.healthy) : false;
    newState.ready = newState.ready ? (Micro.service.ready === undefined ? true : Micro.service.ready) : false;
    newState.live = newState.live ? (Micro.service.live === undefined ? true : Micro.service.live) : false;

    if (Micro.subServices) {
      for (let subService of Micro.subServices) {
        newState.healthy = newState.healthy ? (subService.healthy === undefined ? true : subService.healthy) : false;
        newState.ready = newState.ready ? (subService.ready === undefined ? true : subService.ready) : false;
        newState.live = newState.live ? (subService.live === undefined ? true : subService.live) : false;
      }
    }

    if (newState.healthy !== Micro._lastHealthState.healthy || newState.ready !== Micro._lastHealthState.ready || newState.live !== Micro._lastHealthState.live) {
      Micro._isHealthy = Micro._lastHealthState.healthy && Micro._lastHealthState.ready && Micro._lastHealthState.live;
      writeFile(join(HEALTH_CHECK_DIR, "__health"), JSON.stringify(newState), { mode: 664 }, (e) => {
        if (e) Micro.logger.error(e, "error updating health state");
        setTimeout(Micro._updateHealthState, Micro._isHealthy ? 10000 : 1000);
      });
    }
  }

  static readonly store: { [key: string]: any } = {};

  static plugin(plugin: MicroPlugin) {
    if (!Micro._plugins.includes(plugin)) Micro._plugins.push(plugin);
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

  static getCurrentService(constructor: any) {
    if (this._service?.constructor === constructor) return this._service;
    for (let subService of this._subServicesList) if (subService.constructor === constructor) return subService;
    return null;
  }

  /**
   * exits process
   * @param code 
   * @param signal 
   */
  static exit(code = 0, signal: NodeJS.Signals = "SIGTERM") {
    status = MICRO_STATUS.EXIT;
    Micro.logger.info(`cleaning up before exit`);

    if (Micro._plugins)
      for (let plugin of Micro._plugins)
        if (typeof plugin.onExit === 'function') plugin.onExit(code, signal);

    if (typeof Micro._service.onExit === 'function') Micro._service.onExit(code, signal);

    for (let subService of Micro._subServicesList)
      if (typeof subService.onExit === "function") subService.onExit(code, signal);

    Micro.logger.warn(`service exited with signal: ${signal}, code: ${code}`);
    process.exit(code);
  }

  /**
   * Starts this service
   * @param ServiceClass Service
   * @param args any[]
   */
  static async start(ServiceClass: any, subServices?: any[]) {
    if (cluster.isMaster && !!serviceConfig.workers) {
      new WorkersManager(Micro.logger, serviceConfig.workers);
      return;
    }

    this._service = new ServiceClass();
    Micro.logger.level = serviceConfig.logLevel;

    if (sharedMethodsMap[this._service.constructor.name])
      for (let key of sharedMethodsMap[this._service.constructor.name])
        Micro.store[key] = this._service[key].bind(this._service);

    if (subServices?.length > 0) {
      for (let subService of subServices) {
        let s = new subService();
        this._subServicesList.push(s);

        if (sharedMethodsMap[s.constructor.name])
          for (let key of sharedMethodsMap[s.constructor.name])
            Micro.store[key] = s[key].bind(s);
      }
    }

    if (typeof Micro._service.log === 'function' && serviceConfig.transferLog)
      Micro.logger.transferTo(Micro._service);

    process
      .on('SIGTERM', (signal) => Micro.exit(0, signal))
      .on('SIGHUP', (signal) => Micro.exit(0, signal))
      .on('SIGINT', (signal) => Micro.exit(0, signal));


    if (Micro._plugins.length > 0) {
      for (let plugin of Micro._plugins) {
        if (typeof plugin.init === 'function') {
          let promise = <Promise<void>>plugin.init();
          if (promise && typeof promise.then === 'function') {
            try {
              await promise;
            } catch (error: any) {
              Micro.logger.error(error);
            }
          }
        }
      }
    }

    if (typeof Micro._service.onInit === "function") {
      let promise: Promise<any> = Micro._service.onInit();
      if (promise && typeof promise.then === "function") {
        try {
          await promise;
        } catch (error: any) {
          Micro.logger.error(error);
        }
      }
    }

    for (let subService of Micro._subServicesList) {
      if (typeof subService.onInit === "function") {
        let promise: Promise<any> = subService.onInit();
        if (typeof promise?.then === "function")
          try { await promise; }
          catch (error: any) { Micro.logger.error(error); }
      }
    }

    if (Object.keys(processMsgsListners).length > 0)
      process.on('message', (msg: WorkerMessage) => {
        if (msg.message === 'publish') return;
        let options = processMsgsListners[msg.message];
        let currService = Micro.getCurrentService(options.service) || Micro._service;
        if (options.key && typeof currService[options.key] === "function") currService[options.key](msg.data);
      });

    for (let plugin of Micro._plugins)
      if (typeof plugin.onReady === "function") plugin.onReady();

    status = MICRO_STATUS.LIVE;
    if (typeof Micro._service.onReady === 'function') Micro._service.onReady();

    for (let subService of Micro._subServicesList)
      if (typeof subService.onReady === "function") subService.onReady();

    if (Micro.config.stdin) {
      process.stdin.on('data', chunk => {
        if (chunk.toString().trim().toLowerCase() === "exit")
          return Micro.exit(0);

        if (Micro._plugins) {
          for (let plugin of Micro._plugins)
            if (typeof plugin.onStdin === "function") plugin.onStdin(chunk);
        }

        if (typeof this._service.onStdin === "function") this._service.onStdin(chunk);

        for (let subService of this._subServicesList)
          if (typeof subService.onStdin === "function") subService.onStdin(chunk);
      });
    }

    if (Micro.config.healthCheck)
      setTimeout(Micro._updateHealthState, 1000);
  }
}