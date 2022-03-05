# Pestras Micros

**Pestras Microservice** as **PMS** is built on nodejs framework using typescript, supporting nodejs cluster with messageing made easy between workers.

Although **PMS** is almost empty of features, its strength comes handy through its plugins.

## Official Plugins

* **[@pestras/micro-router](https://www.npmjs.com/package/@pestras/micro-router)**: Adds support for HTTP Rest services with very handfull routing feature.
* **[@pestras/micro-socket](https://www.npmjs.com/package/@pestras/micro-socket)**: Adds support for SocketIO connection with plenty of usefull decorators.
* **[@pestras/micro-rabbitmq](https://www.npmjs.com/package/@pestras/micro-rabbitmq)**: Adds support for RabbitMQ messaging system.
* **[@pestras/micro-nats](https://www.npmjs.com/package/@pestras/micro-nats)**: Adds support for Nats Server messaging system.
* **[@pestras/micro-kafka](https://www.npmjs.com/package/@pestras/micro-kafka)**: Adds support for kafka messaging system.

## Creating Service

In order to create our service we need to use **SERVICE** decorator which holds the main configuration of our service class.

```ts
import { SERVICE } from '@pestras/microservice';

@SERVICE()
class Test {}
```

### Service Configurations

Name        | Type     | Defualt         | Description
----        | -----    | ------          | -----
workers     | number   | 0               | Number of node workers to run, if assigned to minus value will take max number of workers depending on os max cpus number.
logLevel    | LOGLEVEL | LOGLEVEL.INFO   |
tranferLog  | boolean  | false           | Allow logger to transfer logs to the service **onLog** method.
stdin       | boolean  | false           | listen on stdin data event.
healthCheck | boolean  | true            | Enable health check interval.

#### LOGLEVEL Enum

**PMS** provides only four levels of logs grouped in an enum type **LOGLEVEL**

- LOGLEVEL.ERROR
- LOGLEVEL.WARN
- LOGLEVEL.INFO
- LOGLEVEL.DEBUG

## Micro

After defining our service class we use the **Micro** object to run our service through the *start* method.

```ts
import { SERVICE, Micro } from '@pestras/microservice';

@SERVICE({
  // service config
})
export class TEST {}

Micro.start(Test);
```

**Micro** object has another properties and methods that indeed we are going to use as well later in the service.

Name | Type | Description
--- | --- | ---
status | MICRO_STATUS | INIT \| EXIT\| LIVE
logger | Logger | Micro logger instance
Store | { [key: string]: any } | data store shared among main service and the all subservices and plugins.
message | (msg: string, data: WorkerMessage, target: 'all' \| 'others') => void | A helper method to broadcast a message between workers
exit | (code: number = 0, signal: NodeJs.Signal = "SIGTERM") => void | Used to stop service
plugin | (plugin: MicroPlugin) => void | The only way to inject plugins to our service

# Sub Services

*PM* gives us the ability to modulerize our service into subservices for better code splitting.

SubServices are classes that are defined in seperate modules, then imported to the main service module then passed to *Micro.start()* method to be implemented.

```ts
// comments.service.ts
import { SubServiceEvents } from '@pestras/microservice';

export class Comments implements SubServiceEvents {

  async onInit() {}
}
```

```ts
// main.ts
import { Micro, SERVICE, ServiceEvents } from '@pestras/microservice';
import { Comments} from './comments.service'

@SERVICE()
class Articles {

  onInit() {    
    Micro.Store.someSharedValue = "shared value";
  }
}

// pass sub services as an array to the second argument of Micro.start method
Micro.start(Articles, [Comments]);
```

Subservices have their own events *onInit, onReady, onStdin and onExit*.

# STORE Decorator:

There are cases when sub serveses need to access each other methods even with the main service,  
**STORE** decorators adds methods attached to to **Micro** store when each service instanciated, that way can be accessed any where.

```ts
// index.ts
@SERVICE()
class ArticlesService {

  @STORE()
  async getArticleById(id: string) {
    // ...our fetch code
  }
}


// comments-service.ts
type ArticleGetter = (id: string) => Promise<Article>;

class CommentsService {
  
  async insertComment(articleId: string, comment: string) {
    // use shared method
    let article await = (<ArticleGetter>Micro.store.getArticleById)(articleId);
  }
}
```

*Note: stored methods overwite previous methods with same name.*

# Cluster

**PMS** uses node built in cluster api, and made it easy for us to manage workers communications.

First of all to enable clustering we should set workers number in our service configurations to some value greater than one.

```ts
import { SERVICE, WORKER_MSG } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher {}
```

To listen for a message form another process.

```ts
import { SERVICE, MSG } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher {

  @WORKER_MSG('some message')
  onSomeMessage(data: any) {}
}
```

To send a message to other processes we need to use *Micro.message* method, it accepts three parameters.

Name | Type | Required | Default | Description
--- | --- | ---- | --- | ---
message | string | true | - | Message name
data | any | false | null | Message payload
target | 'all' \| 'others' | false | 'others' | If we need the same worker to receive the message as well.

```ts
import { SERVICE, Micro } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher {
  
  // some where in your service
  Micro.message('some message', { key: 'value' });
}
```

Also it is made easy to restart all workers or the current one.

```ts
import { SERVICE, Micro } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher {

  // some where in our service

  // restarting all workers
  Micro.message('restart all');

  // restarting the current worker
  Micro.message('restart');
}
```

# Plugins

To create our own plugins, it is just easy as creating a sub service as follows:

```ts
import { MICRO, MicroPlugin } from '@pestras/micro';

export interface PluginConfigInterface {}

class MyPlugin extends MicroPlugin {

  constructor(private config: PluginConfigInterface) {
    
  }

  async init() {} // init method is required

  onReady() {}

  onStdin() {}

  onStdinEnd() {}

  onExit() {}
}

export { MyPlugin }; 
```

```ts {
  import { Micro } from '@pestras/micro';
  import { MyPlugin } from 'mypluginPath';

  Micro.plugins(new MyPlugin(config));
}
```

# Lifecycle & Events Methods

**PMS** will try to call some service methods in specific time or action if they were already defined in our service.

## onInit

When defined, will be called once our service is instantiated but nothing else, this method is useful when
we need to connect to a databese or to make some async operations before start listening one events or http requests.

It can return a promise or nothing.

```ts
import { SERVICE, ServiceEvents } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher implements ServiceEvents {

  async onInit() {
    // connect to a databese
  }
}
```

## onReady

This method is called once all our listeners are ready.

```ts
import { SERVICE, ServiceEvents } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher implements ServiceEvents {

  onReay() {}
}
```

## onExit

Called once our service is stopped when calling **Micro.exit()** or when any of termination signals are triggerred *SIGTERM, SIGINT, SIGHUP*, 

Exit code with the signal are passed as arguments.

```ts
import { SERVICE, ServiceEvents } from '@pestras/microservice';

@SERVICE({ workers: 4 })
class Publisher implements ServiceEvents {

  onExit(code: number, signal: NodeJS.Signals) {
    // disconnecting from the databese
  }
}
```

## onLog

**PMS** has a built in lightweight logger that logs everything to the console.

In order to change that behavior we can define **onLog** event method in our service and **PMS** will detect that method and will transfer all logs to it, besides enabling **transferLog**
options in service config.

```ts
import { SERVICE, Micro, ServiceEvents } from '@pestras/microservice';

@SERVICE({
  transferLog: process.env.NODE_ENV === 'production'
})
class Test implements ServiceEvents {

  onLog(level: LOGLEVEL, msg: any, extra: any) {
    // what ever you code
  }

  onExit(code: number, signal: NodeJS.Signals) {
    Micro.logger.warn('exiting service');
  }
}
```

## onStdin

**PMS** listens to **stdin** by default unless it is disabled in service config decorator, it will call this event whenerver inputs are injected to stdin.

```ts
import { SERVICE, Micro, ServiceEvents } from '@pestras/microservice';

@SERVICE()
class Test implements ServiceEvents {

  onStdin(chunk: Buffer) {
    console.log(chunk.toString());
  }
}
```

"exit" input will exit the process.

# Health Check

**PMS** makes an interval check for the service health state members *(healthy, ready, live)*, and any value that is **undefined** will be considered as **true** value.

```ts
@SERVICE({ workers: 4 })
class Publisher implements ServiceEvents, HealthState {
  healthy = false;
  ready = false;
  live = false;

  async onInit() {
    this.healthy = true;

    // check readiness
    this.ready = true;

    // check liveness
    this.live = true;
  }
}
```

Be aware that even plugins are health checked as well, so even your service is healthy that does not mean that the healthcheck result should be healthy as well.

Even sub services have their individual health check.

Healh state is saved in a file under a directory specicfied in **HEALTH_CHECK_DIR** environment variable, defaults to **"~/"**.

To complete the health check process you need to enable health check in Dockerfile or docker-compose, as well as readiness and liveness check in k8s if used.

```Dockerfile
HEALTHCHECK --interval=30s --timeout=2s CMD npx health-check healthy
```

```yml
healthcheck:
  test: ["CMD", "npx", "health-check", "healthy"]
  interval: 1m30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

Last argument can be one of **(healthy, ready, live)** kewords, it is optional defaults to **healthy**.

Thank you