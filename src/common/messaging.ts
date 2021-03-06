import { Observable } from 'rxjs/Observable';

import Models = require("./models");

module Prefixes {
    export var SUBSCRIBE = "_";
    export var SNAPSHOT = "=";
    export var MESSAGE = "-";
}

export class Topics {
    static FairValue = "a";
    static Quote = "b";
    static ActiveSubscription = "c";
    static ActiveChange = "d";
    static MarketData = "e";
    static QuotingParametersChange = "f";
    static SafetySettings = "g";
    static Product = "h";
    static OrderStatusReports = "i";
    static ProductAdvertisement = "j";
    static ApplicationState = "k";
    static Notepad = "l";
    static ToggleConfigs = "m";
    static Position = "n";
    static ExchangeConnectivity = "o";
    static SubmitNewOrder = "p";
    static CancelOrder = "q";
    static MarketTrade = "r";
    static Trades = "s";
    static ExternalValuation = "t";
    static QuoteStatus = "u";
    static TargetBasePosition = "v";
    static TradeSafetyValue = "w";
    static CancelAllOrders = "x";
    static CleanAllClosedOrders = "y";
    static CleanAllOrders = "z";
}

export interface IPublish<T> {
    publish: (msg: T) => void;
    registerSnapshot: (generator: () => T[]) => IPublish<T>;
}

export class Publisher<T> implements IPublish<T> {
    private _snapshot: () => T[] = null;
    constructor(private topic: string,
                private _io: SocketIO.Server,
                private snapshot: () => T[]) {
        this.registerSnapshot(snapshot || null);

        var onConnection = s => {
            s.on(Prefixes.SUBSCRIBE + topic, () => {
                if (this._snapshot !== null) {
                  let snap: T[] = this._snapshot();
                  if (this.topic === Topics.MarketData)
                    snap = this.compressSnapshot(this._snapshot(), this.compressMarketDataInc);
                  else if (this.topic === Topics.OrderStatusReports)
                    snap = this.compressSnapshot(this._snapshot(), this.compressOSRInc);
                  else if (this.topic === Topics.Position)
                    snap = this.compressSnapshot(this._snapshot(), this.compressPositionInc);
                  s.emit(Prefixes.SNAPSHOT + topic, snap);
                }
            });
        };

        this._io.on("connection", onConnection);

        Object.keys(this._io.sockets.connected).forEach(s => {
            onConnection(this._io.sockets.connected[s]);
        });
    }

    public publish = (msg: T) => {
      if (this.topic === Topics.MarketData)
        msg = this.compressMarketDataInc(msg);
      else if (this.topic === Topics.OrderStatusReports)
        msg = this.compressOSRInc(msg);
      else if (this.topic === Topics.Position)
        msg = this.compressPositionInc(msg);
      this._io.emit(Prefixes.MESSAGE + this.topic, msg)
    };

    public registerSnapshot = (generator: () => T[]) => {
        if (this._snapshot === null) this._snapshot = generator;
        else throw new Error("already registered snapshot generator for topic " + this.topic);
        return this;
    }

    private compressSnapshot = (data: T[], compressIncremental:(data: any) => T): T[] => {
      let ret: T[] = [];
      data.forEach(x => ret.push(compressIncremental(x)));
      return ret;
    };

    private compressMarketDataInc = (data: any): T => {
      let ret: any = new Models.Timestamped([[],[]], data.time);
      let diffPrice: number = 0;
      let prevPrice: number = 0;
      data.bids.map(bid => {
        diffPrice = Math.abs(prevPrice - bid.price);
        prevPrice = bid.price;
        ret.data[0].push(Math.round(diffPrice * 1e2) / 1e1, Math.round(bid.size * 1e3) / 1e2)
      });
      diffPrice = 0;
      prevPrice = 0;
      data.asks.map(ask => {
        diffPrice = Math.abs(prevPrice - ask.price);
        prevPrice = ask.price;
        ret.data[1].push(Math.round(diffPrice * 1e2) / 1e1, Math.round(ask.size * 1e3) / 1e2)
      });
      return ret;
    };

