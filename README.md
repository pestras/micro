# Pestras Micros

**Pestras Microservice** as **PMS** is built on nodejs framework using typescript, supporting nodejs cluster with messageing made easy between workers.

Although **PMS** is almost empty of features, its strength comes handy through its plugins.

## Official Plugins

* **@pestras/micro-router**: Adds support for HTTP Rest services with very handfull routing feature.
* **@pestras/micro-socket.io**: Adds support for SocketIO connection with plenty of usefull decorators.
* **@pestras/micro-nats**: Adds support for Nats Server messaging system.
* **@pestras/micro-rabbitmq**: Adds support for RabbitMQ messaging system - *in development*.

# Template

```bash
$ git clone https://github.com/pestras/pestras-micro-template
```

## Creating Service

In order to create our service we need to use **SERVICE** decorator which holds the main configuration of our service class.

```ts
import { SERVICE } from '@pestras/microservice';

@SERVICE({ version: 1 })
class Test {}
```

### Service Configurations

Name        | Type     | Defualt         | Description
----        | -----    | ------          | -----
version     | number   | 0               | Current verion of our service, versions are used on rest resource */someservice/v1/...*.
kebabCase   | boolean  | true            | convert class name to kebekCasing as *ArticlesQueryAPI* -> *articles-query-api*
port        | number   | 3000            | Http server listening port.   
host        | string   | 0.0.0.0         | Http server host.
workers     | number   | 0               | Number of node workers to run, if assigned to minus value will take max number of workers depending on os max cpus number
logLevel    | LOGLEVEL | LOGLEVEL.INFO   |
tranferLog  | boolean  | false           | Allow logger to transfer logs to the service **onLog** method
exitOnUnhandledException | boolean | true |
exitOnUnhandledRejection | boolean | true |
cors | IncomingHttpHeaders & { 'success-code'?: string } | [see cors](#cors) | CORS for preflights requests

#### LOGLEVEL Enum

**PMS** provides only four levels of logs grouped in an enum type **LOGLEVEL**

- LOGLEVEL.ERROR
- LOGLEVEL.WARN
- LOGLEVEL.INFO
- LOGLEVEL.DEBUG

### Cors

**PM** default cors options are:

```
'access-control-allow-methods': "GET,HEAD,OPTIONS,PUT,PATCH,POST,DELETE",
'access-control-allow-origin': "*",
'access-control-allow-headers': "*",
'Access-Control-Allow-Credentials': 'false',
'response-code': '204'
```

To change that, overwrite new values into cors options

```ts
@SERVICE({
  version: 1,
  cors: {
    'access-control-allow-methods': "GET,PUT,POST,DELETE",
    'access-control-allow-headers': "content-type"
  }
})
class Test {}
```

## Micro

Before delving into service routes, subjects.. etc, let's find out how to run our service..

After defining our service class we use the **Micro** object to run our service through the *start* method.

```ts
import { SERVICE, Micro } from '@pestras/microservice';

@SERVICE({
  // service config
})
export class TEST {}

Micro.start(Test);
```

**Micro.start** method accepts additionl optional arguments that will be passed to service constructor in order

```ts
import { SERVICE, Micro } from '@pestras/microservice';
import { config } from './config'; 

@SERVICE({
  // service config
})
export class TEST {
  constructor(config: MyConf) {
    // handle configurations
  }
}

Micro.start(Test, config);
```

**Micro** object has another properties and methods that indeed we are going to use as well later in the service.

Name | Type | Description
--- | --- | ---
status | MICRO_STATUS | INIT \| EXIT\| LIVE
logger | Logger | Micro logger instance
message | (msg: string, data: WorkerMessage, target: 'all' \| 'others') => void | A helper method to broadcast a message between workers
exit | (code: number = 0, signal: NodeJs.Signal = "SIGTERM") => void | Used to stop service
plugin | (plugin: MicroPlugin) => void | The only way to inject plugins to our service


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

## OnLog

**PMS** has a built in lightweight logger that logs everything to the console.

In order to change that behavior we can define **onLog** event method in our service and **PMS** will detect that method and will transfer all logs to it, besides enabling **transferLog**
options in service config.

```ts
import { SERVICE, SUBJECT, Micro, ServiceEvents } from '@pestras/microservice';

@SERVICE({
  version: 1
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

## onHealthcheck

An event triggered for docker swarm healthcheck.

```ts
@SERVICE()
class Publisher implements ServiceEvents {

  // http: GET /healthcheck
  async onHealthcheck(res: Response) {
    // check for database connection
    if (dbConnected) res.status(200).end();
    else res.status(500).end()
  }
}
```

## onReadycheck

An event triggered for kubernetes ready check.

```ts
@SERVICE()
class Publisher implements ServiceEvents {

  // http: GET /readiness
  async onReadycheck(res: Response) {
    // check for database connection
    if (dbConnected) res.status(200).end();
    else res.status(500).end()
  }
}
```

## onLivecheck

An event triggered for kubernetes live check.

```ts
@SERVICE()
class Publisher implements ServiceEvents {

  // http: GET /liveness
  async onLivecheck(res: Response) {
    // check for database connection
    if (dbConnected) res.status(200).end();
    else res.status(500).end()
  }
}
```

## onHTTPMsg

Called whenever a new http request is received, passing the Request and Response instances as arguments;

```ts
import { IncomingMessage, ServerResponse } from 'http;
@SERVICE()
class Publisher implements ServiceEvents {

  async onHTTPMsg(req: IncomingMessage, res: ServerResponse) { }
}
```

**Note:** onHttpMsg event could be used by plugins as well, however the restiction is that only consumer can utilize this event others will be ignored,
service instance has the top priority on this one.

## onUnhandledRejection

Defining this handler will cancel **exitOnUnhandledRejection** option in service config, so you need to exit manually if it needs to be.

```ts
@SERVICE({ workers: 4 })
class Publisher implements ServiceEvents {

  onUnhandledRejection(reason: any, p: Promise<any>) {
    // do somethig with the error and then maybe exit
    // calling Micro.exit() will trigger onExit EventHandler
    Micro.exit(1);
  }
}
```

## onUnhandledException

Defining this handler will cancel **exitOnUnhandledException** option in service config, so you need to exit manually if it needs to be.

```ts
@SERVICE({ workers: 4 })
class Publisher implements ServiceEvents {

  onUnhandledException(err: any) {
    // do somethig with the error and then maybe exit
    // calling Micro.exit() will trigger onExit EventHandler
    Micro.exit(1);
  }
}
```

# Health Check

For health check in Dockerfile or docker-compose

```Dockerfile
HEALTHCHECK --interval=1m30s --timeout=2s --start_period=10s CMD node ./node_modules/@pestras/microservice/hc.js /articles/v0 3000
```

```yml
healthcheck:
  test: ["CMD", "node", "./node_modules/@pestras/microservice/hc.js", "/articles/v0", "3000"]
  interval: 1m30s
  timeout: 10s
  retries: 3
  start_period: 40s
```
Root path is required as the first parameter, while port defaults to 3000.

Thank you