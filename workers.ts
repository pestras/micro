import * as cluster from 'cluster';
import { cpus } from 'os';

export interface WorkerMessage {
  message: string;
  target?: 'others' | 'all';
  data?: any;
  [key: string]: any;
}

export class WorkersManager {
  private count: number;
  private isRestarting = false;

  constructor(private logger: any, count: number) {
    let cpusCount = cpus().length;
    this.count = count < 0 ? cpusCount : count > cpusCount ? cpusCount : count;

    this.initialize();
  }

  private prepareWorker(worker: cluster.Worker) {
    this.logger.info(`Preparing worker: ${worker.id}`);

    worker.on('message', (msg: WorkerMessage) => {
      if (msg.message && msg.message.indexOf('restart') > -1 && this.isRestarting === false)
        return this.restart(msg.message === "restart" ? process.pid : null);

      if (msg.target === 'others' || msg.target === 'all')
        this.publishMsg(msg, msg.target === 'others' ? worker.process.pid : undefined);
    })
  }

  private restart(pid?: number) {
    let workers: cluster.Worker[] = [];
    if (pid) {
      let worker = this.getWorker(pid);
      !!worker && workers.push(worker);
    } else {
      workers = Object.values(cluster.workers);
    }

    if (workers.length === 0) return;

    this.logger.info('restarting workers..');
    this.isRestarting = true;

    function restartWorker(index: number) {
      const worker = workers[index];
      cluster.workers
  
      if (!worker) return this.isRestarting = false;
  
      worker.on('exit', () => {
        if (worker.exitedAfterDisconnect) return;
  
        this.logger.info(`Exited process ${worker.process.pid}`);
  
        let newWorker = cluster.fork();
        newWorker.on('listening', () => restartWorker(index + 1));
      });
  
      worker.disconnect();
    }

    restartWorker(0);
  }

  private publishMsg(msg: WorkerMessage, pid?: number) {
    for (let worker of Object.values(cluster.workers)) {
      if (pid && worker.process.pid === pid) continue;
      worker.send(msg);
    }
  }

  private getWorker(pid: number): cluster.Worker {
    for (let worker of Object.values(cluster.workers))
      if (worker.process.pid === pid) return worker;
    return null;
  }

   private initialize() {
    this.logger.info(`forking processes count: ${this.count}`);
    for (let i = 0; i < this.count; i++)
      cluster.fork();

    cluster.on('exit', (worker, code, signal) => {
      if (code !== 0) {
        this.logger.warn(`Worker ${worker.id} crashed -signal: ${signal}`);
        this.logger.warn(`Starting new worker`);
        cluster.fork;
      }

      this.logger.info('listening on worker online');
      cluster.on('online', worker => {
        this.logger.info(`worker online: ${worker.id}, process: ${worker.process.pid}`);
        this.prepareWorker(worker);
      });
    })
  }
}