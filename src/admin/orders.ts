import {NgZone, Component, Inject, OnInit} from '@angular/core';
import {GridOptions, ColDef, RowNode} from "ag-grid/main";
import moment = require('moment');

import Models = require('../common/models');
import Messaging = require('../common/messaging');
import {SubscriberFactory, FireFactory, BaseCurrencyCellComponent, QuoteCurrencyCellComponent} from './shared_directives';

@Component({
  selector: 'order-list',
  template: `<ag-grid-ng2 #orderList class="ag-fresh ag-dark" style="height: 150px;width: 99.99%;" rowHeight="21" [gridOptions]="gridOptions" (cellClicked)="onCellClicked($event)"></ag-grid-ng2>`
})
export class OrdersComponent implements OnInit {

  private gridOptions: GridOptions = <GridOptions>{};

  private fireCxl: Messaging.IFire<Models.OrderStatusReport>;

  constructor(
    @Inject(NgZone) private zone: NgZone,
    @Inject(SubscriberFactory) private subscriberFactory: SubscriberFactory,
    @Inject(FireFactory) private fireFactory: FireFactory
  ) {}

  ngOnInit() {
    this.gridOptions.rowData = [];
    this.gridOptions.enableSorting = true;
    this.gridOptions.columnDefs = this.createColumnDefs();
    this.gridOptions.suppressNoRowsOverlay = true;
    // this.gridOptions.overlayNoRowsTemplate = `<span class="ag-overlay-no-rows-center">not trading</span>`;

    this.fireCxl = this.fireFactory
      .getFire(Messaging.Topics.CancelOrder);

    this.subscriberFactory
      .getSubscriber(this.zone, Messaging.Topics.OrderStatusReports)
      .registerDisconnectedHandler(() => this.gridOptions.rowData.length = 0)
      .registerSubscriber(this.addRowData);
  }

  private createColumnDefs = (): ColDef[] => {
    return [
      { width: 82, field: 'time', headerName: 'time', cellRenderer:(params) => {
          return (params.value) ? Models.toShortTimeString(params.value) : '';
        },
        comparator: (a: moment.Moment, b: moment.Moment) => a.diff(b),
        cellClass: (params) => {
          return 'fs11px'+(Math.abs(moment.utc().valueOf() - params.data.time.valueOf()) > 7000 ? " text-muted" : "");
      }  },
      { width: 35, field: 'lat', headerName: 'lat'},
      { width: 90, field: 'orderId', headerName: 'openOrderId' },
      { width: 40, field: 'side', headerName: 'side' , cellClass: (params) => {
        if (params.value === 'Bid') return 'buy';
        else if (params.value === 'Ask') return "sell";
      }},
      { width: 65, field: 'price', headerName: 'px',
      sort: 'desc',  cellClass: (params) => {
        return (params.data.side === 'Ask') ? "sell" : "buy";
      }, cellRendererFramework: QuoteCurrencyCellComponent},
      { width: 60, field: 'lvQty', headerName: 'qty', cellClass: (params) => {
        return (params.data.side === 'Ask') ? "sell" : "buy";
      }, cellRendererFramework: BaseCurrencyCellComponent},
      { width: 60, field: 'value', headerName: 'value', cellClass: (params) => {
        return (params.data.side === 'Ask') ? "sell" : "buy";
      }, cellRendererFramework: QuoteCurrencyCellComponent},
      { width: 45, field: 'type', headerName: 'type' },
      { width: 40, field: 'tif', headerName: 'tif' },
      { width: 40, field: "cancel", headerName: 'cxl', cellRenderer: (params) => {
        return '<button type="button" class="btn btn-danger btn-xs"><span data-action-type="remove" class="glyphicon glyphicon-remove"></span></button>';
      } },
    ];
  }

  public onCellClicked = ($event) => {
    if ($event.event.target.getAttribute("data-action-type")=='remove')
      this.fireCxl.fire({
        orderId:$event.data.orderId,
        exchange:$event.data.exchange
      });
  }

  private addRowData = (o: Models.Timestamped<any[]>) => {
    if (!this.gridOptions.api) return;
    let exists: boolean = false;
    let isClosed: boolean = (o.data[1] == Models.OrderStatus.New
      || o.data[1] == Models.OrderStatus.Cancelled
      || o.data[1] == Models.OrderStatus.Complete
      || o.data[1] == Models.OrderStatus.Rejected);
    this.gridOptions.api.forEachNode((node: RowNode) => {
      if (!exists && node.data.orderId==o.data[0]) {
        exists = true;
        if (isClosed) this.gridOptions.api.removeItems([node]);
        else {
          node.setData(Object.assign(node.data, {
            time: (moment.isMoment(o.time) ? o.time : moment(o.time)),
            price: o.data[3],
            value: Math.round(o.data[3] * o.data[4] * 100) / 100,
            tif: Models.TimeInForce[o.data[7]],
            lat: o.data[8]+'ms',
            lvQty: o.data[9]
          }));
          this.gridOptions.api.refreshView();
        }
      }
    });
    if (!exists && !isClosed)
      this.gridOptions.api.addItems([{
        orderId: o.data[0],
        exchange: o.data[2],
        time: (moment.isMoment(o.time) ? o.time : moment(o.time)),
        price: o.data[3],
        value: Math.round(o.data[3] * o.data[4] * 100) / 100,
        side: Models.Side[o.data[5]],
        type: Models.OrderType[o.data[6]],
        tif: Models.TimeInForce[o.data[7]],
        lat: o.data[8]+'ms',
        lvQty: o.data[9],
        quoteSymbol: Models.Currency[o.data[10]]
      }]);
  }
}