    private compressOSRInc = (data: any): T => {
      return <any>new Models.Timestamped(
        (data.orderStatus == Models.OrderStatus.Cancelled
        || data.orderStatus == Models.OrderStatus.Complete
        || data.orderStatus == Models.OrderStatus.Rejected)
      ? [
        data.orderId,
        data.orderStatus
      ] : [
        data.orderId,
        data.orderStatus,
        data.exchange,
        data.price,
        data.quantity,
        data.side,
        data.type,
        data.timeInForce,
        data.latency,
        data.leavesQuantity,
        data.pair.quote
      ], data.time);
    };

    private compressPositionInc = (data: any): T => {
      return <any>new Models.Timestamped([
        Math.round(data.baseAmount * 1e3) / 1e3,
        Math.round(data.quoteAmount * 1e2) / 1e2,
        Math.round(data.baseHeldAmount * 1e3) / 1e3,
        Math.round(data.quoteHeldAmount * 1e2) / 1e2,
        Math.round(data.value * 1e5) / 1e5,
        Math.round(data.quoteValue * 1e2) / 1e2,
        data.pair.base,
        data.pair.quote
      ], data.time);
    };
}

export class NullPublisher<T> implements IPublish<T> {
  public publish = (msg: T) => {};
  public registerSnapshot = (generator: () => T[]) => this;
}

export interface ISubscribe<T> {
  registerSubscriber: (incrementalHandler: (msg: T) => void) => ISubscribe<T>;
  registerDisconnectedHandler: (handler: () => void) => ISubscribe<T>;
  connected: boolean;
}

export class Subscriber<T> extends Observable<T> implements ISubscribe<T> {
  private _disconnectHandler: () => void = null;
  private _socket: SocketIOClient.Socket;

  constructor(
    private topic: string,
    io: SocketIOClient.Socket
  ) {
    super(observer => {
      this._socket = io;

      let onConnect = () => this._socket.emit(Prefixes.SUBSCRIBE + this.topic);
      if (this.connected) onConnect();

      this._socket
        .on("connect", onConnect)
        .on("disconnect", this.onDisconnect)
        .on(Prefixes.MESSAGE + topic, (data) => observer.next(data))
        .on(Prefixes.SNAPSHOT + topic, (data) => data.forEach(item => setTimeout(() => observer.next(item), 0)));

      return () => {};
    });
  }

  public get connected(): boolean {
    return this._socket.connected;
  }

  private onDisconnect = () => {
    if (this._disconnectHandler !== null)
      this._disconnectHandler();
  };

  public registerSubscriber = (incrementalHandler: (msg: T) => void) => {
    if (!this._socket) this.subscribe(incrementalHandler);
    else throw new Error("already registered incremental handler for topic " + this.topic);
    return this;
  };

  public registerDisconnectedHandler = (handler : () => void) => {
    if (this._disconnectHandler === null) this._disconnectHandler = handler;
    else throw new Error("already registered disconnect handler for topic " + this.topic);
    return this;
  };
}

export interface IFire<T> {
  fire(msg: T): void;
}

export class Fire<T> implements IFire<T> {
    private _socket : SocketIOClient.Socket;

    constructor(private topic : string, io : SocketIOClient.Socket) {
        this._socket = io;
        // this._socket.on("connect", () => _log("Fire connected to", this.topic))
                    // .on("disconnect", () => _log("Fire disconnected to", this.topic));
    }

    public fire = (msg : T) : void => {
        this._socket.emit(Prefixes.MESSAGE + this.topic, msg);
    };
}

export interface IReceive<T> {
    registerReceiver(handler: (msg: T) => void) : void;
}

export class NullReceiver<T> implements IReceive<T> {
    registerReceiver = (handler: (msg: T) => void) => {};
}

export class Receiver<T> implements IReceive<T> {
    private _handler: (msg: T) => void = null;
    constructor(private topic: string, io: SocketIO.Server) {
        var onConnection = (s: SocketIO.Socket) => {
            // this._log("socket", s.id, "connected for Receiver", topic);
            s.on(Prefixes.MESSAGE + this.topic, msg => {
                if (this._handler !== null)
                    this._handler(msg);
            });
            // s.on("error", e => {
                // _log("error in Receiver", e.stack, e.message);
            // });
        };

        io.on("connection", onConnection);
        Object.keys(io.sockets.connected).forEach(s => {
            onConnection(io.sockets.connected[s]);
        });
    }

    registerReceiver = (handler : (msg : T) => void) => {
        if (this._handler === null) {
            this._handler = handler;
        }
        else {
            throw new Error("already registered receive handler for topic " + this.topic);
        }
    };
}
